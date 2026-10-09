import {
  assembleInput,
  countHubRecipients,
  firstFunding,
  type Address,
  type AssessmentInput,
  type ScoringConfig,
  type Transfer,
} from '@argus/scoring';
import { HyperSyncClient } from './hypersync.ts';

/** Addresses per topic filter in one query. */
const CHUNK = 500;
/**
 * Transfers read per funder to decide whether it is a hub. More than 200 distinct recipients is proof, so there
 * is no need to page a whole history: on the free HyperSync tier (about 15 queries a minute) an exchange's
 * outbound history would otherwise take many minutes.
 */
const HUB_PROBE = 2_500;
/** Ceiling when the small funders are re-read in full. */
const FUNDER_FULL_CAP = 20_000;
/** Earliest inbound transfers read for the members of a funder's group. */
const MEMBER_INBOUND_CAP = 20_000;
/** Outflows of a group's members; beyond this they are not used. */
const MEMBER_OUTBOUND_CAP = 5_000;

/**
 * Early-stop test for a first-funder lookup: true once every wallet in `part` has an inbound transfer of at least
 * `min`. Pages arrive oldest first, so by then each wallet's earliest qualifying transfer is already in hand.
 */
const allFunded = (part: Address[], min: bigint) => {
  const done = new Set<string>();
  let scanned = 0;
  return (out: Transfer[]) => {
    for (; scanned < out.length; scanned++) {
      const t = out[scanned]!;
      if (t.amount >= min && t.from !== t.to) done.add(t.to.toLowerCase());
    }
    return part.every((w) => done.has(w.toLowerCase()));
  };
};

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const key = (t: Transfer) => `${t.txHash}:${t.from}:${t.to}:${t.amount}`.toLowerCase();
const lc = (a: string) => a.toLowerCase() as Address;

/**
 * ChainDataProvider (PV-2): first USDC funder, the funded group G(F), funder recipient counts and
 * group outflows, all from public USDC Transfer logs through Envio HyperSync.
 * Wallets are assessed in batches: about 4 queries for any number of wallets, because the
 * free HyperSync tier allows roughly 15 queries a minute.
 */
export class ChainDataProvider {
  readonly name = 'envio-hypersync';
  constructor(
    private readonly hs: HyperSyncClient,
    private readonly chainId: number,
    private readonly cfg: ScoringConfig,
  ) {}

  get calls() {
    return this.hs.calls;
  }

  async gather(wallet: Address): Promise<AssessmentInput> {
    return (await this.gatherMany([wallet])).inputs[0]!;
  }

  /** Inputs for the requested wallets, plus the transfers so callers can assess other group members. */
  async gatherMany(wallets: Address[]): Promise<{ inputs: AssessmentInput[]; transfers: Transfer[] }> {
    const targets = [...new Set(wallets.map(lc))];

    // 1. Inbound USDC to every target: gives each first funder F.
    const inbound = await this.many((part) => this.hs.transfers({ to: part, stop: allFunded(part, this.cfg.minFunding) }), targets);
    const funders = new Set<Address>();
    for (const w of targets) {
      const f = firstFunding(inbound, w, this.cfg.minFunding);
      if (f && !this.cfg.knownHubs.has(lc(f.from))) funders.add(lc(f.from));
    }

    // 2. Everything the funders sent: recipient counts (hub rule) and candidate members.
    const probeCap = HUB_PROBE * Math.min(Math.max(funders.size, 1), 8);
    let fOut = await this.many((part) => this.hs.transfers({ from: part, maxTransfers: probeCap }), [...funders]);
    const hubs = new Set([...funders].filter((f) => countHubRecipients(fOut, f, this.cfg.hubMinTransfer) > this.cfg.hubRecipientThreshold));
    const bespoke = [...funders].filter((f) => !hubs.has(f));
    if (fOut.length >= probeCap && bespoke.length > 0) {
      // The probe was cut off, so the small funders' histories may be incomplete: read them again on their own.
      const rest = await this.many((part) => this.hs.transfers({ from: part, maxTransfers: FUNDER_FULL_CAP }), bespoke);
      fOut = [...fOut.filter((t) => hubs.has(lc(t.from))), ...rest];
    }

    // 3. Inbound and outbound of every wallet a bespoke funder seeded: their first funders and outflows.
    const bespokeSet = new Set(bespoke);
    const recipients = [
      ...new Set(fOut.filter((t) => bespokeSet.has(lc(t.from)) && t.amount >= this.cfg.minFunding).map((t) => lc(t.to))),
    ];
    // Inbound: the earliest transfers carry each member's first funder, so a cap is safe (a member first funded after the
    // cutoff just drops out of the group, which can only make a group smaller). Outflows only feed S3 and S4; a busy
    // wallet (a trading bot can have 100,000 transfers) makes them too big to read, so they are dropped, never half-used.
    const inR = await this.many((part) => this.hs.transfers({ to: part, maxTransfers: MEMBER_INBOUND_CAP, stop: allFunded(part, this.cfg.minFunding) }), recipients);
    let outR = await this.many((part) => this.hs.transfers({ from: part, maxTransfers: MEMBER_OUTBOUND_CAP }), recipients);
    if (outR.length >= MEMBER_OUTBOUND_CAP) outR = [];

    const seen = new Set<string>();
    const all = [...inbound, ...fOut, ...inR, ...outR].filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
    return { inputs: wallets.map((w) => assembleInput(this.chainId, w, all, this.cfg)), transfers: all };
  }

  private async many(fn: (part: Address[]) => Promise<Transfer[]>, addrs: Address[]): Promise<Transfer[]> {
    const out: Transfer[] = [];
    for (const part of chunks(addrs, CHUNK)) out.push(...(await fn(part)));
    return out;
  }
}

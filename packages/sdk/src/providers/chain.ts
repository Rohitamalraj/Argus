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
/** Enough to prove a funder is a hub without downloading all of its history. */
const FUNDER_PAGE_CAP = 20_000;

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
    const inbound = await this.many((part) => this.hs.transfers({ to: part }), targets);
    const funders = new Set<Address>();
    for (const w of targets) {
      const f = firstFunding(inbound, w, this.cfg.minFunding);
      if (f && !this.cfg.knownHubs.has(lc(f.from))) funders.add(lc(f.from));
    }

    // 2. Everything the funders sent: recipient counts (hub rule) and candidate members.
    let fOut = await this.many((part) => this.hs.transfers({ from: part, maxTransfers: FUNDER_PAGE_CAP }), [...funders]);
    const hubs = new Set([...funders].filter((f) => countHubRecipients(fOut, f, this.cfg.hubMinTransfer) > this.cfg.hubRecipientThreshold));
    const bespoke = [...funders].filter((f) => !hubs.has(f));
    if (fOut.length >= FUNDER_PAGE_CAP && hubs.size > 0 && bespoke.length > 0) {
      // A hub filled the page cap; fetch the small funders again on their own so none of their history is cut off.
      const rest = await this.many((part) => this.hs.transfers({ from: part }), bespoke);
      fOut = [...fOut.filter((t) => hubs.has(lc(t.from))), ...rest];
    }

    // 3. Inbound and outbound of every wallet a bespoke funder seeded: their first funders and outflows.
    const bespokeSet = new Set(bespoke);
    const recipients = [
      ...new Set(fOut.filter((t) => bespokeSet.has(lc(t.from)) && t.amount >= this.cfg.minFunding).map((t) => lc(t.to))),
    ];
    const inOutR = await this.many((part) => this.hs.transfersAny([{ to: part }, { from: part }]), recipients);

    const seen = new Set<string>();
    const all = [...inbound, ...fOut, ...inOutR].filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
    return { inputs: wallets.map((w) => assembleInput(this.chainId, w, all, this.cfg)), transfers: all };
  }

  private async many(fn: (part: Address[]) => Promise<Transfer[]>, addrs: Address[]): Promise<Transfer[]> {
    const out: Transfer[] = [];
    for (const part of chunks(addrs, CHUNK)) out.push(...(await fn(part)));
    return out;
  }
}

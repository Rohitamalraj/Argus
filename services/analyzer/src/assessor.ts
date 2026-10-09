import {
  Tier,
  assembleInput,
  buildEvidenceBundle,
  canonicalJson,
  decide,
  evidenceHash,
  knownHubsFor,
  makeConfig,
  type Address,
  type AssessmentInput,
  type Decision,
  type Hex,
  type ScoringConfig,
  type Transfer,
} from '@argus/scoring';
import { NETWORKS, type Network } from './networks.ts';
import type { NansenProvider } from './providers/nansen.ts';
import type { Store, VerdictRecord } from './store.ts';

export interface WalletIntel {
  readonly name: string;
  readonly calls: number;
  gatherMany(wallets: Address[]): Promise<{ inputs: AssessmentInput[]; transfers: Transfer[] }>;
}

/** The deep (paid) source: Nansen on mainnet. */
export type DeepIntel = Pick<NansenProvider, 'name' | 'calls' | 'usd' | 'firstFunder' | 'funderRecipients'>;

export interface AssessorOptions {
  store: Store;
  /** Deep check source for mainnet; absent means deep requests fall back to the light check. */
  deep?: DeepIntel;
  salt: Hex;
  providers: Partial<Record<Network, WalletIntel>>;
  configs?: Partial<Record<Network, ScoringConfig>>;
  ttlSec?: number;
  /** Requests arriving within this window share one provider round (HyperSync allows ~15 queries a minute). */
  batchWindowMs?: number;
  now?: () => number;
}

export type Depth = 'light' | 'deep';
type Pending = { wallet: Address; deep: boolean; resolve: (v: VerdictRecord) => void; reject: (e: unknown) => void };

/**
 * Light check (AN-1, AN-2): chain data only. Pre-computes verdicts for every member of a Linked
 * group (AN-3), so the next fleet wallet is recognised on its first call.
 */
export class Assessor {
  private queues = new Map<Network, Pending[]>();
  private inflight = new Map<string, Promise<VerdictRecord>>();
  private timers = new Map<Network, NodeJS.Timeout>();
  private readonly ttl: number;
  private readonly window: number;
  private readonly now: () => number;

  constructor(private readonly o: AssessorOptions) {
    this.ttl = o.ttlSec ?? 7 * 86_400;
    this.window = o.batchWindowMs ?? 300;
    this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
  }

  config(network: Network): ScoringConfig {
    return this.o.configs?.[network] ?? makeConfig({ knownHubs: knownHubsFor(NETWORKS[network].chainId) });
  }

  /** Is a deep (Nansen) check possible for this request? Mainnet only, and only when a deep source is configured. */
  canGoDeep(network: Network): boolean {
    return network === 'mainnet' && !!this.o.deep;
  }

  /**
   * Cached verdict if still fresh (AN-11), unless `fresh` is set. A light verdict does not satisfy a deep request.
   * A wallet already being assessed shares that run.
   */
  async assess(network: Network, wallets: Address[], fresh = false, depth: Depth = 'light'): Promise<VerdictRecord[]> {
    const deep = depth === 'deep' && this.canGoDeep(network);
    return Promise.all(
      wallets.map((w) => {
        const cached = this.o.store.getVerdict(network, w);
        if (!fresh && cached && cached.expiresAt > this.now() && (!deep || cached.depth === 'deep')) return cached;
        const key = `${network}:${w.toLowerCase()}:${deep ? 'deep' : 'light'}`;
        const running = this.inflight.get(key);
        if (running) return running;
        const p = this.enqueue(network, w, deep).finally(() => this.inflight.delete(key));
        this.inflight.set(key, p);
        return p;
      }),
    );
  }

  private enqueue(network: Network, wallet: Address, deep: boolean): Promise<VerdictRecord> {
    return new Promise((resolve, reject) => {
      const q = this.queues.get(network) ?? [];
      q.push({ wallet, deep, resolve, reject });
      this.queues.set(network, q);
      if (!this.timers.has(network)) {
        this.timers.set(network, setTimeout(() => void this.flush(network), this.window));
      }
    });
  }

  private async flush(network: Network): Promise<void> {
    const batch = this.queues.get(network) ?? [];
    this.queues.delete(network);
    this.timers.delete(network);
    if (batch.length === 0) return;
    // Deep requests run as their own round so light requests are never held up by Nansen's rate limit.
    for (const deep of [false, true]) {
      const part = batch.filter((p) => p.deep === deep);
      if (part.length === 0) continue;
      try {
        const results = await this.run(network, [...new Set(part.map((p) => p.wallet.toLowerCase() as Address))], deep);
        for (const p of part) p.resolve(results.get(p.wallet.toLowerCase())!);
      } catch (e) {
        for (const p of part) p.reject(e);
      }
    }
  }

  private async run(network: Network, wallets: Address[], deep: boolean): Promise<Map<string, VerdictRecord>> {
    const provider = this.o.providers[network];
    if (!provider) throw new Error(`No data provider for ${network}`);
    const cfg = this.config(network);
    const callsBefore = provider.calls;
    const { inputs, transfers } = await provider.gatherMany(wallets);
    const calls = provider.calls - callsBefore;
    const now = this.now();
    this.o.store.addCost(provider.name, network, calls, 0, now);

    const nansen = deep ? this.o.deep : undefined;
    const spent0 = { calls: nansen?.calls ?? 0, usd: nansen?.usd ?? 0 };
    const out = new Map<string, VerdictRecord>();
    const requested = new Set(wallets.map((w) => w.toLowerCase()));
    const funderCounts = new Map<string, number | null>();
    for (const base of inputs) {
      let input = base;
      let nansenUsed = false;
      if (nansen && base.firstFunder) {
        const r = await nansen.firstFunder(base.wallet);
        if (!r.skipped) {
          nansenUsed = true;
          input = { ...base, sources: [{ name: provider.name, firstFunder: base.firstFunder }, { name: nansen.name, firstFunder: r.funder }] };
        }
      }
      let d = decide(input, this.o.salt, cfg);

      // Cross-check the group: how many wallets Nansen sees this funder paying (one call per funder).
      let crossCheck: { funderRecipients?: number } | undefined;
      if (nansen && nansenUsed && d.tier === Tier.Linked && d.firstFunder) {
        const f = d.firstFunder.toLowerCase();
        if (!funderCounts.has(f)) funderCounts.set(f, (await nansen.funderRecipients(d.firstFunder)).recipients);
        const n = funderCounts.get(f);
        if (n !== null && n !== undefined) {
          crossCheck = { funderRecipients: n };
          d = { ...d, reasons: [...d.reasons, `Nansen also sees this funder paying ${n} wallet${n === 1 ? '' : 's'}`] };
        }
      }
      const spend = { calls: (nansen?.calls ?? 0) - spent0.calls, usd: (nansen?.usd ?? 0) - spent0.usd };
      out.set(
        input.wallet.toLowerCase(),
        this.save(network, d, provider.name, calls, false, now, nansenUsed ? 'deep' : 'light', nansenUsed ? { name: nansen!.name, ...spend } : undefined, crossCheck),
      );

      // AN-3: pre-compute the rest of a Linked group, off-chain only.
      if (d.tier === Tier.Linked) {
        for (const m of input.group) {
          if (requested.has(m.wallet.toLowerCase())) continue;
          const md = decide(assembleInput(input.chainId, m.wallet, transfers, cfg), this.o.salt, cfg);
          this.save(network, md, provider.name, 0, true, now, 'light');
        }
      }
    }
    if (nansen) this.o.store.addCost(nansen.name, network, nansen.calls - spent0.calls, nansen.usd - spent0.usd, now);
    return out;
  }

  private save(
    network: Network,
    d: Decision,
    provider: string,
    calls: number,
    precomputed: boolean,
    now: number,
    depth: Depth,
    nansen?: { name: string; calls: number; usd: number },
    crossCheck?: { funderRecipients?: number },
  ): VerdictRecord {
    const providers = [{ name: provider, calls, usd: 0 }, ...(nansen ? [nansen] : [])];
    const bundle = buildEvidenceBundle(d, network, providers, now, crossCheck);
    const hash = evidenceHash(bundle);
    this.o.store.saveEvidence(hash, canonicalJson(bundle));
    const rec: VerdictRecord = {
      wallet: d.wallet.toLowerCase() as Address,
      network,
      tier: d.tier,
      tierName: d.tierName,
      operatorId: d.operatorId,
      groupSize: d.groupSize,
      confidence: d.confidence,
      reasons: d.reasons,
      firstFunder: d.firstFunder?.toLowerCase() as Address | null,
      evidenceHash: hash,
      depth,
      issuedAt: now,
      expiresAt: now + this.ttl,
      precomputed,
      paid: this.o.store.hasPaid(network, d.wallet),
    };
    this.o.store.saveVerdict(rec, now);
    return this.o.store.getVerdict(network, d.wallet) ?? rec;
  }
}

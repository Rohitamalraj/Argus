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
import type { Store, VerdictRecord } from './store.ts';

export interface WalletIntel {
  readonly name: string;
  readonly calls: number;
  gatherMany(wallets: Address[]): Promise<{ inputs: AssessmentInput[]; transfers: Transfer[] }>;
}

export interface AssessorOptions {
  store: Store;
  salt: Hex;
  providers: Partial<Record<Network, WalletIntel>>;
  configs?: Partial<Record<Network, ScoringConfig>>;
  ttlSec?: number;
  /** Requests arriving within this window share one provider round (HyperSync allows ~15 queries a minute). */
  batchWindowMs?: number;
  now?: () => number;
}

type Pending = { wallet: Address; resolve: (v: VerdictRecord) => void; reject: (e: unknown) => void };

/**
 * Light check (AN-1, AN-2): chain data only. Pre-computes verdicts for every member of a Linked
 * group (AN-3), so the next fleet wallet is recognised on its first call.
 */
export class Assessor {
  private queues = new Map<Network, Pending[]>();
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

  /** Cached verdict if still fresh (AN-11), unless `fresh` is set. */
  async assess(network: Network, wallets: Address[], fresh = false): Promise<VerdictRecord[]> {
    return Promise.all(
      wallets.map((w) => {
        const cached = this.o.store.getVerdict(network, w);
        if (!fresh && cached && cached.expiresAt > this.now()) return cached;
        return this.enqueue(network, w);
      }),
    );
  }

  private enqueue(network: Network, wallet: Address): Promise<VerdictRecord> {
    return new Promise((resolve, reject) => {
      const q = this.queues.get(network) ?? [];
      q.push({ wallet, resolve, reject });
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
    try {
      const results = await this.run(network, [...new Set(batch.map((p) => p.wallet.toLowerCase() as Address))]);
      for (const p of batch) p.resolve(results.get(p.wallet.toLowerCase())!);
    } catch (e) {
      for (const p of batch) p.reject(e);
    }
  }

  private async run(network: Network, wallets: Address[]): Promise<Map<string, VerdictRecord>> {
    const provider = this.o.providers[network];
    if (!provider) throw new Error(`No data provider for ${network}`);
    const cfg = this.config(network);
    const callsBefore = provider.calls;
    const { inputs, transfers } = await provider.gatherMany(wallets);
    const calls = provider.calls - callsBefore;
    const now = this.now();
    this.o.store.addCost(provider.name, network, calls, 0, now);

    const out = new Map<string, VerdictRecord>();
    const requested = new Set(wallets.map((w) => w.toLowerCase()));
    for (const input of inputs) {
      const d = decide(input, this.o.salt, cfg);
      out.set(input.wallet.toLowerCase(), this.save(network, d, provider.name, calls, false, now));

      // AN-3: pre-compute the rest of a Linked group, off-chain only.
      if (d.tier === Tier.Linked) {
        for (const m of input.group) {
          if (requested.has(m.wallet.toLowerCase())) continue;
          const md = decide(assembleInput(input.chainId, m.wallet, transfers, cfg), this.o.salt, cfg);
          this.save(network, md, provider.name, 0, true, now);
        }
      }
    }
    return out;
  }

  private save(network: Network, d: Decision, provider: string, calls: number, precomputed: boolean, now: number): VerdictRecord {
    const bundle = buildEvidenceBundle(d, network, [{ name: provider, calls, usd: 0 }], now);
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
      issuedAt: now,
      expiresAt: now + this.ttl,
      precomputed,
      paid: this.o.store.hasPaid(network, d.wallet),
    };
    this.o.store.saveVerdict(rec, now);
    return this.o.store.getVerdict(network, d.wallet) ?? rec;
  }
}

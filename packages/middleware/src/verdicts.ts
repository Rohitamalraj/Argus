import { createPublicClient, http, parseAbi, type PublicClient } from 'viem';
import { monad, monadTestnet } from 'viem/chains';
import type { Address, ArgusNetwork, Hex, TierName, VerdictResolver, VerdictView } from './types.ts';

const TIER_NAMES: TierName[] = ['Unclear', 'Linked', 'Independent', 'Verified'];
const abi = parseAbi([
  'struct Verdict { bytes32 operatorId; uint8 tier; uint16 groupSize; uint64 issuedAt; uint64 expiresAt; bytes32 evidenceHash; }',
  'function verdictOf(address wallet, address attestor) view returns (Verdict)',
]);

export interface VerdictSourceOptions {
  network: ArgusNetwork;
  registry?: Address;
  attestors: Address[];
  rpcUrl?: string;
  analyzerUrl?: string;
  /** Verdicts computed locally; may be slow. Runs in the background and never blocks a lookup. */
  resolver?: VerdictResolver;
  lookupTimeoutMs: number;
  now?: () => number;
}

/** How long a locally computed verdict is reused before it is recomputed. */
const RESOLVED_TTL_MS = 10 * 60_000;

/**
 * MW-2: local cache, then the registry for trusted attestors in priority order, then the analyzer
 * (which also serves pre-computed fleet verdicts) within a short time limit. Expired reads as none.
 * Any failure reads as none, so a lookup never blocks a paying request (MW-7).
 */
export class VerdictSource {
  private cache = new Map<string, { v?: VerdictView; until: number }>();
  private inflight = new Map<string, Promise<VerdictView | undefined>>();
  private client?: PublicClient;
  private now: () => number;

  constructor(private readonly o: VerdictSourceOptions) {
    this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
    if (o.registry && o.attestors.length > 0) {
      const chain = o.network === 'mainnet' ? monad : monadTestnet;
      this.client = createPublicClient({ chain, transport: http(o.rpcUrl || chain.rpcUrls.default.http[0], { timeout: o.lookupTimeoutMs * 3 }) }) as PublicClient;
    }
  }

  async lookup(wallet: Address): Promise<VerdictView | undefined> {
    const key = wallet.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now() && (!hit.v || hit.v.expiresAt > this.now())) {
      return hit.v && { ...hit.v, source: 'cache' };
    }
    const v = (await this.fromRegistry(wallet)) ?? (await this.fromAnalyzer(wallet)) ?? (await this.fromResolver(wallet));
    // Found verdicts are cached for a minute, misses for a few seconds so a new verdict is picked up quickly.
    // A local resolver may still be working, and caches its own answer when it finishes: do not overwrite that.
    if (v || !this.cache.get(key)?.v) this.cache.set(key, { v, until: Date.now() + (v ? (v.source === 'local' ? RESOLVED_TTL_MS : 60_000) : 1_000) });
    return v;
  }

  /**
   * Run the local resolver once per wallet at a time. If it answers within the lookup limit the verdict is used now;
   * if not, the lookup reads as none (the first call is optimistic) and the answer is cached for the next request.
   */
  private fromResolver(wallet: Address): Promise<VerdictView | undefined> {
    if (!this.o.resolver) return Promise.resolve(undefined);
    const key = wallet.toLowerCase();
    let run = this.inflight.get(key);
    if (!run) {
      run = this.o
        .resolver(wallet)
        .then((v): VerdictView | undefined => {
          if (!v) return undefined;
          const view: VerdictView = { ...v, source: 'local' };
          this.cache.set(key, { v: view, until: Date.now() + RESOLVED_TTL_MS });
          return view;
        })
        .catch(() => undefined)
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, run);
    }
    return Promise.race([run, new Promise<undefined>((r) => setTimeout(() => r(undefined), this.o.lookupTimeoutMs).unref())]);
  }

  /** Forget a wallet, e.g. after the analyzer reports a new verdict. */
  invalidate(wallet: Address) {
    this.cache.delete(wallet.toLowerCase());
  }

  private async fromRegistry(wallet: Address): Promise<VerdictView | undefined> {
    if (!this.client || !this.o.registry) return;
    for (const attestor of this.o.attestors) {
      try {
        const v = await this.client.readContract({ address: this.o.registry, abi, functionName: 'verdictOf', args: [wallet, attestor] });
        if (v.tier !== 0 && Number(v.expiresAt) > this.now()) {
          return { tier: v.tier, tierName: TIER_NAMES[v.tier] ?? 'Unclear', operatorId: v.operatorId, expiresAt: Number(v.expiresAt), source: 'registry' };
        }
      } catch {
        // registry unreachable: fall through to the analyzer
      }
    }
  }

  private async fromAnalyzer(wallet: Address): Promise<VerdictView | undefined> {
    if (!this.o.analyzerUrl) return;
    try {
      const r = await fetch(`${this.o.analyzerUrl}/v1/wallet/${wallet}?network=${this.o.network}`, {
        signal: AbortSignal.timeout(this.o.lookupTimeoutMs),
      });
      if (!r.ok) return;
      const v = (await r.json()) as { tier: number; tierName: TierName; operatorId: Hex; confidence: string; reasons: string[]; expiresAt: number };
      if (v.tier === 0 || v.expiresAt <= this.now()) return;
      return { tier: v.tier, tierName: v.tierName, operatorId: v.operatorId, confidence: v.confidence, reasons: v.reasons, expiresAt: v.expiresAt, source: 'analyzer' };
    } catch {
      return;
    }
  }
}

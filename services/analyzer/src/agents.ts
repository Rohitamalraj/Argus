import type { AgentReputation } from '@argus/sdk';
import type { Network } from './networks.ts';

export type ComputeReputation = (network: Network, agentId: string, sample: number) => Promise<AgentReputation>;

/**
 * ERC-8004 reputation lookups, cached. A lookup traces thousands of wallets on a large agent, so the
 * same (network, agent, sample) is computed once per TTL and concurrent requests share one run.
 */
export class AgentReputationService {
  private cache = new Map<string, { at: number; value: AgentReputation }>();
  private inflight = new Map<string, Promise<AgentReputation>>();

  constructor(
    private readonly compute: ComputeReputation,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(network: Network, agentId: string, sample: number): Promise<{ reputation: AgentReputation; cached: boolean }> {
    const key = `${network}:${agentId}:${sample}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return { reputation: hit.value, cached: true };
    let run = this.inflight.get(key);
    if (!run) {
      run = this.compute(network, agentId, sample)
        .then((value) => {
          this.cache.set(key, { at: this.now(), value });
          return value;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, run);
    }
    return { reputation: await run, cached: false };
  }
}

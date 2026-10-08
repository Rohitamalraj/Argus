import type { Address } from '@argus/scoring';
import { registryAbi } from './registry.ts';
import type { Network } from './networks.ts';
import type { Signer } from './signer.ts';
import type { Store } from './store.ts';

/**
 * Publishes verdicts of wallets that paid a seller (AN-7), in batches, on the registry of the
 * evidence's network. Re-publishes when a paid wallet's verdict changes (AN-4).
 */
export class Publisher {
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly network: Network,
    private readonly store: Store,
    private readonly signer: Signer,
    private readonly registry: Address,
    private readonly intervalMs = 3000,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async flush(): Promise<string | undefined> {
    if (this.busy) return;
    const pending = this.store.pendingPublish(this.network).slice(0, 50);
    if (pending.length === 0) return;
    this.busy = true;
    try {
      const hash = await this.signer.writeContract({
        address: this.registry,
        abi: registryAbi,
        functionName: 'attestBatch',
        args: [
          pending.map((v) => v.wallet),
          pending.map((v) => ({
            operatorId: v.operatorId,
            tier: v.tier,
            groupSize: Math.min(v.groupSize, 65_535),
            issuedAt: BigInt(v.issuedAt),
            expiresAt: BigInt(v.expiresAt),
            evidenceHash: v.evidenceHash,
          })),
        ],
      });
      const status = await this.signer.waitForReceipt(hash);
      if (status === 'success') this.store.markPublished(this.network, pending, hash);
      this.log(`[publish ${this.network}] ${pending.length} verdict(s) ${status} ${hash}`);
      return hash;
    } catch (e) {
      this.log(`[publish ${this.network}] failed: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      this.busy = false;
    }
  }
}

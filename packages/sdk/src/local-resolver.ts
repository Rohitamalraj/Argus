import type { Address, Hex, TierName } from '@argus/scoring';
import type { Argus } from './argus.ts';

/** What the middleware's `resolver` option expects back (the shape of its verdict, minus where it came from). */
export interface LocalVerdict {
  tier: number;
  tierName: TierName;
  operatorId: Hex;
  confidence: string;
  reasons: string[];
  expiresAt: number;
}

export interface LocalResolverOptions {
  /** How long a verdict is good for, in seconds. Default one hour: recomputing is free and always current. */
  ttlSec?: number;
  /** Wallets that arrive within this window are checked together. Default 300 ms. */
  batchWindowMs?: number;
  now?: () => number;
}

/**
 * Turn the SDK into a verdict source for `argus-x402-middleware`, so a seller needs no Argus server at all:
 *
 *   const a = createArgus({ network: 'mainnet', hypersyncToken });
 *   app.use(argus({ ..., resolver: localResolver(a) }));
 *
 * Verdicts are recomputed from public chain data. Wallets that arrive close together share a few HyperSync
 * queries; a wallet already waiting is not asked for twice.
 */
export function localResolver(argus: Pick<Argus, 'checkWallets'>, opts: LocalResolverOptions = {}): (wallet: Address) => Promise<LocalVerdict> {
  const ttl = opts.ttlSec ?? 3600;
  const windowMs = opts.batchWindowMs ?? 300;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const waiting = new Map<string, { resolve: (v: LocalVerdict) => void; reject: (e: unknown) => void }[]>();
  let timer: NodeJS.Timeout | undefined;

  const flush = async () => {
    timer = undefined;
    const batch = new Map(waiting);
    waiting.clear();
    const wallets = [...batch.keys()] as Address[];
    try {
      const decisions = await argus.checkWallets(wallets);
      decisions.forEach((d, i) => {
        const verdict: LocalVerdict = {
          tier: d.tier,
          tierName: d.tierName,
          operatorId: d.operatorId,
          confidence: d.confidence,
          reasons: d.reasons,
          expiresAt: now() + ttl,
        };
        for (const w of batch.get(wallets[i]!)!) w.resolve(verdict);
      });
    } catch (e) {
      for (const list of batch.values()) for (const w of list) w.reject(e);
    }
  };

  return (wallet) =>
    new Promise<LocalVerdict>((resolve, reject) => {
      const key = wallet.toLowerCase();
      waiting.set(key, [...(waiting.get(key) ?? []), { resolve, reject }]);
      timer ??= setTimeout(() => void flush(), windowMs);
    });
}

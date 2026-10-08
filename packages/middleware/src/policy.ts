import type { Address, ArgusPolicy, VerdictView } from './types.ts';

export const DEFAULT_POLICY: ArgusPolicy = {
  promoCalls: 20,
  promoPerOperator: true,
  unclear: 'standard-price',
  optimisticFirstCall: true,
};

/** Promo counters. In memory by default; one instance per seller. */
export interface PromoStore {
  used(key: string): number;
  consume(key: string): void;
}

export class MemoryPromoStore implements PromoStore {
  private m = new Map<string, number>();
  used(key: string) {
    return this.m.get(key) ?? 0;
  }
  consume(key: string) {
    this.m.set(key, this.used(key) + 1);
  }
}

export interface Quote {
  price: 'promo' | 'standard';
  /** Counter the promo is charged to, when the price is promo. */
  key?: string;
  promoLeft: number;
  reason: string;
}

/**
 * MW-3: per-operator promo for Linked, per-wallet for Independent and Verified, standard for Unclear.
 * Pure: reads counters, never changes them (counters move only after a payment settles).
 */
export function quote(
  payer: Address | undefined,
  verdict: VerdictView | undefined,
  opts: { policy: ArgusPolicy; store: PromoStore; ns: string; mismatch?: boolean },
): Quote {
  const { policy, store, ns } = opts;
  if (!payer) return { price: 'standard', promoLeft: 0, reason: 'No payer address sent' };
  if (opts.mismatch) return { price: 'standard', promoLeft: 0, reason: 'Signed payer differs from the claimed payer' };
  const w = payer.toLowerCase();

  if (!verdict) {
    const key = `${ns}:optimistic:${w}`;
    if (policy.optimisticFirstCall && store.used(key) === 0) {
      return { price: 'promo', key, promoLeft: 1, reason: 'First call while the wallet is assessed' };
    }
    return { price: 'standard', promoLeft: 0, reason: 'Waiting for a verdict' };
  }

  let key: string;
  switch (verdict.tierName) {
    case 'Linked':
      key = policy.promoPerOperator ? `${ns}:op:${verdict.operatorId}` : `${ns}:w:${w}`;
      break;
    case 'Independent':
    case 'Verified':
      key = `${ns}:w:${w}`;
      break;
    default:
      return { price: 'standard', promoLeft: 0, reason: 'Unclear wallets pay the standard price' };
  }
  const left = Math.max(0, policy.promoCalls - store.used(key));
  if (left === 0) {
    return {
      price: 'standard',
      promoLeft: 0,
      reason: verdict.tierName === 'Linked' ? "The operator's shared promo is used up" : 'Promo used up',
    };
  }
  return {
    price: 'promo',
    key,
    promoLeft: left,
    reason: verdict.tierName === 'Linked' ? 'Promo shared by all wallets of this operator' : 'Own promo',
  };
}

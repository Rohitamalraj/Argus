export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type ArgusNetwork = 'testnet' | 'mainnet';
export type TierName = 'Unclear' | 'Linked' | 'Independent' | 'Verified';

export interface ArgusPolicy {
  /** Promo calls per allowance. Default 20. */
  promoCalls: number;
  /** One allowance shared by all wallets of a Linked operator. Default true. */
  promoPerOperator: boolean;
  /** Unclear wallets pay the standard price. */
  unclear: 'standard-price';
  /** Give a wallet with no verdict anywhere one promo call while it is assessed (MW-4). Default true. */
  optimisticFirstCall: boolean;
}

/** Promo counters. Synchronous on purpose: the quote path reads them on every request. */
export interface PromoStore {
  used(key: string): number;
  consume(key: string): void;
}

/**
 * Works out a wallet's verdict yourself, with no Argus server: for example the SDK's `localResolver`, which recomputes
 * it from public chain data. It may take seconds; the middleware never waits for it (the first call is optimistic) and
 * uses the answer once it arrives.
 */
export type VerdictResolver = (wallet: Address) => Promise<Omit<VerdictView, 'source'> | undefined>;

export interface ArgusOptions {
  network: ArgusNetwork;
  /** Seller wallet that receives payments. */
  payTo: Address;
  /** Prices in USD, e.g. { standard: '$0.01', promo: '$0.005' }. */
  price: { standard: string; promo: string };
  /** Protected routes, e.g. ['GET /api/premium']. */
  routes: string[];
  policy?: Partial<ArgusPolicy>;
  /** Trusted attestors in priority order; the first with a fresh verdict wins. */
  attestors?: Address[];
  /** PayerAttestations registry; defaults to the deployed one for the network. */
  registry?: Address;
  rpcUrl?: string;
  analyzerUrl?: string;
  /** Verdicts computed locally (see VerdictResolver). Tried after the registry and the analyzer. */
  resolver?: VerdictResolver;
  /** Where promo counters live. Default: in memory, which a restart resets. Use FilePromoStore to keep them. */
  store?: PromoStore;
  facilitatorUrl?: string;
  /** Name the analyzer sees in payment reports. */
  seller?: string;
  /** Prefix for promo counters; lets a demo run start from zero. */
  namespace?: (req: import('express').Request) => string;
  lookupTimeoutMs?: number;
  description?: string;
  log?: (msg: string) => void;
}

/** A verdict as the middleware sees it. */
export interface VerdictView {
  tier: number;
  tierName: TierName;
  operatorId: Hex;
  confidence?: string;
  reasons?: string[];
  expiresAt: number;
  source: 'cache' | 'registry' | 'analyzer' | 'local';
}

/** MW-6: what the route handler sees on req.argus. */
export interface ArgusInfo {
  payer?: Address;
  tier: number;
  tierName: TierName | 'Unknown';
  operatorId?: Hex;
  confidence?: string;
  reasons: string[];
  hints: string[];
  price: 'promo' | 'standard';
  promoLeft: number;
  verdictSource?: VerdictView['source'];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      argus?: ArgusInfo;
    }
  }
}

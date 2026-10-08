import { DEFAULT_CONFIG, type ScoringConfig } from './config.ts';
import type { Address, Transfer } from './types.ts';

/**
 * Private seller hints (SC-5). Computed from one seller's own logs, shown only to that seller,
 * and never part of the published verdict or its tier.
 */
export interface SellerRequest {
  wallet: Address;
  /** unix seconds */
  ts: number;
}

export interface Hint {
  code: 'flat-clock' | 'one-payee';
  text: string;
}

export function sellerHints(
  wallet: Address,
  requests: SellerRequest[],
  walletOutflows: Transfer[],
  seller: Address,
  cfg: ScoringConfig = DEFAULT_CONFIG,
): Hint[] {
  const hints: Hint[] = [];
  const mine = requests.filter((r) => r.wallet.toLowerCase() === wallet.toLowerCase());

  // Flat clock: traffic spread evenly over all 24 hours, which people rarely do.
  if (mine.length >= cfg.hintFlatClockMinRequests) {
    const hours = new Array<number>(24).fill(0);
    for (const r of mine) hours[new Date(r.ts * 1000).getUTCHours()]!++;
    const mean = mine.length / 24;
    const sd = Math.sqrt(hours.reduce((s, h) => s + (h - mean) ** 2, 0) / 24);
    const cv = sd / mean;
    if (cv <= cfg.hintFlatClockAmplitude) {
      hints.push({ code: 'flat-clock', text: `Requests are spread evenly across all 24 hours (variation ${cv.toFixed(2)})` });
    }
  }

  // One payee: nearly all of the wallet's spending goes to this seller.
  const out = walletOutflows.filter((t) => t.from.toLowerCase() === wallet.toLowerCase());
  const total = out.reduce((s, t) => s + t.amount, 0n);
  if (total > 0n) {
    const toSeller = out.filter((t) => t.to.toLowerCase() === seller.toLowerCase()).reduce((s, t) => s + t.amount, 0n);
    const share = Number((toSeller * 10_000n) / total) / 10_000;
    if (share >= cfg.hintConcentrationShare) {
      hints.push({ code: 'one-payee', text: `${Math.round(share * 100)}% of this wallet's USDC spending goes to you` });
    }
  }
  return hints;
}

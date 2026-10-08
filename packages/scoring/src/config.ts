import type { Address } from './types.ts';

/** USDC has 6 decimals. */
export const usdc = (dollars: number): bigint => BigInt(Math.round(dollars * 1_000_000));

/** Starting values to tune on the test set (PRD: Configuration defaults). */
export interface ScoringConfig {
  /** Smallest inbound transfer that counts as funding; ignores dust. */
  minFunding: bigint;
  /** S1: smallest funded group that can be Linked. */
  minGroupSize: number;
  /** A funder with more than this many qualifying recipients is a hub. */
  hubRecipientThreshold: number;
  /** A recipient only counts toward the hub threshold at or above this amount. */
  hubMinTransfer: bigint;
  /** Known hubs (facilitator, faucet, USDC mint, exchanges, bridges). Lowercase. */
  knownHubs: ReadonlySet<string>;
  /** Addresses that never count as the "one shared address" in S4 (e.g. x402 sellers). Lowercase. */
  closureExclude: ReadonlySet<string>;
  /** S2: identical instalments to at least this many wallets... */
  instalmentWallets: number;
  /** ...within this window... */
  instalmentWindowHours: number;
  /** ...with amounts within this fraction of each other. */
  instalmentTolerance: number;
  /** S3: share of G(F) first active on one UTC day. */
  syncActivationShare: number;
  /** S4: share of G(F) outflow value going back to F or to one shared address. */
  closureShare: number;
  /** Private seller hints. */
  hintFlatClockAmplitude: number;
  hintFlatClockMinRequests: number;
  hintConcentrationShare: number;
}

export const DEFAULT_CONFIG: ScoringConfig = {
  minFunding: usdc(0.01),
  minGroupSize: 3,
  hubRecipientThreshold: 200,
  hubMinTransfer: usdc(0.1),
  knownHubs: new Set(),
  closureExclude: new Set(),
  instalmentWallets: 3,
  instalmentWindowHours: 24,
  instalmentTolerance: 0.01,
  syncActivationShare: 0.7,
  closureShare: 0.9,
  hintFlatClockAmplitude: 0.15,
  hintFlatClockMinRequests: 50,
  hintConcentrationShare: 0.9,
};

export function makeConfig(
  overrides: Partial<Omit<ScoringConfig, 'knownHubs' | 'closureExclude'>> & {
    knownHubs?: Iterable<Address | string>;
    closureExclude?: Iterable<Address | string>;
  } = {},
): ScoringConfig {
  const { knownHubs, closureExclude, ...rest } = overrides;
  return {
    ...DEFAULT_CONFIG,
    ...rest,
    knownHubs: lowerSet(knownHubs ?? DEFAULT_CONFIG.knownHubs),
    closureExclude: lowerSet(closureExclude ?? DEFAULT_CONFIG.closureExclude),
  };
}

const lowerSet = (xs: Iterable<string>): ReadonlySet<string> => new Set([...xs].map((x) => x.toLowerCase()));

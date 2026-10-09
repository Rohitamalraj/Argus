export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export const Tier = {
  Unclear: 0,
  Linked: 1,
  Independent: 2,
  Verified: 3,
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

export const TIER_NAMES: Record<Tier, TierName> = {
  0: 'Unclear',
  1: 'Linked',
  2: 'Independent',
  3: 'Verified',
};
export type TierName = 'Unclear' | 'Linked' | 'Independent' | 'Verified';

export type Confidence = 'high' | 'medium' | 'low';

/** A USDC transfer. `amount` is in base units (6 decimals). `timestamp` is unix seconds. */
export interface Transfer {
  from: Address;
  to: Address;
  amount: bigint;
  timestamp: number;
  txHash?: Hex;
}

/** One wallet in the funded group G(F). */
export interface GroupMember {
  wallet: Address;
  /** Time of the first-funding transfer from F. */
  firstFundedAt: number;
  /** First time the wallet sent USDC. Falls back to firstFundedAt when it never sent anything. */
  firstActiveAt?: number;
}

/** What one data source says about the wallet's first funder, for the agreement check (PV-4). */
export interface SourceView {
  name: string;
  firstFunder: Address | null;
}

/**
 * Everything the decision rule needs, built by the providers from public chain data.
 * Only public, seller-independent evidence goes here, so every seller gets the same verdict.
 */
export interface AssessmentInput {
  chainId: number;
  wallet: Address;
  /** Sender of the earliest inbound USDC >= minFunding; null when no funding trace was found. */
  firstFunder: Address | null;
  /** Distinct recipients that received >= hubMinTransfer from F (see countHubRecipients). */
  funderRecipientCount: number;
  /** G(F): every wallet whose first funder is F, including `wallet`. */
  group: GroupMember[];
  /** Transfers from F to members of G(F); used for identical instalments (S2). */
  funderTransfers: Transfer[];
  /** USDC transfers sent by members of G(F); used for value closure (S4). */
  groupOutflows: Transfer[];
  /** Per-source first-funder views when more than one provider answered. */
  sources?: SourceView[];
  /** Set when a provider failed; forces Unclear. */
  dataError?: string;
  /** The asset the funding was traced in. Defaults to USDC with 6 decimals. */
  asset?: { symbol: string; decimals: number };
  /**
   * Context concentration (S5): what share of a context set of wallets (for example every feedback client
   * of one ERC-8004 agent) were first funded by this funder. Public chain data only.
   */
  concentration?: { share: number; wallets: number; context: string };
}

export interface Signals {
  S1: boolean;
  S2: boolean;
  S3: boolean;
  S4: boolean;
  /** Only present when a context set was supplied. */
  S5?: boolean;
}

export type Agreement = 'both-sources' | 'single-source' | 'disagree';

export interface Decision {
  wallet: Address;
  tier: Tier;
  tierName: TierName;
  confidence: Confidence;
  operatorId: Hex;
  groupSize: number;
  firstFunder: Address | null;
  funderIsHub: boolean;
  signals: Signals;
  agreement: Agreement;
  reasons: string[];
}

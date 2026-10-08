import { DEFAULT_CONFIG, type ScoringConfig } from './config.ts';
import { UNCLEAR_OPERATOR, operatorIdFor } from './operatorId.ts';
import { isHub, s1SharedFunder, s2IdenticalInstalments, s3SyncActivation, s4ValueClosure } from './signals.ts';
import {
  TIER_NAMES,
  Tier,
  type Agreement,
  type AssessmentInput,
  type Confidence,
  type Decision,
  type Hex,
  type Signals,
} from './types.ts';

const NO_SIGNALS: Signals = { S1: false, S2: false, S3: false, S4: false };

/** Tier from the four signals alone (funding already traced, sources not in conflict). */
export function classify(s: Signals): { tier: Tier; fleetSignals: number } {
  const fleetSignals = s.S1 ? [s.S2, s.S3, s.S4].filter(Boolean).length : 0;
  if (!s.S1) return { tier: Tier.Independent, fleetSignals };
  return { tier: fleetSignals > 0 ? Tier.Linked : Tier.Unclear, fleetSignals };
}

/**
 * The decision rule (PRD: Solution / Decision rule).
 *   Linked      = S1 and at least one of S2, S3, S4
 *   Independent = funding traced, and S1 is false
 *   Unclear     = everything else, including S1 alone
 * Wallet age is never an input. Deterministic: the same evidence gives the same verdict.
 */
export function decide(input: AssessmentInput, salt: Hex, cfg: ScoringConfig = DEFAULT_CONFIG): Decision {
  const wallet = input.wallet;
  const groupSize = new Set([wallet, ...input.group.map((m) => m.wallet)].map((a) => a.toLowerCase())).size;
  const base = { wallet, groupSize, firstFunder: input.firstFunder };

  if (input.dataError) {
    return unclear(base, false, NO_SIGNALS, 'single-source', [`Data error: ${input.dataError}`]);
  }
  if (!input.firstFunder) {
    return unclear(base, false, NO_SIGNALS, 'single-source', ['No USDC funding trace found']);
  }

  const agreement = agreementOf(input);
  const { hub, known } = isHub(input.firstFunder, input.funderRecipientCount, cfg);

  if (agreement.kind === 'disagree') {
    return unclear(base, hub, NO_SIGNALS, 'disagree', [agreement.reason]);
  }

  const S1 = s1SharedFunder(groupSize, hub, cfg);
  const s2 = s2IdenticalInstalments(input, cfg);
  const s3 = s3SyncActivation(input.group, cfg);
  const s4 = s4ValueClosure(input, cfg);
  const signals: Signals = { S1, S2: S1 && s2.hit, S3: S1 && s3.hit, S4: S1 && s4.hit };
  const { tier, fleetSignals } = classify(signals);

  if (tier === Tier.Independent) {
    const reasons = hub
      ? [known ? 'First USDC funder is a known hub (exchange, bridge, faucet or facilitator)' : `First USDC funder is a hub (${input.funderRecipientCount} recipients)`, 'Hubs never link wallets']
      : [groupSize < 2 ? 'No other wallet shares its first USDC funder' : `First USDC funder seeded only ${groupSize} wallets (below ${cfg.minGroupSize})`];
    const confidence: Confidence = known || agreement.kind === 'both-sources' ? 'high' : 'medium';
    if (agreement.kind === 'both-sources') reasons.push(`Sources agree on the first funder: ${agreement.names.join(', ')}`);
    return {
      ...base,
      tier: Tier.Independent,
      tierName: TIER_NAMES[Tier.Independent],
      confidence,
      operatorId: operatorIdFor(input.chainId, wallet, salt),
      funderIsHub: hub,
      signals,
      agreement: agreement.kind,
      reasons,
    };
  }

  const reasons = [`First USDC funder also seeded ${groupSize - 1} other wallet${groupSize - 1 === 1 ? '' : 's'}`];
  if (signals.S2) reasons.push(`Funded in identical ${fmtUsdc(s2.amount!)} USDC amounts to ${s2.wallets} wallets within ${fmtSpan(s2.spanSec!)}`);
  if (signals.S3) reasons.push(`${s3.sameDay} of ${s3.total} became active on the same day`);
  if (signals.S4) reasons.push(`${Math.round(s4.share * 100)}% of the group's outflows go to ${s4.sink === input.firstFunder?.toLowerCase() ? 'the funder' : 'one shared address'}`);

  if (tier === Tier.Unclear) {
    reasons.push('Shared funder alone is not enough to link wallets');
    return unclear(base, hub, signals, agreement.kind, reasons);
  }
  if (agreement.kind === 'both-sources') reasons.push(`Sources agree on the first funder: ${agreement.names.join(', ')}`);
  return {
    ...base,
    tier: Tier.Linked,
    tierName: TIER_NAMES[Tier.Linked],
    confidence: fleetSignals >= 2 ? 'high' : 'medium',
    operatorId: operatorIdFor(input.chainId, input.firstFunder, salt),
    funderIsHub: false,
    signals,
    agreement: agreement.kind,
    reasons,
  };
}

function unclear(
  base: Pick<Decision, 'wallet' | 'groupSize' | 'firstFunder'>,
  funderIsHub: boolean,
  signals: Signals,
  agreement: Agreement,
  reasons: string[],
): Decision {
  return {
    ...base,
    tier: Tier.Unclear,
    tierName: TIER_NAMES[Tier.Unclear],
    confidence: 'low',
    operatorId: UNCLEAR_OPERATOR,
    funderIsHub,
    signals,
    agreement,
    reasons,
  };
}

type AgreementResult =
  | { kind: 'single-source' }
  | { kind: 'both-sources'; names: string[] }
  | { kind: 'disagree'; reason: string };

/** PV-4: agreement raises confidence; disagreement sets Unclear with a reason. A source with no answer has no vote. */
function agreementOf(input: AssessmentInput): AgreementResult {
  const voting = (input.sources ?? []).filter((s) => s.firstFunder !== null);
  if (voting.length < 2) return { kind: 'single-source' };
  const funders = new Set(voting.map((s) => s.firstFunder!.toLowerCase()));
  if (funders.size === 1) return { kind: 'both-sources', names: voting.map((s) => s.name) };
  return {
    kind: 'disagree',
    reason: `Sources disagree on the first funder (${voting.map((s) => `${s.name}: ${s.firstFunder}`).join('; ')})`,
  };
}

export function fmtUsdc(amount: bigint): string {
  const n = Number(amount) / 1_000_000;
  return n >= 0.01 ? n.toFixed(2) : n.toFixed(6);
}

function fmtSpan(sec: number): string {
  if (sec < 120) return `${sec} seconds`;
  if (sec < 7200) return `${Math.round(sec / 60)} minutes`;
  return `${Math.round(sec / 3600)} hours`;
}

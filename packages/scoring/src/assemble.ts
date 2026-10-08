import { DEFAULT_CONFIG, type ScoringConfig } from './config.ts';
import { countHubRecipients } from './signals.ts';
import type { Address, AssessmentInput, GroupMember, Transfer } from './types.ts';

const lc = (a: string) => a.toLowerCase();

/** Earliest inbound transfer of at least minFunding. Ties break on txHash so the result is deterministic. */
export function firstFunding(transfers: Transfer[], wallet: Address, minFunding: bigint): Transfer | null {
  const w = lc(wallet);
  let best: Transfer | null = null;
  for (const t of transfers) {
    if (lc(t.to) !== w || lc(t.from) === w || t.amount < minFunding) continue;
    if (!best || t.timestamp < best.timestamp || (t.timestamp === best.timestamp && (t.txHash ?? '') < (best.txHash ?? ''))) {
      best = t;
    }
  }
  return best;
}

/**
 * Build the scoring input from raw USDC transfers. The transfers must cover: inbound transfers to the
 * wallet, everything F sent, inbound transfers to each of F's recipients, and their outflows.
 * Providers (HyperSync, Nansen, RPC) fetch the transfers; this function is the same for all of them.
 */
export function assembleInput(
  chainId: number,
  wallet: Address,
  transfers: Transfer[],
  cfg: ScoringConfig = DEFAULT_CONFIG,
): AssessmentInput {
  const funding = firstFunding(transfers, wallet, cfg.minFunding);
  if (!funding) {
    return { chainId, wallet, firstFunder: null, funderRecipientCount: 0, group: [], funderTransfers: [], groupOutflows: [] };
  }
  const F = funding.from;
  const f = lc(F);
  const funderRecipientCount = countHubRecipients(transfers, F, cfg.hubMinTransfer);

  // A hub never links anyone, so its recipients are not a group.
  if (cfg.knownHubs.has(f) || funderRecipientCount > cfg.hubRecipientThreshold) {
    return {
      chainId,
      wallet,
      firstFunder: F,
      funderRecipientCount,
      group: [{ wallet, firstFundedAt: funding.timestamp }],
      funderTransfers: [funding],
      groupOutflows: [],
    };
  }

  const recipients = new Set(transfers.filter((t) => lc(t.from) === f).map((t) => lc(t.to)));
  recipients.add(lc(wallet));

  const group: GroupMember[] = [];
  for (const r of [...recipients].sort()) {
    const ff = firstFunding(transfers, r as Address, cfg.minFunding);
    if (!ff || lc(ff.from) !== f) continue;
    const firstOut = transfers.filter((t) => lc(t.from) === r).reduce<number | undefined>((m, t) => (m === undefined || t.timestamp < m ? t.timestamp : m), undefined);
    group.push({ wallet: r as Address, firstFundedAt: ff.timestamp, firstActiveAt: firstOut ?? ff.timestamp });
  }
  const members = new Set(group.map((m) => lc(m.wallet)));

  return {
    chainId,
    wallet,
    firstFunder: F,
    funderRecipientCount,
    group,
    funderTransfers: transfers.filter((t) => lc(t.from) === f && members.has(lc(t.to))),
    groupOutflows: transfers.filter((t) => members.has(lc(t.from))),
  };
}

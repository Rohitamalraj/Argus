import type { ScoringConfig } from './config.ts';
import type { Address, AssessmentInput, GroupMember, Transfer } from './types.ts';

const lc = (a: string) => a.toLowerCase();
const DAY = 86_400;

/**
 * Distinct recipients that received at least `minTransfer` in a single transfer from `funder`.
 * Dust does not count, so spraying 0.001 USDC to thousands of wallets does not fake a hub.
 */
export function countHubRecipients(transfers: Transfer[], funder: Address, minTransfer: bigint): number {
  const f = lc(funder);
  const seen = new Set<string>();
  for (const t of transfers) {
    if (lc(t.from) === f && t.amount >= minTransfer) seen.add(lc(t.to));
  }
  return seen.size;
}

/** Hub: on the known-hub list, or more than the threshold of qualifying recipients. A hub never links anyone. */
export function isHub(funder: Address, recipientCount: number, cfg: ScoringConfig): { hub: boolean; known: boolean } {
  const known = cfg.knownHubs.has(lc(funder));
  return { hub: known || recipientCount > cfg.hubRecipientThreshold, known };
}

/** S1 shared bespoke funder: F is not a hub and G(F) has at least minGroupSize wallets. */
export function s1SharedFunder(groupSize: number, funderIsHub: boolean, cfg: ScoringConfig): boolean {
  return !funderIsHub && groupSize >= cfg.minGroupSize;
}

/**
 * S2 identical instalments: F sent equal amounts (within tolerance) to at least `instalmentWallets`
 * distinct members of G(F) within `instalmentWindowHours`.
 * Returns the size of the largest matching set (0 when none qualifies).
 */
export function s2IdenticalInstalments(input: AssessmentInput, cfg: ScoringConfig): { hit: boolean; wallets: number; amount?: bigint; spanSec?: number } {
  if (!input.firstFunder) return { hit: false, wallets: 0 };
  const f = lc(input.firstFunder);
  const members = new Set(input.group.map((m) => lc(m.wallet)));
  const xs = input.funderTransfers
    .filter((t) => lc(t.from) === f && members.has(lc(t.to)) && t.amount > 0n)
    .sort((a, b) => a.timestamp - b.timestamp || cmp(a.amount, b.amount));

  const tolBps = BigInt(Math.round(cfg.instalmentTolerance * 10_000));
  const window = cfg.instalmentWindowHours * 3600;
  let best: { wallets: number; amount?: bigint; spanSec?: number } = { wallets: 0 };

  for (const anchor of xs) {
    const near = (t: Transfer) => abs(t.amount - anchor.amount) * 10_000n <= tolBps * anchor.amount;
    // every transfer close in amount to the anchor, starting no earlier than the anchor, inside the window
    const inWindow = xs.filter((t) => near(t) && t.timestamp >= anchor.timestamp && t.timestamp - anchor.timestamp <= window);
    const wallets = new Set(inWindow.map((t) => lc(t.to)));
    if (wallets.size > best.wallets) {
      const last = Math.max(...inWindow.map((t) => t.timestamp));
      best = { wallets: wallets.size, amount: anchor.amount, spanSec: last - anchor.timestamp };
    }
  }
  return { hit: best.wallets >= cfg.instalmentWallets, ...best };
}

/** S3 synchronized activation: at least syncActivationShare of G(F) first active on the same UTC day. */
export function s3SyncActivation(group: GroupMember[], cfg: ScoringConfig): { hit: boolean; sameDay: number; total: number } {
  const total = group.length;
  if (total === 0) return { hit: false, sameDay: 0, total };
  const perDay = new Map<number, number>();
  for (const m of group) {
    const day = Math.floor((m.firstActiveAt ?? m.firstFundedAt) / DAY);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const sameDay = Math.max(...perDay.values());
  return { hit: total >= cfg.minGroupSize && sameDay / total >= cfg.syncActivationShare, sameDay, total };
}

/**
 * S4 value closure: at least closureShare of G(F)'s outflow value goes back to F, or to one shared address.
 * Hubs and excluded addresses (e.g. x402 sellers everyone pays) cannot be the shared address.
 * Transfers between members of the group are ignored.
 */
export function s4ValueClosure(input: AssessmentInput, cfg: ScoringConfig): { hit: boolean; share: number; sink?: Address } {
  const members = new Set(input.group.map((m) => lc(m.wallet)));
  const f = input.firstFunder ? lc(input.firstFunder) : undefined;
  let total = 0n;
  let toFunder = 0n;
  const perSink = new Map<string, bigint>();
  for (const t of input.groupOutflows) {
    const from = lc(t.from);
    const to = lc(t.to);
    if (!members.has(from) || members.has(to)) continue;
    total += t.amount;
    if (to === f) {
      toFunder += t.amount;
    } else if (!cfg.knownHubs.has(to) && !cfg.closureExclude.has(to)) {
      perSink.set(to, (perSink.get(to) ?? 0n) + t.amount);
    }
  }
  if (total === 0n) return { hit: false, share: 0 };

  let sink: string | undefined = f;
  let sinkValue = toFunder;
  for (const [addr, v] of perSink) {
    if (v > sinkValue) {
      sink = addr;
      sinkValue = v;
    }
  }
  const share = Number((sinkValue * 1_000_000n) / total) / 1_000_000;
  return { hit: share >= cfg.closureShare, share, sink: sink as Address | undefined };
}

const abs = (x: bigint) => (x < 0n ? -x : x);
const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

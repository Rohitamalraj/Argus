/**
 * AN-8: spending guard for paid provider calls. A daily USD cap, a per-wallet call cap and a
 * circuit breaker that opens after repeated failures. At the cap the analyzer falls back to the
 * free light check, so a Nansen outage or a spent budget never blocks a verdict.
 */
export interface BudgetOptions {
  dailyCapUsd: number;
  perWalletCalls: number;
  /** Consecutive failures that open the breaker. */
  breakerThreshold?: number;
  /** How long the breaker stays open. */
  breakerCooldownMs?: number;
  now?: () => number;
}

export class Budget {
  private spentToday = 0;
  private day = '';
  private perWallet = new Map<string, number>();
  private failures = 0;
  private openUntil = 0;
  private readonly now: () => number;

  constructor(private readonly o: BudgetOptions) {
    this.now = o.now ?? Date.now;
  }

  private roll() {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.spentToday = 0;
      this.perWallet.clear();
    }
  }

  /** Can a call costing `usd` for `wallet` go ahead? Returns the reason when it cannot. */
  check(wallet: string, usd: number): { ok: true } | { ok: false; reason: string } {
    this.roll();
    if (this.now() < this.openUntil) return { ok: false, reason: 'circuit breaker open' };
    if (this.spentToday + usd > this.o.dailyCapUsd) return { ok: false, reason: 'daily budget reached' };
    if ((this.perWallet.get(wallet.toLowerCase()) ?? 0) >= this.o.perWalletCalls) return { ok: false, reason: 'per-wallet call cap reached' };
    return { ok: true };
  }

  record(wallet: string, usd: number) {
    this.roll();
    this.spentToday += usd;
    this.perWallet.set(wallet.toLowerCase(), (this.perWallet.get(wallet.toLowerCase()) ?? 0) + 1);
    this.failures = 0;
  }

  fail() {
    this.failures++;
    if (this.failures >= (this.o.breakerThreshold ?? 3)) {
      this.openUntil = this.now() + (this.o.breakerCooldownMs ?? 60_000);
      this.failures = 0;
    }
  }

  get spent() {
    this.roll();
    return this.spentToday;
  }
}

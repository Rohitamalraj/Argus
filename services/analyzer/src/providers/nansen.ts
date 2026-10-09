import type { Address } from '@argus/scoring';
import { Budget } from '../budget.ts';

const BASE = 'https://api.nansen.ai';
/** One Nansen credit is worth one cent: the x402 price of a 1-credit endpoint is 0.01 USDC. */
export const USD_PER_CREDIT = 0.01;
const CREDITS = { transactions: 1, counterparties: 5 } as const;

export interface NansenTransfer {
  token_address?: string;
  token_amount?: number;
  from_address?: string;
  to_address?: string;
}
export interface NansenTx {
  block_timestamp: string;
  transaction_hash: string;
  tokens_received?: NansenTransfer[];
  tokens_sent?: NansenTransfer[];
}
export interface NansenCounterparty {
  counterparty_address: string;
  volume_out_usd?: number;
  tokens_info?: { token_address: string; token_out_amount?: number }[];
}

export interface NansenOptions {
  /** API key: preferred while the account has credits. */
  apiKey?: string;
  /** Pay per call over x402 instead (sends no key; a key would take precedence over payment). */
  x402Fetch?: typeof fetch;
  /** The real USDC contract: matched by address, never by symbol (lookalike "UṢDC" tokens exist). */
  usdc: Address;
  /** Smallest inbound transfer that counts as funding, in USDC units (e.g. 0.01). */
  minFundingUsdc: number;
  /** Where Nansen's Monad data starts. */
  since?: string;
  budget: Budget;
  fetch?: typeof fetch;
  /** Milliseconds between calls (Nansen allows 5 a second and 60 a minute). */
  spacingMs?: number;
  log?: (msg: string) => void;
}

export interface NansenSpend {
  calls: number;
  usd: number;
}

/**
 * NansenProvider (PV-3): deep evidence for Monad mainnet, redistributable endpoints only
 * (transactions and counterparties; never labels or smart-money data).
 */
export class NansenProvider {
  readonly name = 'nansen';
  calls = 0;
  usd = 0;
  private lastCall = 0;
  private readonly doFetch: typeof fetch;

  constructor(private readonly o: NansenOptions) {
    this.doFetch = o.fetch ?? fetch;
  }

  /** The wallet's first USDC funder as Nansen sees it, or null when Nansen has no inbound transfer (yet). */
  async firstFunder(wallet: Address): Promise<{ funder: Address | null; skipped?: string }> {
    const body = {
      address: wallet,
      chain: 'monad',
      date: { from: this.o.since ?? '2025-11-01', to: new Date().toISOString().slice(0, 10) },
      order_by: [{ field: 'block_timestamp', direction: 'ASC' }],
      pagination: { page: 1, per_page: 100 },
    };
    const res = await this.call<NansenTx>('/api/v1/profiler/address/transactions', body, 'transactions', wallet);
    if ('skipped' in res) return { funder: null, skipped: res.skipped };
    return { funder: pickFirstFunder(res.rows, wallet, this.o.usdc, this.o.minFundingUsdc) };
  }

  /** How many distinct wallets a funder has sent real USDC to, per Nansen (one 5-credit call per funder). */
  async funderRecipients(funder: Address): Promise<{ recipients: number | null; skipped?: string }> {
    const body = {
      address: funder,
      chain: 'monad',
      date: { from: this.o.since ?? '2025-11-01', to: new Date().toISOString().slice(0, 10) },
      group_by: 'wallet',
      source_input: 'Combined',
      pagination: { page: 1, per_page: 100 },
    };
    const res = await this.call<NansenCounterparty>('/api/v1/profiler/address/counterparties', body, 'counterparties', funder);
    if ('skipped' in res) return { recipients: null, skipped: res.skipped };
    return { recipients: countUsdcRecipients(res.rows, this.o.usdc) };
  }

  private async call<Row>(path: string, body: unknown, kind: keyof typeof CREDITS, subject: string): Promise<{ rows: Row[] } | { skipped: string }> {
    const usd = CREDITS[kind] * USD_PER_CREDIT;
    const allowed = this.o.budget.check(subject, usd);
    if (!allowed.ok) return { skipped: allowed.reason };

    const wait = this.lastCall + (this.o.spacingMs ?? 1100) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();

    try {
      let res = await this.send(path, body, this.o.apiKey ? 'key' : 'x402');
      // Out of credits on the key: pay per call instead, when that is switched on.
      if ((res.status === 402 || res.status === 403 || res.status === 429) && this.o.apiKey && this.o.x402Fetch) {
        res = await this.send(path, body, 'x402');
      }
      if (!res.ok) throw new Error(`Nansen ${res.status}`);
      const json = (await res.json()) as { data?: Row[] };
      // Prefer the credits Nansen reports as charged; fall back to the endpoint's list price.
      const used = Number(res.headers.get('x-nansen-credits-used'));
      const spent = Number.isFinite(used) && used > 0 ? used * USD_PER_CREDIT : usd;
      this.calls++;
      this.usd += spent;
      this.o.budget.record(subject, spent);
      return { rows: json.data ?? [] };
    } catch (e) {
      this.o.budget.fail();
      this.o.log?.(`[nansen] ${kind} failed: ${(e as Error).message}`);
      return { skipped: 'Nansen call failed' };
    }
  }

  private send(path: string, body: unknown, mode: 'key' | 'x402'): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (mode === 'key' && this.o.apiKey) headers.apikey = this.o.apiKey;
    const f = mode === 'x402' ? this.o.x402Fetch ?? this.doFetch : this.doFetch;
    return f(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  }

  get spend(): NansenSpend {
    return { calls: this.calls, usd: this.usd };
  }
}

/** Earliest inbound transfer of the real USDC contract of at least `min`, sent by someone else. */
export function pickFirstFunder(txs: NansenTx[], wallet: Address, usdc: Address, min: number): Address | null {
  const w = wallet.toLowerCase();
  const u = usdc.toLowerCase();
  const inbound = txs
    .flatMap((tx) =>
      (tx.tokens_received ?? [])
        .filter((t) => t.token_address?.toLowerCase() === u && t.to_address?.toLowerCase() === w && t.from_address && t.from_address.toLowerCase() !== w && (t.token_amount ?? 0) >= min)
        .map((t) => ({ from: t.from_address!.toLowerCase() as Address, ts: tx.block_timestamp, hash: tx.transaction_hash })),
    )
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.hash.localeCompare(b.hash));
  return inbound[0]?.from ?? null;
}

/** Counterparties that received real USDC from the funder. Lookalike tokens do not count. */
export function countUsdcRecipients(cps: NansenCounterparty[], usdc: Address): number {
  const u = usdc.toLowerCase();
  return cps.filter((c) => (c.tokens_info ?? []).some((t) => t.token_address.toLowerCase() === u && (t.token_out_amount ?? 0) > 0)).length;
}

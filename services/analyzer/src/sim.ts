import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExactEvmScheme } from '@x402/evm';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
import { NETWORKS } from './networks.ts';

interface SimWallet {
  role: string;
  label: string;
  address: Address;
  privateKey: Hex;
}

export interface SimResult {
  ok: boolean;
  namespace: string;
  startedAt: string;
  durationMs: number;
  log: string[];
  summary: { label: string; tier: string; promo: number; standard: number; failed: number }[];
  topUps: string[];
}

export interface SimOptions {
  root: string;
  sellerUrl: string;
  callsPerWallet?: number;
  /** Top a payer back up to this many USDC base units when it drops below `topUpBelow`. */
  topUpTo?: bigint;
  topUpBelow?: bigint;
  minIntervalMs?: number;
}

/**
 * AN-12: the judge "Run simulation" on testnet. The 13 pre-funded wallets call the demo seller one
 * after another through the real middleware and facilitator, in a fresh promo namespace. Afterwards
 * the seller tops payers back up (FS-4); later transfers never change a wallet's first funder.
 * Concurrent clicks share the running simulation; runs start at most once a minute.
 */
export class SimRunner {
  private running?: Promise<SimResult>;
  private lastStart = 0;
  private last?: SimResult;

  constructor(private readonly o: SimOptions) {}

  available(): boolean {
    return existsSync(resolve(this.o.root, 'wallets.testnet.json'));
  }

  run(): { result: Promise<SimResult>; joined: boolean } | { tooSoon: number; last?: SimResult } {
    if (this.running) return { result: this.running, joined: true };
    const wait = this.lastStart + (this.o.minIntervalMs ?? 60_000) - Date.now();
    if (wait > 0) return { tooSoon: Math.ceil(wait / 1000), last: this.last };
    this.lastStart = Date.now();
    this.running = this.execute().finally(() => (this.running = undefined));
    return { result: this.running, joined: false };
  }

  private async execute(): Promise<SimResult> {
    const started = Date.now();
    const namespace = `sim-${new Date(started).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    const wallets = (JSON.parse(readFileSync(resolve(this.o.root, 'wallets.testnet.json'), 'utf8')) as { wallets: SimWallet[] }).wallets;
    const payers = wallets.filter((w) => w.role === 'farm' || w.role === 'independent');
    const calls = this.o.callsPerWallet ?? 3;
    const log: string[] = [`Run ${namespace}: ${payers.length} wallets x ${calls} calls through ${this.o.sellerUrl}`];
    const summary: SimResult['summary'] = [];

    for (const w of payers) {
      const pay = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [{ network: 'eip155:10143', client: new ExactEvmScheme(privateKeyToAccount(w.privateKey)) }],
      });
      const s = { label: w.label, tier: 'Unknown', promo: 0, standard: 0, failed: 0 };
      for (let i = 0; i < calls; i++) {
        try {
          const res = await pay(`${this.o.sellerUrl}/api/premium`, {
            headers: { 'x-payer-address': w.address, 'x-argus-namespace': namespace },
            signal: AbortSignal.timeout(45_000),
          });
          const body = (await res.json().catch(() => ({}))) as { argus?: { price: string; tierName: string; promoLeft: number } };
          if (!res.ok || !body.argus) throw new Error(`HTTP ${res.status}`);
          s.tier = body.argus.tierName;
          body.argus.price === 'promo' ? s.promo++ : s.standard++;
          log.push(`${w.label} call ${i + 1}: ${body.argus.price.padEnd(8)} ${body.argus.tierName}${body.argus.price === 'promo' ? `, promo left ${body.argus.promoLeft - 1}` : ''}`);
        } catch (e) {
          s.failed++;
          log.push(`${w.label} call ${i + 1}: failed (${(e as Error).message})`);
        }
      }
      summary.push(s);
    }

    const farm = summary.filter((s) => s.label.startsWith('farm'));
    const indies = summary.filter((s) => s.label.startsWith('indie'));
    log.push(
      `Farm of ${farm.length}: ${farm.reduce((n, s) => n + s.promo, 0)} promo calls in total (one shared allowance). ` +
        `Independents: ${indies.map((s) => `${s.promo} promo`).join(', ')}.`,
    );
    const topUps = await this.topUp(wallets, payers).catch((e: Error) => [`top-up skipped: ${e.message.split('\n')[0]}`]);
    const result: SimResult = { ok: true, namespace, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, log, summary, topUps };
    this.last = result;
    return result;
  }

  /** FS-4: the seller returns funds to payers that ran low, so one faucet top-up covers many runs. */
  private async topUp(wallets: SimWallet[], payers: SimWallet[]): Promise<string[]> {
    const seller = wallets.find((w) => w.role === 'seller');
    if (!seller) return [];
    const usdc = NETWORKS.testnet.usdc;
    const pub = createPublicClient({ chain: monadTestnet, transport: http() });
    const wallet = createWalletClient({ chain: monadTestnet, transport: http(), account: privateKeyToAccount(seller.privateKey) });
    const target = this.o.topUpTo ?? 50_000n;
    const below = this.o.topUpBelow ?? 20_000n;
    const done: string[] = [];
    for (const p of payers) {
      const bal = await pub.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [p.address] });
      if (bal >= below) continue;
      const amount = target - bal;
      const hash = await wallet.writeContract({ address: usdc, abi: erc20Abi, functionName: 'transfer', args: [p.address, amount] });
      await pub.waitForTransactionReceipt({ hash });
      done.push(`${p.label} +${Number(amount) / 1e6} USDC`);
    }
    return done;
  }
}

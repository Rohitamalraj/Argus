import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { Hex } from '@argus/scoring';
import type { Network } from './networks.ts';

export const ROOT = resolve(import.meta.dirname, '../../..');
loadEnv({ path: resolve(ROOT, '.env'), quiet: true });

export const env = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.ANALYZER_DB ?? resolve(ROOT, 'data/analyzer.sqlite'),
  envioToken: process.env.ENVIO_API_TOKEN ?? '',
  salt: (process.env.ATTESTOR_SALT ?? '0x' + '00'.repeat(32)) as Hex,
  /** Mainnet publishing spends real MON, so it is off unless switched on. */
  publishMainnet: process.env.PUBLISH_MAINNET === 'true',
  sellers: (process.env.SELLER_PAY_TO ?? '').split(',').filter(Boolean),
  nansenApiKey: process.env.NANSEN_API_KEY ?? '',
  /** Pay Nansen per call over x402 from the mainnet analyzer wallet (real USDC). Off unless switched on. */
  nansenPayX402: process.env.NANSEN_PAY_X402 === 'true',
  /** Daily Nansen spend cap in USD (1 credit = $0.01). */
  nansenDailyCapUsd: Number(process.env.NANSEN_DAILY_CAP_USD ?? 0.6),
};

/**
 * Attestor key for local development: ATTESTOR_KEY_<NETWORK>, else the attestor in wallets.<network>.json.
 * The final demo uses the Dynamic server wallet instead (SG-1).
 */
export function attestorKey(network: Network): Hex | undefined {
  const fromEnv = process.env[`ATTESTOR_KEY_${network.toUpperCase()}`];
  if (fromEnv) return fromEnv as Hex;
  const file = resolve(ROOT, `wallets.${network}.json`);
  if (!existsSync(file)) return undefined;
  const w = (JSON.parse(readFileSync(file, 'utf8')) as { wallets: { role: string; privateKey: Hex }[] }).wallets;
  return w.find((x) => x.role === 'attestor')?.privateKey;
}

/** Seller payTo addresses from the wallet files; they are excluded from value closure (S4). */
export function sellerAddresses(network: Network): string[] {
  const file = resolve(ROOT, `wallets.${network}.json`);
  const fromFile = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as { wallets: { role: string; address: string }[] }).wallets
        .filter((w) => w.role === 'seller')
        .map((w) => w.address)
    : [];
  return [...env.sellers, ...fromFile];
}

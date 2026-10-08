/**
 * Gate 1 check: one Nansen API call paid over x402 with USDC on Monad mainnet (no API key sent,
 * because a valid key would take precedence over payment).
 *   npm run nansen-x402 -w @argus/analyzer -- [wallet]
 * Pays 0.01 USDC from the mainnet analyzer wallet in wallets.mainnet.json.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExactEvmScheme } from '@x402/evm';
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ROOT = resolve(import.meta.dirname, '../../../..');
const wallets = JSON.parse(readFileSync(resolve(ROOT, 'wallets.mainnet.json'), 'utf8')) as {
  wallets: { role: string; address: string; privateKey: Hex }[];
};
const payer = wallets.wallets.find((w) => w.role === 'attestor')!;
const account = privateKeyToAccount(payer.privateKey);
const target = process.argv.slice(2).find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) ?? '0xe6299a1f093e82d659e254b5f877b950b260d19c';

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:143', client: new ExactEvmScheme(account) }],
});

console.log(`Payer ${account.address} -> Nansen related-wallets for ${target} on monad`);
const res = await fetchWithPayment('https://api.nansen.ai/api/v1/profiler/address/related-wallets', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ wallet_address: target, chain: 'monad', pagination: { page: 1, per_page: 20 } }),
});
console.log(`HTTP ${res.status}`);
const receipt = res.headers.get('PAYMENT-RESPONSE');
if (receipt) console.log('Payment:', decodePaymentResponseHeader(receipt));
const body = (await res.json()) as { data?: Array<{ address: string; relation: string; block_timestamp: string }> };
// Labels are never used or shown (Nansen bounty rules); print relations only.
for (const r of body.data ?? []) console.log(`  ${r.relation}: ${r.address} (${r.block_timestamp})`);
console.log('Powered by Nansen API');

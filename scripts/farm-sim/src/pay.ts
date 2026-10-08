/**
 * FS-3: send x402 calls from the demo wallets, one after another, through a seller.
 *   npm run pay -w @argus/farm-sim -- --network testnet [--seller http://localhost:4021] [--calls 3]
 *        [--only farm-01,indie-1] [--namespace run-1]
 */
import { ExactEvmScheme } from '@x402/evm';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { privateKeyToAccount } from 'viem/accounts';
import { loadWallets, parseNetwork } from './lib.ts';

const argv = process.argv.slice(2);
const network = parseNetwork(argv);
const arg = (name: string) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : undefined);
const sellerUrl = arg('--seller') ?? 'http://localhost:4021';
const calls = Number(arg('--calls') ?? 3);
const only = arg('--only')?.split(',');
const namespace = arg('--namespace');
const caip = network === 'mainnet' ? 'eip155:143' : 'eip155:10143';

const payers = loadWallets(network).wallets.filter(
  (w) => (w.role === 'farm' || w.role === 'independent') && (!only || only.includes(w.label)),
);

const summary: Record<string, { promo: number; standard: number; tier: string }> = {};
for (const w of payers) {
  const account = privateKeyToAccount(w.privateKey);
  const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: caip, client: new ExactEvmScheme(account) }] });
  summary[w.label] = { promo: 0, standard: 0, tier: '?' };
  for (let i = 0; i < calls; i++) {
    const headers: Record<string, string> = { 'x-payer-address': account.address };
    if (namespace) headers['x-argus-namespace'] = namespace;
    const res = await pay(`${sellerUrl}/api/premium`, { headers });
    const body = (await res.json().catch(() => ({}))) as { argus?: { price: string; tierName: string; promoLeft: number; reasons: string[] } };
    const a = body.argus;
    if (res.ok && a) {
      summary[w.label]![a.price === 'promo' ? 'promo' : 'standard']++;
      summary[w.label]!.tier = a.tierName;
    }
    console.log(`${w.label} call ${i + 1}: HTTP ${res.status} ${a ? `${a.price} (${a.tierName}, promo left ${a.promoLeft}) - ${a.reasons.at(-1)}` : ''}`);
  }
}
console.log('\nSummary');
for (const [label, s] of Object.entries(summary)) console.log(`  ${label.padEnd(10)} ${s.tier.padEnd(12)} promo ${s.promo}  standard ${s.standard}`);

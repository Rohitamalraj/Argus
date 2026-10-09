/**
 * Deep check (HyperSync + Nansen) of the mainnet demo wallets. Nothing is published on-chain.
 *   npm run assess-deep -w @argus/analyzer [-- 0xwallet ...]
 * Uses NANSEN_API_KEY credits (a 1-credit transactions call per wallet, one 5-credit counterparties
 * call per funder). Add NANSEN_PAY_X402=true to pay per call in USDC from the mainnet analyzer wallet instead.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { knownHubsFor, makeConfig, type Address } from '@argus/scoring';
import { Assessor } from '../assessor.ts';
import { Budget } from '../budget.ts';
import { ROOT, env, sellerAddresses } from '../env.ts';
import { NETWORKS } from '../networks.ts';
import { ChainDataProvider } from '../providers/chain.ts';
import { HyperSyncClient } from '../providers/hypersync.ts';
import { NansenProvider } from '../providers/nansen.ts';
import { Store } from '../store.ts';

const net = NETWORKS.mainnet;
if (!env.envioToken) throw new Error('ENVIO_API_TOKEN missing');
if (!env.nansenApiKey) throw new Error('NANSEN_API_KEY missing');

type Label = { role: string; label: string; address: Address; expectedTier: string | null };
const labels = (JSON.parse(readFileSync(resolve(ROOT, 'fixtures/labels.mainnet.json'), 'utf8')) as { wallets: Label[] }).wallets.filter((w) => w.expectedTier);
const given = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) as Address[];
const targets = given.length ? given.map((address) => ({ address, label: address, expectedTier: null as string | null })) : labels;

const cfg = makeConfig({ knownHubs: knownHubsFor(net.chainId), closureExclude: sellerAddresses('mainnet') });
const provider = new ChainDataProvider(new HyperSyncClient(net.hypersync, net.usdc, env.envioToken, net.usdcStartBlock), net.chainId, cfg);
const nansen = new NansenProvider({
  apiKey: env.nansenApiKey,
  usdc: net.usdc,
  minFundingUsdc: 0.01,
  budget: new Budget({ dailyCapUsd: env.nansenDailyCapUsd, perWalletCalls: 3 }),
  log: console.log,
});
const store = new Store(':memory:');
const assessor = new Assessor({ store, salt: env.salt, providers: { mainnet: provider }, configs: { mainnet: cfg }, deep: nansen });

const started = Date.now();
const verdicts = await assessor.assess('mainnet', targets.map((t) => t.address), true, 'deep');
let correct = 0;
const customers = new Set<string>();
for (const [i, t] of targets.entries()) {
  const v = verdicts[i]!;
  customers.add(v.operatorId);
  const ok = t.expectedTier ? v.tierName === t.expectedTier : undefined;
  if (ok) correct++;
  console.log(`${t.label.padEnd(10)} ${v.tierName.padEnd(11)} ${v.confidence.padEnd(6)} ${v.depth?.padEnd(5)} ${ok === undefined ? '' : ok ? 'OK' : `EXPECTED ${t.expectedTier}`}`);
  for (const r of v.reasons) console.log(`             - ${r}`);
}
console.log(`\n${targets.length} wallets -> ${customers.size} customers in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (!given.length) console.log(`Ground truth: ${correct}/${targets.length} correct`);
console.log(`HyperSync: ${provider.calls} queries (free). Nansen: ${nansen.calls} calls, $${nansen.usd.toFixed(2)}. Powered by Nansen API.`);

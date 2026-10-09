/**
 * Assess wallets from the command line with the free chain-data (light) check.
 *   npm run assess -w @argus/analyzer -- --network testnet 0xabc... [0xdef...]
 *   npm run assess -w @argus/analyzer -- --network testnet --labels   (all wallets in fixtures/labels.<network>.json)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { decide, knownHubsFor, makeConfig, type Address, type Hex } from '@argus/scoring';
import { NETWORKS, type Network } from '../networks.ts';
import { ChainDataProvider, HyperSyncClient } from '@argus/sdk';

const ROOT = resolve(import.meta.dirname, '../../../..');
loadEnv({ path: resolve(ROOT, '.env'), quiet: true });

const argv = process.argv.slice(2);
const ni = argv.indexOf('--network');
const network = (ni >= 0 ? argv[ni + 1] : 'testnet') as Network;
const net = NETWORKS[network];
const token = process.env.ENVIO_API_TOKEN;
if (!token) throw new Error('ENVIO_API_TOKEN missing');

type Label = { role: string; label: string; address: Address; expectedTier: string | null };
let targets: { address: Address; label?: string; expected?: string | null }[];
let sellers: string[] = (process.env.SELLER_PAY_TO ?? '').split(',').filter(Boolean);
if (argv.includes('--labels')) {
  const labels = JSON.parse(readFileSync(resolve(ROOT, `fixtures/labels.${network}.json`), 'utf8')) as { wallets: Label[] };
  targets = labels.wallets.filter((w) => w.expectedTier).map((w) => ({ address: w.address, label: w.label, expected: w.expectedTier }));
  sellers = sellers.concat(labels.wallets.filter((w) => w.role === 'seller').map((w) => w.address));
} else {
  targets = argv.filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)).map((a) => ({ address: a as Address }));
}

const cfg = makeConfig({ knownHubs: knownHubsFor(net.chainId), closureExclude: sellers });
const salt = (process.env.ATTESTOR_SALT ?? '0x' + '00'.repeat(32)) as Hex;
const provider = new ChainDataProvider(new HyperSyncClient(net.hypersync, net.usdc, token, net.usdcStartBlock), net.chainId, cfg);

let correct = 0;
const operators = new Set<string>();
const started = Date.now();
const { inputs } = await provider.gatherMany(targets.map((t) => t.address));
const elapsed = Date.now() - started;
for (const [i, t] of targets.entries()) {
  const d = decide(inputs[i]!, salt, cfg);
  operators.add(d.operatorId);
  const ok = t.expected ? d.tierName === t.expected : undefined;
  if (ok) correct++;
  console.log(
    `${(t.label ?? t.address).padEnd(10)} ${d.tierName.padEnd(11)} ${d.confidence.padEnd(6)} group=${String(d.groupSize).padEnd(3)} funder=${d.firstFunder ?? '-'} ${ok === undefined ? '' : ok ? 'OK' : `EXPECTED ${t.expected}`}`,
  );
  for (const r of d.reasons) console.log(`             - ${r}`);
}
console.log(`\n${targets.length} wallets -> ${operators.size} customers; HyperSync calls: ${provider.calls}; ${elapsed} ms`);
if (argv.includes('--labels')) console.log(`Ground truth: ${correct}/${targets.length} correct`);

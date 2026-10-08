/**
 * FS-1: create the demo wallets and the ground-truth labels.
 *   npm run create -w @argus/farm-sim -- --network testnet
 * Writes wallets.<network>.json (secret, gitignored) and fixtures/labels.<network>.json (public).
 * Refuses to overwrite existing wallets, so funded keys are never lost.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { labelsPath, parseNetwork, walletsPath, type WalletEntry, type WalletFile } from './lib.ts';

const network = parseNetwork();
const out = walletsPath(network);
if (existsSync(out)) {
  console.error(`${out} already exists. Delete it yourself only if those wallets hold no funds.`);
  process.exit(1);
}

const make = (role: WalletEntry['role'], label: string): WalletEntry => {
  const privateKey = generatePrivateKey();
  return { role, label, address: privateKeyToAccount(privateKey).address, privateKey };
};

const wallets: WalletEntry[] = [
  make('funder', 'F'),
  ...Array.from({ length: 10 }, (_, i) => make('farm', `farm-${String(i + 1).padStart(2, '0')}`)),
  ...Array.from({ length: 3 }, (_, i) => make('independent', `indie-${i + 1}`)),
  make('seller', 'seller-payto'),
  make('attestor', 'analyzer-attestor'),
];

const file: WalletFile = { network, createdAt: new Date().toISOString(), wallets };
writeFileSync(out, JSON.stringify(file, null, 2));

const labels = {
  network,
  createdAt: file.createdAt,
  expected: { payingWallets: 13, customers: 4 },
  wallets: wallets.map(({ role, label, address }) => ({
    role,
    label,
    address,
    expectedTier: role === 'farm' ? 'Linked' : role === 'independent' ? 'Independent' : null,
  })),
};
mkdirSync(dirname(labelsPath(network)), { recursive: true });
writeFileSync(labelsPath(network), JSON.stringify(labels, null, 2));

console.log(`Created ${wallets.length} ${network} wallets`);
console.log(`  secrets: ${out}  (gitignored, back it up)`);
console.log(`  labels:  ${labelsPath(network)}`);
for (const w of wallets) console.log(`  ${w.label.padEnd(18)} ${w.address}`);

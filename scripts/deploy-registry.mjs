// Deploy PayerAttestations with the analyzer (attestor) wallet of a network.
//   npm run deploy:registry -- testnet|mainnet
// The key is read from wallets.<network>.json and passed straight to forge, never printed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const network = process.argv[2];
if (network !== 'testnet' && network !== 'mainnet') {
  console.error('Usage: npm run deploy:registry -- testnet|mainnet');
  process.exit(1);
}
const wallets = JSON.parse(readFileSync(join(root, `wallets.${network}.json`), 'utf8'));
const attestor = wallets.wallets.find((w) => w.role === 'attestor');

const local = join(homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'forge.exe' : 'forge');
const forge = existsSync(local) ? local : 'forge';
console.log(`Deploying from ${attestor.address} to Monad ${network}`);
const r = spawnSync(
  forge,
  ['script', 'script/Deploy.s.sol', '--rpc-url', `monad_${network}`, '--broadcast', '--private-key', attestor.privateKey],
  { cwd: join(root, 'contracts'), stdio: 'inherit' },
);
process.exit(r.status ?? 1);

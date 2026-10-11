// One process for a small host: the Argus analyzer (public API, on $PORT) and the demo x402 seller
// (internal, :4021) that the judge simulation pays. Used by the Dockerfile.
//
// Testnet demo wallets arrive as one secret: WALLETS_TESTNET_B64 = base64 of wallets.testnet.json
// (testnet keys only; the file is never committed).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJsonSecret } from './secret-json.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '8787';
const sellerPort = '4021';

const walletsFile = join(root, 'wallets.testnet.json');
if (!existsSync(walletsFile) && process.env.WALLETS_TESTNET_B64) {
  const decoded = decodeJsonSecret('WALLETS_TESTNET_B64', process.env.WALLETS_TESTNET_B64);
  if (decoded.error) {
    console.error(`[hosted] ${decoded.error}`);
    process.exit(1);
  }
  writeFileSync(walletsFile, JSON.stringify(decoded.value));
  console.log(`[hosted] wrote wallets.testnet.json from WALLETS_TESTNET_B64 (${decoded.value.wallets?.length ?? 0} wallets)`);
}
if (!existsSync(walletsFile)) console.log('[hosted] no testnet wallets: the judge simulation and verdict publishing will be off');

// Optional: sign attestations through a Dynamic MPC wallet instead of a raw key (docs/DEPLOY.md).
// DYNAMIC_ATTESTOR_B64 = base64 of data/dynamic-attestor.json, which holds public wallet metadata only.
let dynamicEnv = {};
const dynamicFile = join(root, 'data', 'dynamic-attestor.json');
if (process.env.DYNAMIC_ATTESTOR_B64) {
  mkdirSync(dirname(dynamicFile), { recursive: true });
  const decoded = decodeJsonSecret('DYNAMIC_ATTESTOR_B64', process.env.DYNAMIC_ATTESTOR_B64);
  if (decoded.error) console.error(`[hosted] ${decoded.error} Continuing without the Dynamic wallet.`);
  else writeFileSync(dynamicFile, JSON.stringify(decoded.value));
}
if (existsSync(dynamicFile) && process.env.DYNAMIC_ENVIRONMENT_ID && process.env.DYNAMIC_API_TOKEN && process.env.DYNAMIC_WALLET_PASSWORD) {
  const address = JSON.parse(readFileSync(dynamicFile, 'utf8')).walletMetadata.accountAddress;
  // The seller must trust the attestor that signs, or it would read no verdicts from the registry.
  dynamicEnv = { DYNAMIC_ATTESTOR_NETWORK: 'testnet', ATTESTOR_ADDRESS: address };
  console.log(`[hosted] attestations will be signed by the Dynamic wallet ${address}`);
}

const children = [];
const start = (name, args, env) => {
  const c = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = (d) => d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  c.stdout.on('data', tag);
  c.stderr.on('data', tag);
  c.on('exit', (code) => {
    console.error(`[hosted] ${name} exited with ${code}; stopping`);
    for (const o of children) o.kill();
    process.exit(code ?? 1);
  });
  children.push(c);
};

start('seller', ['apps/seller-demo/src/server.ts'], {
  NETWORK: 'testnet',
  PORT: sellerPort,
  SELLER_NAME: 'seller-a',
  ANALYZER_URL: `http://localhost:${port}`,
  ...dynamicEnv,
});
start('analyzer', ['services/analyzer/src/server.ts'], { PORT: port, SIM_SELLER_URL: `http://localhost:${sellerPort}`, ...dynamicEnv });

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => children.forEach((c) => c.kill()));

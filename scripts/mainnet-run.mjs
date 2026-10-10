/**
 * Mainnet end-to-end run, one step at a time (each spends real MON/USDC, so each is its own command):
 *   npm run mainnet:run -- analyzer   analyzer on :8787 with PUBLISH_MAINNET=true (attestor spends MON on verdicts)
 *   npm run mainnet:run -- seller     demo seller on :4023, mainnet, $0.01 / $0.005 promo, pays to the seller wallet
 *   npm run mainnet:run -- pay [N]    13 demo wallets pay the seller N times each (default 3), real USDC
 */
import { spawn } from 'node:child_process';

const [step, arg] = process.argv.slice(2);
const run = (args, env) =>
  spawn('npm', args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } }).on('exit', (c) => process.exit(c ?? 0));

if (step === 'analyzer') run(['start', '-w', '@argus/analyzer'], { PUBLISH_MAINNET: 'true' });
else if (step === 'seller') run(['start', '-w', '@argus/seller-demo'], { NETWORK: 'mainnet', PORT: '4023', SELLER_NAME: 'seller-mainnet' });
else if (step === 'pay') run(['run', 'pay', '-w', '@argus/farm-sim', '--', '--network', 'mainnet', '--seller', 'http://localhost:4023', '--calls', arg ?? '3', '--namespace', 'mainnet-run-1'], {});
else {
  console.error('usage: mainnet-run.mjs analyzer | seller | pay [calls]');
  process.exit(1);
}

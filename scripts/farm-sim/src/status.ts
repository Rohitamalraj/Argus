/** Print MON and USDC balances of every demo wallet.  npm run status -w @argus/farm-sim -- --network testnet */
import { clients, fmt, loadWallets, parseNetwork, usdcBalance } from './lib.ts';

const network = parseNetwork();
const { wallets } = loadWallets(network);
const { pub } = clients(network);

console.log(`${'wallet'.padEnd(18)} ${'address'.padEnd(42)} ${'MON'.padStart(10)} ${'USDC'.padStart(10)}`);
for (const w of wallets) {
  const [mon, usdc] = await Promise.all([pub.getBalance({ address: w.address }), usdcBalance(network, w.address)]);
  console.log(`${w.label.padEnd(18)} ${w.address} ${fmt(mon, 18).padStart(10)} ${fmt(usdc).padStart(10)}`);
}

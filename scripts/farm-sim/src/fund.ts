/**
 * FS-2: the funder seeds the 10 farm wallets with identical USDC amounts, back to back.
 *   npm run fund -w @argus/farm-sim -- --network testnet [--amount 0.05] [--dry-run]
 * Independents are NOT funded here: on testnet each claims straight from the Circle faucet,
 * on mainnet each comes from an unrelated source (exchange, bridge, a teammate).
 * The funder needs USDC (10 x amount) and a little MON for gas.
 */
import { erc20Abi, parseUnits } from 'viem';
import { NETWORKS, clients, fmt, loadWallets, parseNetwork, usdcBalance } from './lib.ts';

const argv = process.argv.slice(2);
const network = parseNetwork(argv);
const ai = argv.indexOf('--amount');
const amountStr = ai >= 0 ? argv[ai + 1]! : network === 'testnet' ? '0.05' : '0.20';
const dryRun = argv.includes('--dry-run');
const amount = parseUnits(amountStr, 6);

const { wallets } = loadWallets(network);
const funder = wallets.find((w) => w.role === 'funder')!;
const farm = wallets.filter((w) => w.role === 'farm');
const { pub, walletFor } = clients(network);
const { usdc, explorer } = NETWORKS[network];

const need = amount * BigInt(farm.length);
const [have, mon] = await Promise.all([usdcBalance(network, funder.address), pub.getBalance({ address: funder.address })]);
console.log(`Funder ${funder.address}: ${fmt(have)} USDC, ${fmt(mon, 18)} MON; needs ${fmt(need)} USDC`);
if (have < need) {
  console.error(`Not enough USDC. Send at least ${fmt(need - have)} USDC on Monad ${network} to the funder.`);
  process.exit(1);
}
if (mon === 0n) {
  console.error('Funder has no MON for gas. Send it a little MON first.');
  process.exit(1);
}
if (dryRun) {
  console.log(`Dry run: would send ${amountStr} USDC to ${farm.length} farm wallets.`);
  process.exit(0);
}

const client = walletFor(funder.privateKey);
for (const w of farm) {
  const hash = await client.writeContract({ address: usdc, abi: erc20Abi, functionName: 'transfer', args: [w.address, amount] });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`${w.label} <- ${amountStr} USDC  ${explorer}/tx/${hash}`);
}
console.log('Farm funded.');

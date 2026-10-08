/**
 * Mainnet independents get their first USDC from a public DEX pool, the way a new user who buys
 * USDC would: each wallet swaps its own MON for USDC on Uniswap v3 (Monad).
 *   npm run swap -w @argus/farm-sim -- --network mainnet --only indie-2,indie-3 [--mon 14] [--dry-run]
 * Keeps 1 MON in each wallet for gas.
 */
import { formatUnits, parseAbi, parseEther } from 'viem';
import { NETWORKS, clients, loadWallets, parseNetwork } from './lib.ts';

// Uniswap v3 on Monad mainnet (developers.uniswap.org, v3 Monad deployments)
const SWAP_ROUTER_02 = '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900';
const QUOTER_V2 = '0x661e93cca42afacb172121ef892830ca3b70f08d';
const WMON = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const FEE = 3000; // deepest WMON/USDC pool when checked on 2026-10-09

const routerAbi = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
]);
const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)',
]);

const argv = process.argv.slice(2);
const network = parseNetwork(argv);
if (network !== 'mainnet') throw new Error('Swaps are for mainnet; testnet independents use the Circle faucet.');
const arg = (name: string) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : undefined);
const only = (arg('--only') ?? 'indie-2,indie-3').split(',');
const monIn = parseEther(arg('--mon') ?? '14');
const dryRun = argv.includes('--dry-run');

const { wallets } = loadWallets(network);
const { pub, walletFor } = clients(network);
const { usdc, explorer } = NETWORKS[network];

for (const w of wallets.filter((x) => x.role === 'independent' && only.includes(x.label))) {
  const mon = await pub.getBalance({ address: w.address });
  if (mon < monIn + parseEther('1')) {
    console.log(`${w.label}: has ${formatUnits(mon, 18)} MON, needs ${formatUnits(monIn, 18)} + 1 for gas; skipped`);
    continue;
  }
  const { result } = await pub.simulateContract({
    address: QUOTER_V2,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: WMON, tokenOut: usdc, amountIn: monIn, fee: FEE, sqrtPriceLimitX96: 0n }],
  });
  const quote = result[0];
  const minOut = (quote * 97n) / 100n; // 3% slippage
  console.log(`${w.label} ${w.address}: ${formatUnits(monIn, 18)} MON -> ~${formatUnits(quote, 6)} USDC (min ${formatUnits(minOut, 6)})`);
  if (dryRun) continue;

  const hash = await walletFor(w.privateKey).writeContract({
    address: SWAP_ROUTER_02,
    abi: routerAbi,
    functionName: 'exactInputSingle',
    args: [{ tokenIn: WMON, tokenOut: usdc, fee: FEE, recipient: w.address, amountIn: monIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
    value: monIn,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${r.status} ${explorer}/tx/${hash}`);
}

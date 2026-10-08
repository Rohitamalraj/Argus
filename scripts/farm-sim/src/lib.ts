import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad, monadTestnet } from 'viem/chains';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: resolve(ROOT, '.env'), quiet: true });

export type Network = 'testnet' | 'mainnet';

export const NETWORKS = {
  testnet: { chain: monadTestnet, usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3' as Address, explorer: 'https://testnet.monadvision.com' },
  mainnet: { chain: monad, usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address, explorer: 'https://monadvision.com' },
} as const;

export interface WalletEntry {
  role: 'funder' | 'farm' | 'independent' | 'seller' | 'attestor';
  label: string;
  address: Address;
  privateKey: Hex;
}

export interface WalletFile {
  network: Network;
  createdAt: string;
  wallets: WalletEntry[];
}

export function parseNetwork(argv = process.argv.slice(2)): Network {
  const i = argv.indexOf('--network');
  const n = i >= 0 ? argv[i + 1] : process.env.NETWORK ?? 'testnet';
  if (n !== 'testnet' && n !== 'mainnet') throw new Error(`--network must be testnet or mainnet, got ${n}`);
  return n;
}

/** Secret keys, never committed (.gitignore: wallets*.json). */
export const walletsPath = (n: Network) => resolve(ROOT, `wallets.${n}.json`);
/** Public ground truth, safe to commit. */
export const labelsPath = (n: Network) => resolve(ROOT, `fixtures/labels.${n}.json`);

export function loadWallets(n: Network): WalletFile {
  const p = walletsPath(n);
  if (!existsSync(p)) throw new Error(`${p} not found. Run: npm run create -w @argus/farm-sim -- --network ${n}`);
  return JSON.parse(readFileSync(p, 'utf8')) as WalletFile;
}

export function clients(n: Network) {
  const { chain } = NETWORKS[n];
  const rpc = n === 'mainnet' ? process.env.MONAD_RPC_URL_MAINNET : process.env.MONAD_RPC_URL_TESTNET;
  const transport = http(rpc || chain.rpcUrls.default.http[0]);
  const pub = createPublicClient({ chain, transport });
  const walletFor = (pk: Hex) => createWalletClient({ chain, transport, account: privateKeyToAccount(pk) });
  return { pub, walletFor };
}

export async function usdcBalance(n: Network, who: Address): Promise<bigint> {
  const { pub } = clients(n);
  return pub.readContract({ address: NETWORKS[n].usdc, abi: erc20Abi, functionName: 'balanceOf', args: [who] });
}

export const fmt = (raw: bigint, decimals = 6) => (Number(raw) / 10 ** decimals).toFixed(decimals === 6 ? 4 : 4);

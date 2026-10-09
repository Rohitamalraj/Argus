import { decide, knownHubsFor, makeConfig, type Address, type Decision, type Hex, type ScoringConfig } from '@argus/scoring';
import { NETWORKS, type Network, type NetworkInfo } from './networks.ts';
import { ChainDataProvider } from './providers/chain.ts';
import { HyperSyncClient, type ChainReader } from './providers/hypersync.ts';
import { RegistryReader, type OnchainVerdict } from './registry.ts';
import { agentReputation, type AgentReputation } from './reputation.ts';

const ZERO_SALT: Hex = `0x${'00'.repeat(32)}`;

export interface ArgusOptions {
  network: Network;
  /** Envio HyperSync API token (free at envio.dev). Needed for any check that reads chain history. */
  hypersyncToken?: string;
  /** Use your own chain reader instead of HyperSync (for tests or another data source). */
  chain?: ChainReader;
  /** RPC endpoint for registry reads. Defaults to the public Monad RPC. */
  rpcUrl?: string;
  /** Extra funders that never link wallets (exchanges, faucets). */
  knownHubs?: Iterable<string>;
  registry?: Address;
}

export interface VerifyResult {
  wallet: Address;
  attestor: Address;
  onchain: OnchainVerdict;
  local: Decision;
  /** The on-chain tier equals the tier recomputed locally from public chain data. */
  matches: boolean;
  /** What differs, in words. Empty when everything matches. */
  differences: string[];
}

export interface Argus {
  readonly network: NetworkInfo;
  /** The verdict for a wallet, recomputed locally from public chain data. Nothing is sent to an Argus server. */
  checkWallet(wallet: Address): Promise<Decision>;
  /** Several wallets in one go: a handful of chain queries however many wallets there are. */
  checkWallets(wallets: Address[]): Promise<Decision[]>;
  /** The verdict an attestor published on-chain. */
  verdictOf(wallet: Address, attestor?: Address): Promise<OnchainVerdict>;
  /** Recompute locally and compare with the published verdict: verify, don't trust. */
  verify(wallet: Address, attestor?: Address): Promise<VerifyResult>;
  /** ERC-8004 reputation for an agent, deduplicated by operator. */
  agentReputation(agentId: bigint | number | string, opts?: { maxClients?: number; onProgress?: (msg: string) => void }): Promise<AgentReputation>;
}

export function createArgus(o: ArgusOptions): Argus {
  const net = NETWORKS[o.network];
  const hs = o.chain as (ChainReader & Partial<HyperSyncClient>) | undefined;
  const hyper = (): HyperSyncClient => {
    if (!o.hypersyncToken) throw new Error('hypersyncToken is required (free at https://envio.dev/app/api-tokens)');
    return new HyperSyncClient(net.hypersync, net.usdc, o.hypersyncToken, net.usdcStartBlock);
  };
  const registry = new RegistryReader(o.network, { rpcUrl: o.rpcUrl, registry: o.registry });
  const usdcConfig = (): ScoringConfig => makeConfig({ knownHubs: [...knownHubsFor(net.chainId), ...(o.knownHubs ?? [])] });

  const checkWallets = async (wallets: Address[]): Promise<Decision[]> => {
    if (wallets.length === 0) return [];
    const cfg = usdcConfig();
    const provider = new ChainDataProvider(hyper(), net.chainId, cfg);
    const { inputs } = await provider.gatherMany(wallets);
    return inputs.map((input) => decide(input, ZERO_SALT, cfg));
  };
  const checkWallet = async (wallet: Address): Promise<Decision> => (await checkWallets([wallet]))[0]!;

  return {
    network: net,
    checkWallet,
    checkWallets,
    verdictOf: (wallet, attestor) => registry.verdictOf(wallet, attestor),
    async verify(wallet, attestor = net.defaultAttestor) {
      const [onchain, local] = await Promise.all([registry.verdictOf(wallet, attestor), checkWallet(wallet)]);
      const differences: string[] = [];
      if (!onchain.exists) differences.push('No verdict published by this attestor for this wallet');
      else if (onchain.expired) differences.push(`Published verdict expired at ${new Date(onchain.expiresAt * 1000).toISOString()}`);
      if (onchain.tier !== local.tier) differences.push(`Published tier is ${onchain.tierName}; recomputed tier is ${local.tierName}`);
      return { wallet, attestor, onchain, local, matches: onchain.exists && !onchain.expired && onchain.tier === local.tier, differences };
    },
    agentReputation: (agentId, opts = {}) =>
      agentReputation(agentId, {
        chain: hs ?? hyper(),
        network: o.network,
        knownHubs: o.knownHubs,
        ...(opts.maxClients ? { maxClients: opts.maxClients } : {}),
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      }),
  };
}

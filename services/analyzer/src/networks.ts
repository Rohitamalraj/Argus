import type { Address } from '@argus/scoring';

export type Network = 'testnet' | 'mainnet';

export const NETWORKS: Record<Network, { chainId: number; usdc: Address; hypersync: string; usdcStartBlock: number; registry?: Address }> = {
  mainnet: {
    chainId: 143,
    usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    hypersync: 'https://monad.hypersync.xyz',
    usdcStartBlock: 22_909_000,
    registry: (process.env.REGISTRY_ADDRESS_MAINNET as Address | undefined) ?? '0x151e488618FC0F79F7f91447351174Fb8D98cE98',
  },
  testnet: {
    chainId: 10143,
    usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
    hypersync: 'https://monad-testnet.hypersync.xyz',
    usdcStartBlock: 75_000,
    registry: (process.env.REGISTRY_ADDRESS_TESTNET as Address | undefined) ?? '0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE',
  },
};

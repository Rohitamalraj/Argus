import { NETWORKS as SDK_NETWORKS } from '@argus/sdk';
import type { Address } from '@argus/scoring';

export type Network = 'testnet' | 'mainnet';

/** Network constants come from the SDK; the registry address can be overridden from the environment. */
export const NETWORKS: Record<Network, { chainId: number; usdc: Address; hypersync: string; usdcStartBlock: number; registry?: Address }> = {
  mainnet: {
    chainId: SDK_NETWORKS.mainnet.chainId,
    usdc: SDK_NETWORKS.mainnet.usdc,
    hypersync: SDK_NETWORKS.mainnet.hypersync,
    usdcStartBlock: SDK_NETWORKS.mainnet.usdcStartBlock,
    registry: (process.env.REGISTRY_ADDRESS_MAINNET as Address | undefined) ?? SDK_NETWORKS.mainnet.registry,
  },
  testnet: {
    chainId: SDK_NETWORKS.testnet.chainId,
    usdc: SDK_NETWORKS.testnet.usdc,
    hypersync: SDK_NETWORKS.testnet.hypersync,
    usdcStartBlock: SDK_NETWORKS.testnet.usdcStartBlock,
    registry: (process.env.REGISTRY_ADDRESS_TESTNET as Address | undefined) ?? SDK_NETWORKS.testnet.registry,
  },
};

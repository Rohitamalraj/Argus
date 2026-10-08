/**
 * Known hubs per network (PV-6): funders that serve many unrelated wallets and must never link anyone.
 * Data only, no provider code. Add an address with a comment saying how it was confirmed.
 */
export const KNOWN_HUBS: Record<number, Record<string, string>> = {
  // Monad mainnet
  143: {
    '0x0000000000000000000000000000000000000000': 'USDC mint (CCTP and Circle mints arrive from the zero address)',
  },
  // Monad testnet
  10143: {
    '0x0000000000000000000000000000000000000000': 'USDC mint',
    '0x984a5543ea0863f0df3e443bf8e26c242eef633e': 'Circle faucet (seen funding 20 USDC claims, 2026-10-09)',
  },
};

export const knownHubsFor = (chainId: number): string[] => Object.keys(KNOWN_HUBS[chainId] ?? {});

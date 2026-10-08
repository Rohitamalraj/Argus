/**
 * Known hubs per network (PV-6): funders that serve many unrelated wallets and must never link anyone.
 * Data only, no provider code. Add an address with a comment saying how it was confirmed.
 */
export const KNOWN_HUBS: Record<number, Record<string, string>> = {
  // Monad mainnet
  143: {
    '0x0000000000000000000000000000000000000000': 'USDC mint (CCTP and Circle mints arrive from the zero address)',
    // Bridge payout address: 2,606 recipients of >= 0.10 USDC when checked on 2026-10-09.
    '0xfd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0': 'Bridge payout',
    // Uniswap v3 WMON/USDC 0.3% pool: pays out every swap; 1,009 recipients on 2026-10-09.
    '0x659bd0bc4167ba25c62e05656f78043e7ed4a9da': 'Uniswap v3 WMON/USDC pool',
  },
  // Monad testnet
  10143: {
    '0x0000000000000000000000000000000000000000': 'USDC mint',
    // The Circle faucet rotates sender wallets; each sent 20 USDC claims to 1,000+ recipients (2026-10-09).
    '0x984a5543ea0863f0df3e443bf8e26c242eef633e': 'Circle faucet sender',
    '0xd13d20e79539da1c18dd2482186a4e7f92be0979': 'Circle faucet sender',
    '0x3feeed1a260e4b981ebdcdd504fa98a7d9bfe965': 'Circle faucet sender',
    '0xa8f55d2e691ec91d0f2325051a51f3d686a3b4f0': 'Circle faucet sender',
  },
};

export const knownHubsFor = (chainId: number): string[] => Object.keys(KNOWN_HUBS[chainId] ?? {});

import type { Address } from '@argus/scoring';

export type Network = 'mainnet' | 'testnet';

export interface NetworkInfo {
  chainId: number;
  name: string;
  /** Circle USDC (matched by address, never by symbol: lookalike tokens exist). */
  usdc: Address;
  /** First block with a USDC transfer; nothing earlier needs scanning. */
  usdcStartBlock: number;
  hypersync: string;
  /** Argus PayerAttestations registry. */
  registry: Address;
  /** The attestor the hosted Argus analyzer publishes under. Anyone can attest; consumers choose whom to trust. */
  defaultAttestor: Address;
  /** ERC-8004 registries on Monad (verified on-chain, 2026-10-09). The Validation registry is not deployed yet. */
  erc8004: { identity: Address; reputation: Address };
  explorer: string;
}

export const NETWORKS: Record<Network, NetworkInfo> = {
  mainnet: {
    chainId: 143,
    name: 'Monad',
    usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    usdcStartBlock: 22_909_000,
    hypersync: 'https://monad.hypersync.xyz',
    registry: '0x151e488618FC0F79F7f91447351174Fb8D98cE98',
    defaultAttestor: '0xF9E8A2cc9600499AA009357a8Fa63F15079A4238',
    erc8004: {
      identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    },
    explorer: 'https://monadvision.com',
  },
  testnet: {
    chainId: 10143,
    name: 'Monad Testnet',
    usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
    usdcStartBlock: 75_000,
    hypersync: 'https://monad-testnet.hypersync.xyz',
    registry: '0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE',
    defaultAttestor: '0x6E7A4132c27248F56B4aEeE2513d6655370a323b',
    erc8004: {
      identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
      reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    },
    explorer: 'https://testnet.monadvision.com',
  },
};

export const networkFor = (n: Network): NetworkInfo => NETWORKS[n];

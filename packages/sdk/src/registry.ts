import { createPublicClient, http, type PublicClient } from 'viem';
import { monad, monadTestnet } from 'viem/chains';
import { TIER_NAMES, type Address, type Hex, type Tier, type TierName } from '@argus/scoring';
import { NETWORKS, type Network } from './networks.ts';
import { registryAbi } from './registry-abi.ts';

export { registryAbi } from './registry-abi.ts';

export interface OnchainVerdict {
  wallet: Address;
  attestor: Address;
  /** The tier to act on: Unclear when there is no verdict or it has expired. */
  tier: Tier;
  tierName: TierName;
  /** Stored tier even when expired. */
  storedTier: number;
  operatorId: Hex;
  groupSize: number;
  issuedAt: number;
  expiresAt: number;
  evidenceHash: Hex;
  expired: boolean;
  exists: boolean;
}

/** Reads verdicts from a PayerAttestations registry. No key needed. */
export class RegistryReader {
  private client: PublicClient;
  readonly address: Address;

  constructor(
    private readonly network: Network,
    opts: { rpcUrl?: string; registry?: Address } = {},
  ) {
    const chain = network === 'mainnet' ? monad : monadTestnet;
    this.address = opts.registry ?? NETWORKS[network].registry;
    this.client = createPublicClient({ chain, transport: http(opts.rpcUrl || chain.rpcUrls.default.http[0]) }) as PublicClient;
  }

  async verdictOf(wallet: Address, attestor: Address = NETWORKS[this.network].defaultAttestor, now = Math.floor(Date.now() / 1000)): Promise<OnchainVerdict> {
    const v = await this.client.readContract({ address: this.address, abi: registryAbi, functionName: 'verdictOf', args: [wallet, attestor] });
    const exists = v.expiresAt > 0n;
    const expired = !exists || Number(v.expiresAt) <= now;
    const tier = (expired ? 0 : v.tier) as Tier;
    return {
      wallet,
      attestor,
      tier,
      tierName: TIER_NAMES[tier] ?? 'Unclear',
      storedTier: v.tier,
      operatorId: v.operatorId,
      groupSize: v.groupSize,
      issuedAt: Number(v.issuedAt),
      expiresAt: Number(v.expiresAt),
      evidenceHash: v.evidenceHash,
      expired,
      exists,
    };
  }

  /** True when both wallets hold fresh, non-Unclear verdicts from `attestor` with the same operator. */
  async sameOperator(a: Address, b: Address, attestor: Address = NETWORKS[this.network].defaultAttestor): Promise<boolean> {
    return this.client.readContract({ address: this.address, abi: registryAbi, functionName: 'sameOperator', args: [a, b, attestor] });
  }
}

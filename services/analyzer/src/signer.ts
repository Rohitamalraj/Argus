import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad, monadTestnet } from 'viem/chains';
import type { Network } from './networks.ts';

/** SG-1: everything that writes on-chain goes through a Signer, so the key can live in Dynamic instead. */
export interface Signer {
  readonly address: Address;
  writeContract(args: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<'success' | 'reverted'>;
}

export class LocalKeySigner implements Signer {
  readonly address: Address;
  private wallet;
  private pub;

  constructor(network: Network, key: Hex, rpcUrl?: string) {
    const chain = network === 'mainnet' ? monad : monadTestnet;
    const transport = http(rpcUrl || chain.rpcUrls.default.http[0]);
    const account = privateKeyToAccount(key);
    this.address = account.address;
    this.wallet = createWalletClient({ chain, transport, account });
    this.pub = createPublicClient({ chain, transport });
  }

  writeContract(args: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }): Promise<Hex> {
    return this.wallet.writeContract(args as Parameters<typeof this.wallet.writeContract>[0]);
  }

  async waitForReceipt(hash: Hex): Promise<'success' | 'reverted'> {
    return (await this.pub.waitForTransactionReceipt({ hash })).status;
  }
}

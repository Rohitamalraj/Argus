import { createPublicClient, encodeFunctionData, http, type Abi, type Address, type Hex, type TransactionSerializable } from 'viem';
import { monad, monadTestnet } from 'viem/chains';
import type { Network } from './networks.ts';
import type { Signer } from './signer.ts';

/** The part of Dynamic's Node SDK the signer uses (`DynamicEvmWalletClient`). Tests pass a fake. */
export interface DynamicEvmClient {
  signTransaction(args: { walletMetadata: unknown; transaction: TransactionSerializable; password?: string }): Promise<string>;
}

export interface DynamicWalletFile {
  /** The `walletMetadata` returned by createWalletAccount (public: carries no key share). */
  walletMetadata: { accountAddress: Address } & Record<string, unknown>;
}

/**
 * SG-1: the attestor key lives in Dynamic as an MPC wallet (backed up to Dynamic), so this host never holds a raw
 * private key. Dynamic signs; we prepare and broadcast the transaction over the public RPC.
 */
export class DynamicSigner implements Signer {
  readonly address: Address;
  private pub;
  private chain;

  constructor(
    network: Network,
    private readonly client: DynamicEvmClient,
    private readonly wallet: DynamicWalletFile,
    private readonly password?: string,
    rpcUrl?: string,
  ) {
    this.chain = network === 'mainnet' ? monad : monadTestnet;
    this.pub = createPublicClient({ chain: this.chain, transport: http(rpcUrl || this.chain.rpcUrls.default.http[0]) });
    this.address = wallet.walletMetadata.accountAddress;
  }

  async writeContract(args: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }): Promise<Hex> {
    const data = encodeFunctionData({ abi: args.abi, functionName: args.functionName, args: args.args } as Parameters<typeof encodeFunctionData>[0]);
    const req = await this.pub.prepareTransactionRequest({ account: this.address, to: args.address, data, chain: this.chain, type: 'eip1559' });
    const { from: _from, ...transaction } = req as typeof req & { from?: Address };
    const signed = await this.client.signTransaction({
      walletMetadata: this.wallet.walletMetadata,
      transaction: { ...transaction, chainId: this.chain.id, type: 'eip1559' } as TransactionSerializable,
      ...(this.password ? { password: this.password } : {}),
    });
    return this.pub.sendRawTransaction({ serializedTransaction: signed as Hex });
  }

  async waitForReceipt(hash: Hex): Promise<'success' | 'reverted'> {
    return (await this.pub.waitForTransactionReceipt({ hash })).status;
  }
}

/** Authenticate Dynamic's Node SDK with the environment's API token. Loaded lazily: it is a heavy optional dependency. */
export async function dynamicEvmClient(environmentId: string, apiToken: string): Promise<DynamicEvmClient> {
  const { DynamicEvmWalletClient } = await import('@dynamic-labs-wallet/node-evm');
  const client = new DynamicEvmWalletClient({ environmentId, enableMPCAccelerator: false });
  await client.authenticateApiToken(apiToken);
  return client as unknown as DynamicEvmClient;
}

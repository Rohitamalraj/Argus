/**
 * Create the attestor's Dynamic MPC server wallet (no money moves).
 *   npm run dynamic:create -w @argus/analyzer
 * Writes data/dynamic-attestor.json (gitignored). Send the wallet a little MON, then start the analyzer with
 * DYNAMIC_ATTESTOR_NETWORK=testnet (or mainnet) and it signs attestations through Dynamic with no raw key on the host.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ROOT } from './env.ts';
import { dynamicAttestorPath } from './dynamic-config.ts';

const { ThresholdSignatureScheme } = await import('@dynamic-labs-wallet/core');
const { DynamicEvmWalletClient } = await import('@dynamic-labs-wallet/node-evm');
const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
const apiToken = process.env.DYNAMIC_API_TOKEN;
if (!environmentId || !apiToken) throw new Error('DYNAMIC_ENVIRONMENT_ID and DYNAMIC_API_TOKEN are required');

const client = new DynamicEvmWalletClient({ environmentId, enableMPCAccelerator: false });
await client.authenticateApiToken(apiToken);
const { walletMetadata } = await client.createWalletAccount({
  thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
  password: process.env.DYNAMIC_WALLET_PASSWORD,
  backUpToDynamic: true,
  onError: (e: Error) => console.error('wallet creation error:', e),
});
const file = dynamicAttestorPath(ROOT);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ walletMetadata }, null, 2));
console.log(`Dynamic attestor wallet: ${walletMetadata.accountAddress}\nSaved ${file}. Fund it with a little MON, then run the analyzer with DYNAMIC_ATTESTOR_NETWORK set.`);
process.exit(0);

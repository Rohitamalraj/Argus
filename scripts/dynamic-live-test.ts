/** Live check (testnet): publish one verdict signed by the Dynamic MPC wallet. Run on Linux/macOS (WSL). */
import { readFileSync } from 'node:fs';
import { DynamicSigner, dynamicEvmClient } from '../services/analyzer/src/dynamic-signer.ts';
import { registryAbi } from '../packages/sdk/src/registry-abi.ts';
const wallet = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const client = await dynamicEvmClient(process.env.DYNAMIC_ENVIRONMENT_ID!, process.env.DYNAMIC_API_TOKEN!);
const signer = new DynamicSigner('testnet', client, wallet, process.env.DYNAMIC_WALLET_PASSWORD);
const now = BigInt(Math.floor(Date.now() / 1000));
const hash = await signer.writeContract({
  address: '0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE',
  abi: registryAbi,
  functionName: 'attestBatch',
  args: [['0x00000000000000000000000000000000000d1a1c'], [{ operatorId: `0x${'11'.repeat(32)}`, tier: 2, groupSize: 1, issuedAt: now, expiresAt: now + 3600n, evidenceHash: `0x${'22'.repeat(32)}` }]],
});
console.log('signer', signer.address, 'tx', hash, await signer.waitForReceipt(hash));
process.exit(0);

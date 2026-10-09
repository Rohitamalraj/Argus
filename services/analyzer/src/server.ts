/** Analyzer service.  npm run dev -w @argus/analyzer */
import { knownHubsFor, makeConfig } from '@argus/scoring';
import { createApi } from './api.ts';
import { Assessor, type WalletIntel } from './assessor.ts';
import { ROOT, attestorKey, env, sellerAddresses } from './env.ts';
import { NETWORKS, type Network } from './networks.ts';
import { ChainDataProvider, HyperSyncClient, agentReputation } from '@argus/sdk';
import { AgentReputationService } from './agents.ts';
import { Budget } from './budget.ts';
import { NansenProvider } from './providers/nansen.ts';
import { Publisher } from './publisher.ts';
import { SimRunner } from './sim.ts';
import { LocalKeySigner } from './signer.ts';
import { Store } from './store.ts';

if (!env.envioToken) throw new Error('ENVIO_API_TOKEN missing');
const store = new Store(env.dbPath);
const networks: Network[] = ['testnet', 'mainnet'];

const configFor = (n: Network) => makeConfig({ knownHubs: knownHubsFor(NETWORKS[n].chainId), closureExclude: sellerAddresses(n) });
const configs = { testnet: configFor('testnet'), mainnet: configFor('mainnet') };
const providerFor = (n: Network): WalletIntel =>
  new ChainDataProvider(new HyperSyncClient(NETWORKS[n].hypersync, NETWORKS[n].usdc, env.envioToken, NETWORKS[n].usdcStartBlock), NETWORKS[n].chainId, configs[n]);
const providers = { testnet: providerFor('testnet'), mainnet: providerFor('mainnet') };

// Deep check (mainnet only): Nansen, by API key while it has credits, optionally paying per call over x402.
async function buildNansen(): Promise<NansenProvider | undefined> {
  const usdc = NETWORKS.mainnet.usdc;
  let x402Fetch: typeof fetch | undefined;
  if (env.nansenPayX402) {
    const key = attestorKey('mainnet');
    if (key) {
      const { ExactEvmScheme } = await import('@x402/evm');
      const { wrapFetchWithPaymentFromConfig } = await import('@x402/fetch');
      const { privateKeyToAccount } = await import('viem/accounts');
      x402Fetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: 'eip155:143', client: new ExactEvmScheme(privateKeyToAccount(key)) }] }) as typeof fetch;
    }
  }
  if (!env.nansenApiKey && !x402Fetch) return undefined;
  return new NansenProvider({
    // With a key the key is used first; the x402 path sends no key (a valid key would take precedence over payment).
    ...(env.nansenApiKey ? { apiKey: env.nansenApiKey } : {}),
    ...(x402Fetch ? { x402Fetch } : {}),
    usdc,
    minFundingUsdc: 0.01,
    budget: new Budget({ dailyCapUsd: env.nansenDailyCapUsd, perWalletCalls: 3 }),
    log: console.log,
  });
}
const nansen = await buildNansen();
console.log(nansen ? `[nansen] deep check on for mainnet (${env.nansenApiKey ? 'API key' : 'x402'}, cap $${env.nansenDailyCapUsd}/day)` : '[nansen] off (no API key)');

const assessor = new Assessor({ store, salt: env.salt, providers, configs, ...(nansen ? { deep: nansen } : {}) });

for (const n of networks) {
  const key = attestorKey(n);
  const registry = NETWORKS[n].registry;
  if (!key || !registry) {
    console.log(`[publish ${n}] off (no attestor key or registry)`);
    continue;
  }
  if (n === 'mainnet' && !env.publishMainnet) {
    console.log('[publish mainnet] off (set PUBLISH_MAINNET=true to spend MON on attestations)');
    continue;
  }
  const signer = new LocalKeySigner(n, key);
  new Publisher(n, store, signer, registry).start();
  console.log(`[publish ${n}] on, attestor ${signer.address}, registry ${registry}`);
}

const sim = new SimRunner({ root: ROOT, sellerUrl: process.env.SIM_SELLER_URL ?? 'http://localhost:4021' });
const agents = new AgentReputationService((net, id, sample) =>
  agentReputation(id, { chain: new HyperSyncClient(NETWORKS[net].hypersync, NETWORKS[net].usdc, env.envioToken, 0), network: net === 'mainnet' ? 'mainnet' : 'testnet', maxClients: sample }),
);
createApi({ store, assessor, sim, agents }).listen(env.port, () => console.log(`Argus analyzer on http://localhost:${env.port}`));

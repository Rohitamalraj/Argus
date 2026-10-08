/** Analyzer service.  npm run dev -w @argus/analyzer */
import { knownHubsFor, makeConfig } from '@argus/scoring';
import { createApi } from './api.ts';
import { Assessor, type WalletIntel } from './assessor.ts';
import { attestorKey, env, sellerAddresses } from './env.ts';
import { NETWORKS, type Network } from './networks.ts';
import { ChainDataProvider } from './providers/chain.ts';
import { HyperSyncClient } from './providers/hypersync.ts';
import { Publisher } from './publisher.ts';
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

const assessor = new Assessor({ store, salt: env.salt, providers, configs });

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

createApi({ store, assessor }).listen(env.port, () => console.log(`Argus analyzer on http://localhost:${env.port}`));

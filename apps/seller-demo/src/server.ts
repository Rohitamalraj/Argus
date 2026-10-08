/**
 * Demo x402 seller (SD-1): a paid API with a 20-call half-price promo, protected by Argus.
 * Run two instances (SD-3) to show both read the same verdicts:
 *   NETWORK=testnet PORT=4021 SELLER_NAME=seller-a npm start -w @argus/seller-demo
 *   NETWORK=testnet PORT=4022 SELLER_NAME=seller-b npm start -w @argus/seller-demo
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import { argus, type Address, type ArgusNetwork } from '@argus/middleware';

const ROOT = resolve(import.meta.dirname, '../../..');
loadEnv({ path: resolve(ROOT, '.env'), quiet: true });

const network = (process.env.NETWORK ?? 'testnet') as ArgusNetwork;
const port = Number(process.env.PORT ?? 4021);
const seller = process.env.SELLER_NAME ?? 'seller-a';

type WalletFile = { wallets: { role: string; address: Address }[] };
const walletFile = resolve(ROOT, `wallets.${network}.json`);
const wallets = existsSync(walletFile) ? (JSON.parse(readFileSync(walletFile, 'utf8')) as WalletFile).wallets : [];
const payTo = (process.env.SELLER_PAY_TO_ADDRESS as Address | undefined) ?? wallets.find((w) => w.role === 'seller')?.address;
const attestor = (process.env.ATTESTOR_ADDRESS as Address | undefined) ?? wallets.find((w) => w.role === 'attestor')?.address;
if (!payTo) throw new Error('No seller payTo: set SELLER_PAY_TO_ADDRESS or create wallets');

// Testnet runs cost 0.001 USDC per promo call so the judge simulation can run many times.
const price = network === 'testnet' ? { standard: '$0.002', promo: '$0.001' } : { standard: '$0.01', promo: '$0.005' };

const app = express();
app.use(
  argus({
    network,
    payTo,
    price,
    routes: ['GET /api/premium'],
    policy: { promoCalls: 20, promoPerOperator: true },
    attestors: attestor ? [attestor] : [],
    analyzerUrl: process.env.ANALYZER_URL ?? 'http://localhost:8787',
    seller,
    // A judge simulation run passes its own namespace so promo counters start at zero.
    namespace: (req) => `${seller}:${req.header('x-argus-namespace') ?? 'live'}`,
    description: 'Monad market signal (demo)',
    log: (m) => console.log(m),
  }),
);

app.get('/api/premium', (req, res) => {
  res.json({
    seller,
    data: { signal: 'MON/USDC momentum', value: Math.round(Math.random() * 1000) / 10, at: new Date().toISOString() },
    argus: req.argus,
  });
});
app.get('/health', (_req, res) => res.json({ ok: true, seller, network, payTo }));

app.listen(port, () => console.log(`${seller} on http://localhost:${port} (${network}, payTo ${payTo}, promo ${price.promo}, standard ${price.standard})`));

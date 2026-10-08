import express, { type NextFunction, type Request, type Response } from 'express';
import { isAddress } from 'viem';
import type { Address } from '@argus/scoring';
import type { Assessor } from './assessor.ts';
import type { Network } from './networks.ts';
import type { Store } from './store.ts';

export interface ApiDeps {
  store: Store;
  assessor: Assessor;
  now?: () => number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const network = (v: unknown): Network => {
  if (v === 'testnet' || v === 'mainnet') return v;
  throw new HttpError(400, 'network must be "testnet" or "mainnet"');
};
const address = (v: unknown): Address => {
  if (typeof v === 'string' && isAddress(v, { strict: false })) return v.toLowerCase() as Address;
  throw new HttpError(400, `invalid address: ${String(v)}`);
};
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function createApi({ store, assessor, now = () => Math.floor(Date.now() / 1000) }: ApiDeps) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  /** AN-1: verdicts for one or many wallets. depth "deep" (Nansen) is mainnet-only and not wired yet. */
  app.post(
    '/v1/assess',
    wrap(async (req, res) => {
      const net = network(req.body?.network);
      const wallets = (Array.isArray(req.body?.wallets) ? req.body.wallets : []).map(address);
      if (wallets.length === 0 || wallets.length > 100) throw new HttpError(400, 'wallets must hold 1 to 100 addresses');
      const verdicts = await assessor.assess(net, wallets, req.body?.fresh === true);
      res.json({ verdicts, depth: 'light', cost: { usd: 0 } });
    }),
  );

  /** MW-2: latest fresh verdict, including pre-computed ones. 404 means no verdict. */
  app.get(
    '/v1/wallet/:address',
    wrap(async (req, res) => {
      const v = store.getVerdict(network(req.query.network ?? 'testnet'), address(req.params.address));
      if (!v || v.expiresAt <= now()) throw new HttpError(404, 'no verdict');
      res.json(v);
    }),
  );

  /** A seller reports a settled payment: the wallet becomes eligible for publishing (AN-7). */
  app.post(
    '/v1/paid',
    wrap(async (req, res) => {
      const net = network(req.body?.network);
      const wallet = address(req.body?.wallet);
      const seller = String(req.body?.seller ?? 'unknown').slice(0, 100);
      store.markPaid(net, wallet, seller, now());
      const [v] = await assessor.assess(net, [wallet]);
      store.markPaid(net, wallet, seller, now()); // the verdict row may not have existed before
      res.json(store.getVerdict(net, wallet) ?? v);
    }),
  );

  app.get('/v1/evidence/:hash', (req, res) => {
    const e = store.getEvidence(req.params.hash);
    if (!e) return void res.status(404).json({ error: 'not found' });
    res.json(e);
  });

  /** DB-1: paying wallets resolved into customers. Linked wallets of one operator count once. */
  app.get(
    '/v1/overview',
    wrap(async (req, res) => {
      const net = network(req.query.network ?? 'testnet');
      const wallets = store.paidVerdicts(net).filter((v) => v.expiresAt > now());
      const operators = new Map<string, { operatorId: string; firstFunder: string | null; tierName: string; wallets: string[] }>();
      for (const v of wallets) {
        if (v.tier === 0) continue;
        const o = operators.get(v.operatorId) ?? { operatorId: v.operatorId, firstFunder: v.firstFunder, tierName: v.tierName, wallets: [] };
        o.wallets.push(v.wallet);
        operators.set(v.operatorId, o);
      }
      const count = (t: string) => wallets.filter((v) => v.tierName === t).length;
      res.json({
        network: net,
        counts: {
          rawWallets: wallets.length,
          customers: operators.size + count('Unclear'),
          operators: [...operators.values()].filter((o) => o.tierName === 'Linked').length,
          linked: count('Linked'),
          independent: count('Independent'),
          unclear: count('Unclear'),
        },
        operators: [...operators.values()],
        wallets,
        costs: store.costs().filter((c) => c.network === net),
      });
    }),
  );

  app.get('/v1/costs', (_req, res) => {
    res.json({ costs: store.costs() });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: (err as Error).message });
  });
  return app;
}

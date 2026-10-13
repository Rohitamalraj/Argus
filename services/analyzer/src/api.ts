import express, { type NextFunction, type Request, type Response } from 'express';
import { isAddress } from 'viem';
import type { Address } from '@argus/scoring';
import type { AgentReputationService } from './agents.ts';
import type { Assessor } from './assessor.ts';
import type { Network } from './networks.ts';
import type { SimRunner } from './sim.ts';
import type { Store } from './store.ts';

export interface ApiDeps {
  store: Store;
  assessor: Assessor;
  sim?: SimRunner;
  agents?: AgentReputationService;
  /** The demo seller to expose at /seller (internal URL). */
  sellerUrl?: string;
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

export function createApi({ store, assessor, sim, agents, sellerUrl, now = () => Math.floor(Date.now() / 1000) }: ApiDeps) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, payment-signature, x-payment, x-payer-address, x-argus-namespace');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-expose-headers', 'payment-required, payment-response, x-payment-response');
    if (_req.method === 'OPTIONS') return void res.status(204).end();
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
      const depth = req.body?.depth === 'deep' ? 'deep' : 'light';
      const verdicts = await assessor.assess(net, wallets, req.body?.fresh === true, depth);
      res.json({ verdicts, depth: verdicts.every((v) => v.depth === 'deep') ? 'deep' : 'light', requestedDepth: depth });
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
      const b = req.body ?? {};
      store.addClaim({
        network: net,
        wallet,
        seller,
        ...(typeof b.ns === 'string' ? { ns: b.ns.slice(0, 100) } : {}),
        promo: b.promo === true,
        ...(typeof b.amount === 'string' ? { amount: b.amount.slice(0, 30) } : {}),
        ...(typeof b.tierName === 'string' ? { tier: b.tierName.slice(0, 30) } : {}),
        ...(typeof b.operatorId === 'string' ? { operator: b.operatorId.slice(0, 80) } : {}),
        ...(typeof b.promoLeft === 'number' ? { promoLeft: b.promoLeft } : {}),
        ...(typeof b.tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(b.tx) ? { tx: b.tx } : {}),
        ts: now(),
      });
      // A settled promo claim on mainnet also gets the Nansen cross-check (AN-2); everything else stays light.
      const [v] = await assessor.assess(net, [wallet], false, req.body?.promo === true ? 'deep' : 'light');
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

  /**
   * ERC-8004 reputation for an agent, deduplicated by operator. Large agents are traced from a sample
   * (default 800 reviewers); results are cached for an hour.
   */
  app.get(
    '/v1/agent/:id/reputation',
    wrap(async (req, res) => {
      if (!agents) throw new HttpError(503, 'agent reputation is not set up on this server');
      const agentId = req.params.id ?? '';
      if (!/^[0-9]{1,30}$/.test(agentId)) throw new HttpError(400, 'agent id must be a number');
      const net = network(req.query.network ?? 'mainnet');
      const sample = Math.min(5000, Math.max(50, Number(req.query.sample ?? 800) || 800));
      const { reputation, cached } = await agents.get(net, agentId, sample);
      const { operators, clientAllowlist, ...rest } = reputation;
      res.json({ ...rest, cached, topOperators: operators.slice(0, 20), clientAllowlistSize: clientAllowlist.length, clientAllowlist: clientAllowlist.slice(0, 200) });
    }),
  );

  /** AN-12: judge simulation on testnet. Concurrent clicks share one run; at most one run a minute. */
  app.post(
    '/v1/sim/run',
    wrap(async (_req, res) => {
      if (!sim || !sim.available()) throw new HttpError(503, 'simulation is not set up on this server');
      const r = sim.run();
      if ('tooSoon' in r) {
        res.status(429).json({ ok: false, error: `A run just finished; try again in ${r.tooSoon} s`, last: r.last });
        return;
      }
      res.json({ ...(await r.result), joined: r.joined });
    }),
  );

  /** Real settled payments at the demo seller, newest first: who paid, at which price, and the transaction. */
  app.get(
    '/v1/claims',
    wrap(async (req, res) => {
      const net = network(req.query.network ?? 'testnet');
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
      const ns = typeof req.query.ns === 'string' ? req.query.ns.slice(0, 100) : undefined;
      const claims = store.recentClaims(net, limit, ns);
      // Per operator: how many promo calls have settled (the shared allowance), and which wallets used it.
      const ops = new Map<string, { operator: string; tier: string; promoUsed: number; standardPaid: number; wallets: Set<string> }>();
      for (const c of store.recentClaims(net, 1000, ns)) {
        const k = c.operator ?? c.wallet;
        const o = ops.get(k) ?? { operator: k, tier: c.tier ?? 'Unknown', promoUsed: 0, standardPaid: 0, wallets: new Set<string>() };
        c.promo ? o.promoUsed++ : o.standardPaid++;
        o.wallets.add(c.wallet);
        ops.set(k, o);
      }
      res.json({
        network: net,
        claims,
        operators: [...ops.values()].map((o) => ({ ...o, wallets: [...o.wallets] })).sort((a, b) => b.wallets.length - a.wallets.length),
      });
    }),
  );

  /**
   * The demo seller, public through this server so a browser can pay it over x402. It only forwards GET
   * and OPTIONS to the seller running next to the analyzer, and limits wallet quotes per client.
   */
  if (sellerUrl) {
    const hits = new Map<string, { n: number; reset: number }>();
    app.use('/seller', (req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'OPTIONS') return void res.status(204).end();
      if (req.method !== 'GET') return void res.status(405).json({ error: 'GET only' });
      if (req.path === '/api/quote') {
        const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? 'x').split(',')[0]!.trim();
        const t = Date.now();
        const h = hits.get(ip);
        if (!h || h.reset < t) hits.set(ip, { n: 1, reset: t + 60_000 });
        else if (++h.n > 40) return void res.status(429).json({ error: 'too many quote requests, try again in a minute' });
      }
      const skip = new Set(['host', 'connection', 'content-length', 'accept-encoding']);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (!skip.has(k) && typeof v === 'string') headers[k] = v;
      fetch(sellerUrl + req.originalUrl.replace(/^\/seller/, ''), { headers, signal: AbortSignal.timeout(60_000) })
        .then(async (r) => {
          res.status(r.status);
          r.headers.forEach((v, k) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'access-control-allow-origin'].includes(k)) res.setHeader(k, v);
          });
          res.send(Buffer.from(await r.arrayBuffer()));
        })
        .catch(next);
    });
  }

  app.get('/v1/costs', (_req, res) => {
    res.json({ costs: store.costs() });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: (err as Error).message });
  });
  return app;
}

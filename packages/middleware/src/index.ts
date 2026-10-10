import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { paymentMiddleware } from '@x402/express';
import { createCore, type ArgusDeps } from './core.ts';
import type { ArgusOptions } from './types.ts';

export * from './types.ts';
export { quote, MemoryPromoStore, DEFAULT_POLICY, type Quote } from './policy.ts';
export { FilePromoStore } from './file-store.ts';
export { VerdictSource } from './verdicts.ts';
export { claimedPayer, signedPayer, decodePayment } from './payer.ts';
export { ARGUS_NETWORKS, MONAD_FACILITATOR, usdToUnits, createCore, type ArgusDeps, type ArgusCore, type ArgusContext, type ArgusRequest } from './core.ts';

/**
 * Argus x402 middleware for Express. Quotes each payer the promo or the standard price, enforces it against the
 * signed payer on the paid retry, and counts promos per operator. (Hono: `argus-x402-middleware/hono`, Next: `/next`.)
 *
 *   app.use(argus({ network: 'testnet', payTo, price: { standard: '$0.01', promo: '$0.005' },
 *                   routes: ['GET /api/premium'], attestors: [ANALYZER], analyzerUrl }));
 */
export function argus(o: ArgusOptions, deps: ArgusDeps = {}): RequestHandler {
  const core = createCore(o, deps);
  const pay = paymentMiddleware(core.routes, core.server);
  return async (req: Request, res: Response, next: NextFunction) => {
    const view = { method: req.method, path: req.path, header: (n: string) => req.headers[n.toLowerCase()], raw: req };
    if (!core.matches(view)) return next();
    const ctx = await core.begin(view);
    req.argus = ctx.info;
    res.setHeader('x-argus-tier', ctx.info.tierName);
    res.setHeader('x-argus-price', ctx.quote.price);
    core.run(ctx, () => void pay(req, res, next));
  };
}

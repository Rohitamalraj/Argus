import type { MiddlewareHandler } from 'hono';
import { paymentMiddleware } from '@x402/hono';
import { createCore, type ArgusDeps } from './core.ts';
import type { ArgusInfo, ArgusOptions } from './types.ts';

export * from './types.ts';
export { quote, MemoryPromoStore, DEFAULT_POLICY, type Quote } from './policy.ts';
export { FilePromoStore } from './file-store.ts';
export { createCore, type ArgusDeps } from './core.ts';

/** Add to your Hono `Variables` to read the verdict with `c.get('argus')`. */
export type ArgusHonoVariables = { argus: ArgusInfo };

/**
 * Argus x402 middleware for Hono: the same promo-per-operator pricing as the Express version.
 *
 *   app.use('*', argus({ network: 'mainnet', payTo, price: { standard: '$0.01', promo: '$0.005' }, routes: ['GET /api/premium'] }));
 *   app.get('/api/premium', (c) => c.json({ tier: c.get('argus').tierName }));
 */
export function argus(o: ArgusOptions, deps: ArgusDeps = {}): MiddlewareHandler {
  const core = createCore(o, deps);
  const pay = paymentMiddleware(core.routes, core.server);
  return async (c, next) => {
    const view = { method: c.req.method, path: c.req.path, header: (n: string) => c.req.header(n), raw: c.req.raw };
    if (!core.matches(view)) return next();
    const ctx = await core.begin(view);
    c.set('argus', ctx.info);
    c.header('x-argus-tier', ctx.info.tierName);
    c.header('x-argus-price', ctx.quote.price);
    return core.run(ctx, () => pay(c, next));
  };
}

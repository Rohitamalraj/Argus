import type { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@x402/next';
import { createCore, type ArgusDeps } from './core.ts';
import type { ArgusInfo, ArgusOptions } from './types.ts';

export * from './types.ts';
export { quote, MemoryPromoStore, DEFAULT_POLICY, type Quote } from './policy.ts';
export { FilePromoStore } from './file-store.ts';
export { createCore, type ArgusDeps } from './core.ts';

/**
 * Argus x402 for Next.js App Router route handlers: one promo per operator, the standard price after that.
 *
 *   const protect = argus({ network: 'mainnet', payTo, price: { standard: '$0.01', promo: '$0.005' }, routes: ['GET /api/premium'] });
 *   export const GET = protect(async (req, argus) => NextResponse.json({ tier: argus.tierName }));
 */
export function argus(o: ArgusOptions, deps: ArgusDeps = {}) {
  const core = createCore(o, deps);
  return function protect<T = unknown>(handler: (req: NextRequest, argus: ArgusInfo) => Promise<NextResponse<T>>): (req: NextRequest) => Promise<NextResponse<T>> {
    const paid = withX402<T>(async (req) => handler(req, core.current()!.info), core.routes, core.server);
    return async (req) => {
      const view = { method: req.method, path: req.nextUrl.pathname, header: (n: string) => req.headers.get(n), raw: req };
      if (!core.matches(view)) return handler(req, (await core.begin(view)).info);
      const ctx = await core.begin(view);
      const res = await core.run(ctx, () => paid(req));
      res.headers.set('x-argus-tier', ctx.info.tierName);
      res.headers.set('x-argus-price', ctx.quote.price);
      return res;
    };
  };
}

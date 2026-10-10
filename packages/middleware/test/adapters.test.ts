import { Hono } from 'hono';
import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { argus as argusHono, type ArgusHonoVariables } from '../src/hono.ts';
import { argus as argusNext } from '../src/next.ts';
import type { VerdictResolver, VerdictView } from '../src/index.ts';

const OP = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const w = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const view = (tierName: VerdictView['tierName']): Omit<VerdictView, 'source'> => ({
  tier: tierName === 'Linked' ? 1 : 2,
  tierName,
  operatorId: OP,
  confidence: 'high',
  reasons: ['computed locally'],
  expiresAt: 4e9,
});
const opts = (resolver: VerdictResolver) => ({
  network: 'testnet' as const,
  payTo: w(0xbeef),
  price: { standard: '$0.01', promo: '$0.005' },
  routes: ['GET /api/premium'],
  lookupTimeoutMs: 10,
  resolver,
});
const amountOf = (headers: Headers) => JSON.parse(Buffer.from(headers.get('payment-required')!, 'base64').toString('utf8')).accepts[0].amount as string;

describe('Hono adapter', () => {
  it('quotes the promo to a payer whose verdict is pending or Linked, and passes unprotected routes through', async () => {
    const app = new Hono<{ Variables: ArgusHonoVariables }>();
    app.use('*', argusHono(opts(async () => (await wait(60), view('Linked')))));
    app.get('/api/premium', (c) => c.json({ tier: c.get('argus').tierName }));
    app.get('/free', (c) => c.json({ free: true }));
    const call = (path: string) => app.request(path, { headers: { 'x-payer-address': w(7) } });

    const first = await call('/api/premium');
    expect(first.status).toBe(402);
    expect(amountOf(first.headers)).toBe('5000'); // no verdict yet: optimistic promo
    await wait(150);
    const second = await call('/api/premium');
    expect(second.status).toBe(402);
    expect(amountOf(second.headers)).toBe('5000'); // Linked: promo until the operator's shared allowance is used
    expect((await call('/free')).status).toBe(200); // unprotected routes pass through
  }, 30_000);

  it('quotes the standard price to a payer judged Unclear', async () => {
    const unclear: VerdictResolver = async () => ({ ...view('Linked'), tier: 0, tierName: 'Unclear' });
    const app = new Hono();
    app.use('*', argusHono(opts(unclear)));
    app.get('/api/premium', (c) => c.json({ ok: true }));
    await app.request('/api/premium', { headers: { 'x-payer-address': w(8) } });
    await wait(100);
    const r = await app.request('/api/premium', { headers: { 'x-payer-address': w(8) } });
    expect(amountOf(r.headers)).toBe('10000');
  }, 30_000);
});

describe('Next adapter', () => {
  it('protects a route handler and hands it the verdict', async () => {
    const protect = argusNext(opts(async () => (await wait(60), view('Linked'))));
    const GET = protect(async (_req, info) => NextResponse.json({ tier: info.tierName }));
    const req = () => new NextRequest('http://localhost/api/premium', { headers: { 'x-payer-address': w(9) } });

    const r = await GET(req());
    expect(r.status).toBe(402);
    expect(amountOf(r.headers)).toBe('5000');
    expect(r.headers.get('x-argus-price')).toBe('promo');
  }, 30_000);

  it('lets an unprotected route through to the handler', async () => {
    const protect = argusNext(opts(async () => view('Linked')));
    const GET = protect(async () => NextResponse.json({ free: true }));
    const r = await GET(new NextRequest('http://localhost/other'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ free: true });
  });
});

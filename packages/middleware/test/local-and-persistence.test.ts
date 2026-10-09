import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, FilePromoStore, MemoryPromoStore, VerdictSource, argus, quote, type VerdictResolver, type VerdictView } from '../src/index.ts';

const OP = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const w = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const view = (tierName: VerdictView['tierName'], expiresAt = 4e9): Omit<VerdictView, 'source'> => ({
  tier: tierName === 'Linked' ? 1 : tierName === 'Independent' ? 2 : 0,
  tierName,
  operatorId: tierName === 'Unclear' ? (('0x' + '00'.repeat(32)) as `0x${string}`) : OP,
  confidence: 'high',
  reasons: ['computed locally'],
  expiresAt,
});
const source = (resolver: VerdictResolver, lookupTimeoutMs = 300) => new VerdictSource({ network: 'testnet', attestors: [], resolver, lookupTimeoutMs });

describe('local verdict resolver (no Argus server)', () => {
  it('uses a fast answer immediately, then serves it from cache', async () => {
    let calls = 0;
    const s = source(async () => (calls++, view('Linked')));
    expect(await s.lookup(w(1))).toMatchObject({ tierName: 'Linked', source: 'local' });
    expect(await s.lookup(w(1))).toMatchObject({ tierName: 'Linked', source: 'cache' });
    expect(calls).toBe(1);
  });

  it('never makes a request wait for a slow answer, and uses it once it lands', async () => {
    const s = source(async () => (await wait(80), view('Linked')), 15);
    const t0 = Date.now();
    expect(await s.lookup(w(2))).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(60);
    await wait(120);
    expect(await s.lookup(w(2))).toMatchObject({ tierName: 'Linked' });
  });

  it('runs the resolver once for simultaneous requests', async () => {
    let calls = 0;
    const s = source(async () => (calls++, await wait(40), view('Independent')), 15);
    await Promise.all([s.lookup(w(3)), s.lookup(w(3)), s.lookup(w(3))]);
    expect(calls).toBe(1);
  });

  it('a failing resolver reads as no verdict and never throws', async () => {
    const s = source(async () => {
      throw new Error('HyperSync 401');
    });
    expect(await s.lookup(w(4))).toBeUndefined();
  });

  it('an expired verdict from the resolver is not trusted', async () => {
    let calls = 0;
    const s = new VerdictSource({ network: 'testnet', attestors: [], resolver: async () => (calls++, view('Linked', 100)), lookupTimeoutMs: 50, now: () => 1_000 });
    await s.lookup(w(5));
    await s.lookup(w(5));
    expect(calls).toBe(2);
  });

  it('prices a payer from a local verdict through the real middleware', async () => {
    const app = express();
    app.use(
      argus({
        network: 'testnet',
        payTo: w(0xbeef),
        price: { standard: '$0.01', promo: '$0.005' },
        routes: ['GET /api/premium'],
        lookupTimeoutMs: 10,
        resolver: async () => (await wait(60), view('Unclear')),
      }),
    );
    app.get('/api/premium', (_req, res) => res.json({ ok: true }));
    const price = async () => {
      const r = await request(app).get('/api/premium').set('x-payer-address', w(9));
      return JSON.parse(Buffer.from(r.headers['payment-required'] as string, 'base64').toString('utf8')).accepts[0].amount as string;
    };
    expect(await price()).toBe('5000'); // no verdict yet: the optimistic first call gets the promo
    await wait(150);
    expect(await price()).toBe('10000'); // the local verdict (Unclear) is in: standard price
  }, 30_000);
});

describe('FilePromoStore (promo counters that survive a restart)', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'argus-promos-'));
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('keeps counts across instances, so a restart does not hand out the promo again', () => {
    const file = join(tmp(), 'promos.json');
    const policy = { ...DEFAULT_POLICY, promoCalls: 3 };
    const verdict: VerdictView = { ...view('Linked'), source: 'analyzer' };
    const first = new FilePromoStore(file, 0);
    for (let i = 0; i < 3; i++) first.consume(quote(w(1), verdict, { policy, store: first, ns: 's' }).key!);
    expect(quote(w(2), verdict, { policy, store: first, ns: 's' }).price).toBe('standard');

    const restarted = new FilePromoStore(file, 0);
    expect(quote(w(3), verdict, { policy, store: restarted, ns: 's' }).price).toBe('standard');
    // the in-memory store forgets: this is the problem the file store fixes
    expect(quote(w(3), verdict, { policy, store: new MemoryPromoStore(), ns: 's' }).price).toBe('promo');
  });

  it('writes after a short delay, on flush, and leaves no temp files', async () => {
    const dir = tmp();
    const file = join(dir, 'nested', 'promos.json');
    const s = new FilePromoStore(file, 30);
    s.consume('k');
    s.consume('k');
    await wait(90);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ k: 2 });
    s.consume('j');
    s.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ k: 2, j: 1 });
    expect(readdirSync(join(dir, 'nested'))).toEqual(['promos.json']);
  });

  it('starts empty from a damaged file and ignores bad values', () => {
    const dir = tmp();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(new FilePromoStore(bad, 0).used('k')).toBe(0);
    const odd = join(dir, 'odd.json');
    writeFileSync(odd, JSON.stringify({ good: 4, neg: -1, str: 'x', nan: null }));
    const s = new FilePromoStore(odd, 0);
    expect([s.used('good'), s.used('neg'), s.used('str'), s.used('nan')]).toEqual([4, 0, 0, 0]);
  });

  it('works as the middleware store option', () => {
    const file = join(tmp(), 'promos.json');
    const handler = argus({ network: 'testnet', payTo: w(0xbeef), price: { standard: '$0.01', promo: '$0.005' }, routes: ['GET /x'], store: new FilePromoStore(file, 0) });
    expect(typeof handler).toBe('function');
  });
});

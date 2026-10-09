import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, MemoryPromoStore, argus, claimedPayer, decodePayment, quote, type VerdictView } from '../src/index.ts';

const OP = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const linked: VerdictView = { tier: 1, tierName: 'Linked', operatorId: OP, expiresAt: 4e9, source: 'analyzer' };
const independent: VerdictView = { tier: 2, tierName: 'Independent', operatorId: ('0x' + 'bb'.repeat(32)) as `0x${string}`, expiresAt: 4e9, source: 'registry' };
const unclear: VerdictView = { tier: 0, tierName: 'Unclear', operatorId: ('0x' + '00'.repeat(32)) as `0x${string}`, expiresAt: 4e9, source: 'analyzer' };
const w = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;

describe('quote (MW-3, MW-4)', () => {
  const policy = { ...DEFAULT_POLICY, promoCalls: 3 };

  it('Linked wallets share one operator allowance', () => {
    const store = new MemoryPromoStore();
    let promos = 0;
    for (let call = 0; call < 5; call++) {
      for (let i = 0; i < 10; i++) {
        const q = quote(w(i), linked, { policy, store, ns: 's' });
        if (q.price === 'promo') {
          promos++;
          store.consume(q.key!);
        }
      }
    }
    expect(promos).toBe(3);
  });

  it('a farm of 10 gets at most promoCalls + 10 optimistic calls (PRD: 30 or fewer at 20)', () => {
    const store = new MemoryPromoStore();
    const p20 = { ...DEFAULT_POLICY };
    let promos = 0;
    for (let i = 0; i < 10; i++) {
      // worst case: every wallet's first call arrives before any verdict exists
      const q = quote(w(i), undefined, { policy: p20, store, ns: 's' });
      if (q.price === 'promo') (promos++, store.consume(q.key!));
    }
    for (let call = 0; call < 5; call++)
      for (let i = 0; i < 10; i++) {
        const q = quote(w(i), linked, { policy: p20, store, ns: 's' });
        if (q.price === 'promo') (promos++, store.consume(q.key!));
      }
    expect(promos).toBeLessThanOrEqual(30);
  });

  it('Independent wallets each get their own allowance', () => {
    const store = new MemoryPromoStore();
    const a = quote(w(1), independent, { policy, store, ns: 's' });
    store.consume(a.key!);
    const b = quote(w(2), independent, { policy, store, ns: 's' });
    expect(a.key).not.toBe(b.key);
    expect(b.promoLeft).toBe(3);
  });

  it('Unclear, unknown payer, mismatch and used-up optimistic call pay standard', () => {
    const store = new MemoryPromoStore();
    expect(quote(w(1), unclear, { policy, store, ns: 's' }).price).toBe('standard');
    expect(quote(undefined, independent, { policy, store, ns: 's' }).price).toBe('standard');
    expect(quote(w(1), independent, { policy, store, ns: 's', mismatch: true }).price).toBe('standard');
    const first = quote(w(9), undefined, { policy, store, ns: 's' });
    expect(first.price).toBe('promo');
    store.consume(first.key!);
    expect(quote(w(9), undefined, { policy, store, ns: 's' }).price).toBe('standard');
  });

  it('namespaces keep counters apart (fresh sim runs start at zero)', () => {
    const store = new MemoryPromoStore();
    for (let i = 0; i < 3; i++) store.consume(quote(w(1), linked, { policy, store, ns: 'run-1' }).key!);
    expect(quote(w(1), linked, { policy, store, ns: 'run-1' }).price).toBe('standard');
    expect(quote(w(1), linked, { policy, store, ns: 'run-2' }).price).toBe('promo');
  });
});

describe('payer headers (MW-1)', () => {
  it('reads the claim and decodes the signed payer', () => {
    expect(claimedPayer(' 0xAbCdEf0000000000000000000000000000000001 ')).toBe('0xabcdef0000000000000000000000000000000001');
    expect(claimedPayer('nope')).toBeUndefined();
    const header = Buffer.from(JSON.stringify({ x402Version: 2, payload: { authorization: { from: w(7), nonce: '0x01' }, signature: '0x' } })).toString('base64');
    expect(decodePayment(header)).toEqual({ from: w(7), nonce: '0x01' });
    expect(decodePayment('garbage')).toBeUndefined();
  });
});

describe('402 quotes through @x402/express (MW-5)', () => {
  const verdicts = new Map<string, VerdictView>([
    [w(1), linked],
    [w(2), independent],
  ]);
  const app = express();
  app.use(
    argus(
      { network: 'testnet', payTo: w(0xbeef), price: { standard: '$0.01', promo: '$0.005' }, routes: ['GET /api/premium'] },
      { verdicts: { lookup: async (a) => verdicts.get(a.toLowerCase()), invalidate: () => {} } },
    ),
  );
  app.get('/api/premium', (req, res) => res.json({ ok: true, argus: req.argus }));
  app.get('/free', (_req, res) => res.json({ free: true }));

  const quoted = async (headers: Record<string, string>) => {
    const r = await request(app).get('/api/premium').set(headers);
    expect(r.status).toBe(402);
    const required = JSON.parse(Buffer.from(r.headers['payment-required'] as string, 'base64').toString('utf8'));
    return { amount: required.accepts[0].amount as string, network: required.accepts[0].network, tier: r.headers['x-argus-tier'] };
  };

  it('quotes the promo to a Linked or Independent payer and standard otherwise', async () => {
    expect(await quoted({ 'x-payer-address': w(1) })).toEqual({ amount: '5000', network: 'eip155:10143', tier: 'Linked' });
    expect((await quoted({ 'x-payer-address': w(2) })).amount).toBe('5000');
    expect((await quoted({})).amount).toBe('10000');
  }, 30_000);

  it('leaves other routes alone', async () => {
    expect((await request(app).get('/free')).body).toEqual({ free: true });
  });
});

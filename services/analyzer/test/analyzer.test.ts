import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { assembleInput, makeConfig, type Address, type Transfer } from '@argus/scoring';
import { CHAIN, EXCHANGE, FAUCET, SALT, SELLER, T0, farm, independents } from '../../../packages/scoring/test/fixtures.ts';
import { createApi } from '../src/api.ts';
import { Assessor, type WalletIntel } from '../src/assessor.ts';
import { Publisher } from '../src/publisher.ts';
import type { Signer } from '../src/signer.ts';
import { Store } from '../src/store.ts';

const cfg = makeConfig({ knownHubs: [FAUCET, EXCHANGE], closureExclude: [SELLER] });

/** Answers from a fixed ledger, counting provider rounds like HyperSync calls. */
class FakeIntel implements WalletIntel {
  readonly name = 'fake-chain';
  calls = 0;
  rounds = 0;
  constructor(private readonly ledger: Transfer[]) {}
  async gatherMany(wallets: Address[]) {
    this.rounds++;
    this.calls += 4;
    return { inputs: wallets.map((w) => assembleInput(CHAIN, w, this.ledger, cfg)), transfers: this.ledger };
  }
}

function setup(now = T0 + 10_000) {
  const f = farm();
  const ind = independents();
  const intel = new FakeIntel([...f.transfers, ...ind.transfers]);
  const store = new Store(':memory:');
  const assessor = new Assessor({ store, salt: SALT, providers: { testnet: intel }, configs: { testnet: cfg }, batchWindowMs: 20, now: () => now });
  const app = createApi({ store, assessor, now: () => now });
  return { f, ind, intel, store, assessor, app };
}

describe('assessor', () => {
  it('batches concurrent requests into one provider round', async () => {
    const { f, ind, intel, assessor } = setup();
    const all = [...f.wallets, ...ind.wallets];
    const vs = await Promise.all(all.map((w) => assessor.assess('testnet', [w])));
    expect(intel.rounds).toBe(1);
    expect(new Set(vs.map(([v]) => v!.operatorId)).size).toBe(4);
  });

  it('pre-computes the rest of a Linked group (AN-3)', async () => {
    const { f, intel, assessor, store } = setup();
    const [first] = await assessor.assess('testnet', [f.wallets[0]!]);
    expect(first!.tierName).toBe('Linked');
    const other = store.getVerdict('testnet', f.wallets[7]!);
    expect(other).toMatchObject({ tierName: 'Linked', precomputed: true, operatorId: first!.operatorId });
    // the next fleet wallet is served from cache, no provider call
    await assessor.assess('testnet', [f.wallets[7]!]);
    expect(intel.rounds).toBe(1);
  });

  it('a fresh check replaces a pre-computed verdict', async () => {
    const { f, assessor, store } = setup();
    await assessor.assess('testnet', [f.wallets[0]!]);
    await assessor.assess('testnet', [f.wallets[3]!], true);
    expect(store.getVerdict('testnet', f.wallets[3]!)!.precomputed).toBe(false);
  });
});

describe('api', () => {
  it('POST /v1/assess returns verdicts with reasons and evidence', async () => {
    const { f, app } = setup();
    const r = await request(app).post('/v1/assess').send({ network: 'testnet', wallets: [f.wallets[0]] });
    expect(r.status).toBe(200);
    const v = r.body.verdicts[0];
    expect(v).toMatchObject({ tier: 1, tierName: 'Linked', groupSize: 10, confidence: 'high' });
    expect(v.reasons.length).toBeGreaterThan(1);
    const e = await request(app).get(`/v1/evidence/${v.evidenceHash}`);
    expect(e.status).toBe(200);
    expect(e.body.decision.tierName).toBe('Linked');
  });

  it('GET /v1/wallet finds pre-computed fleet verdicts and 404s unknown wallets', async () => {
    const { f, ind, app } = setup();
    expect((await request(app).get(`/v1/wallet/${f.wallets[5]}?network=testnet`)).status).toBe(404);
    await request(app).post('/v1/assess').send({ network: 'testnet', wallets: [f.wallets[0]] });
    const r = await request(app).get(`/v1/wallet/${f.wallets[5]}?network=testnet`);
    expect(r.status).toBe(200);
    expect(r.body.precomputed).toBe(true);
    expect((await request(app).get(`/v1/wallet/${ind.wallets[0]}?network=testnet`)).status).toBe(404);
  });

  it('expired verdicts read as no verdict', async () => {
    const { f, store, assessor } = setup();
    await assessor.assess('testnet', [f.wallets[0]!]);
    const later = createApi({ store, assessor, now: () => T0 + 10_000 + 8 * 86_400 });
    expect((await request(later).get(`/v1/wallet/${f.wallets[0]}?network=testnet`)).status).toBe(404);
  });

  it('rejects bad input', async () => {
    const { app } = setup();
    expect((await request(app).post('/v1/assess').send({ network: 'devnet', wallets: [] })).status).toBe(400);
    expect((await request(app).post('/v1/assess').send({ network: 'testnet', wallets: ['0x12'] })).status).toBe(400);
  });
});

describe('publishing (AN-7)', () => {
  it('only wallets that paid are published, and only once until the verdict changes', async () => {
    const { f, ind, app, store } = setup();
    await request(app).post('/v1/assess').send({ network: 'testnet', wallets: [f.wallets[0], ind.wallets[0]] });
    expect(store.pendingPublish('testnet')).toHaveLength(0);

    await request(app).post('/v1/paid').send({ network: 'testnet', wallet: f.wallets[0], seller: 'demo' });
    await request(app).post('/v1/paid').send({ network: 'testnet', wallet: ind.wallets[0], seller: 'demo' });
    const pending = store.pendingPublish('testnet');
    expect(pending.map((v) => v.wallet).sort()).toEqual([f.wallets[0]!.toLowerCase(), ind.wallets[0]!.toLowerCase()].sort());

    const sent: unknown[][] = [];
    const signer: Signer = {
      address: '0x00000000000000000000000000000000000000aa',
      writeContract: async (a) => {
        sent.push(a.args as unknown[]);
        return '0xabc';
      },
      waitForReceipt: async () => 'success',
    };
    const pub = new Publisher('testnet', store, signer, '0x00000000000000000000000000000000000000bb', 1000, () => {});
    expect(await pub.flush()).toBe('0xabc');
    expect((sent[0]![0] as string[]).length).toBe(2);
    expect(store.pendingPublish('testnet')).toHaveLength(0);
    expect(store.getVerdict('testnet', f.wallets[0]!)!.attestationTx).toBe('0xabc');
    // unpaid pre-computed farm members never reach the registry
    expect(store.getVerdict('testnet', f.wallets[1]!)!.paid).toBe(false);
  });

  it('a wallet that pays before any verdict is assessed and queued', async () => {
    const { f, app, store } = setup();
    const r = await request(app).post('/v1/paid').send({ network: 'testnet', wallet: f.wallets[2], seller: 'demo' });
    expect(r.body).toMatchObject({ tierName: 'Linked', paid: true });
    expect(store.pendingPublish('testnet')).toHaveLength(1);
  });
});

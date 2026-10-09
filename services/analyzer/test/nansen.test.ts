import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { assembleInput, makeConfig, type Address, type Transfer } from '@argus/scoring';
import { CHAIN, EXCHANGE, FAUCET, SALT, SELLER, farm, independents } from '../../../packages/scoring/test/fixtures.ts';
import { createApi } from '../src/api.ts';
import { Assessor, type DeepIntel, type WalletIntel } from '../src/assessor.ts';
import { Budget } from '../src/budget.ts';
import { NansenProvider, countUsdcRecipients, pickFirstFunder } from '../src/providers/nansen.ts';
import { Store } from '../src/store.ts';

const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address;
const FARM01 = '0x971E94Fed75A8f527566206E68D85e52F050C6D1' as Address;
const REAL_FUNDER = '0xffa82555a85e3e0220c7070a33604441b4526869';
const LOOKALIKE = '0xffa8c9768299a3ea259c0b1c05e0b96dfc526869';
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/nansen/transactions-farm01.json'), 'utf8')) as { data: never[] };

describe('Nansen parsing (PV-3, PV-5)', () => {
  it('takes the first funder from the real USDC contract, not a lookalike token', () => {
    expect(pickFirstFunder(fixture.data, FARM01, USDC, 0.01)).toBe(REAL_FUNDER);
  });

  it('ignores a lookalike token even when it arrived first', () => {
    const swapped = [...fixture.data].reverse().map((tx: { block_timestamp: string }, i) => ({ ...tx, block_timestamp: i === 0 ? '2026-10-01T00:00:00' : '2026-10-09T00:00:00' }));
    expect(pickFirstFunder(swapped as never[], FARM01, USDC, 0.01)).toBe(REAL_FUNDER);
    expect(LOOKALIKE).not.toBe(REAL_FUNDER);
  });

  it('dust below the minimum is not funding; sends do not count', () => {
    expect(pickFirstFunder(fixture.data, FARM01, USDC, 5)).toBeNull();
    expect(pickFirstFunder(fixture.data, REAL_FUNDER as Address, USDC, 0.01)).toBeNull();
  });

  it('counts only real USDC recipients of a funder', () => {
    expect(
      countUsdcRecipients(
        [
          { counterparty_address: '0x1', tokens_info: [{ token_address: USDC.toLowerCase(), token_out_amount: 0.2 }] },
          { counterparty_address: '0x2', tokens_info: [{ token_address: '0x29f9c424803ac7b09d97ee218adbbb9329703946', token_out_amount: 0.2 }] },
          { counterparty_address: '0x3', tokens_info: [{ token_address: USDC.toLowerCase(), token_out_amount: 0 }] },
        ],
        USDC,
      ),
    ).toBe(1);
  });
});

describe('Nansen client', () => {
  const okFetch = (calls: { url: string; headers: Record<string, string> }[]): typeof fetch =>
    (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ pagination: {}, data: fixture.data }), { status: 200, headers: { 'x-nansen-credits-used': '1' } });
    }) as unknown as typeof fetch;

  it('sends the key, reads the credits charged, and keeps to the budget', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const budget = new Budget({ dailyCapUsd: 0.02, perWalletCalls: 5 });
    const n = new NansenProvider({ apiKey: 'k', usdc: USDC, minFundingUsdc: 0.01, budget, fetch: okFetch(calls), spacingMs: 0 });
    expect((await n.firstFunder(FARM01)).funder).toBe(REAL_FUNDER);
    expect(calls[0]!.headers.apikey).toBe('k');
    expect(calls[0]!.url).toContain('/profiler/address/transactions');
    expect(n.spend).toEqual({ calls: 1, usd: 0.01 });
    await n.firstFunder('0x0000000000000000000000000000000000000002');
    // the third call would pass the $0.02 cap
    expect(await n.firstFunder('0x0000000000000000000000000000000000000003')).toEqual({ funder: null, skipped: 'daily budget reached' });
    expect(n.calls).toBe(2);
  });

  it('pays per call with no key when there is no key (x402 path)', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const n = new NansenProvider({ x402Fetch: okFetch(calls), usdc: USDC, minFundingUsdc: 0.01, budget: new Budget({ dailyCapUsd: 1, perWalletCalls: 5 }), spacingMs: 0 });
    await n.firstFunder(FARM01);
    expect(calls[0]!.headers.apikey).toBeUndefined();
  });

  it('falls back to x402 when the key is out of credits, and never sends the key there', async () => {
    const keyCalls: { url: string; headers: Record<string, string> }[] = [];
    const payCalls: { url: string; headers: Record<string, string> }[] = [];
    const noCredits = (async (url: string, init: RequestInit) => {
      keyCalls.push({ url, headers: init.headers as Record<string, string> });
      return new Response('{}', { status: 402 });
    }) as unknown as typeof fetch;
    const n = new NansenProvider({ apiKey: 'k', x402Fetch: okFetch(payCalls), fetch: noCredits, usdc: USDC, minFundingUsdc: 0.01, budget: new Budget({ dailyCapUsd: 1, perWalletCalls: 5 }), spacingMs: 0 });
    expect((await n.firstFunder(FARM01)).funder).toBe(REAL_FUNDER);
    expect(keyCalls).toHaveLength(1);
    expect(payCalls[0]!.headers.apikey).toBeUndefined();
  });

  it('a failing Nansen never throws and opens the breaker after repeated failures', async () => {
    const down = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const budget = new Budget({ dailyCapUsd: 1, perWalletCalls: 9, breakerThreshold: 2, breakerCooldownMs: 60_000 });
    const n = new NansenProvider({ apiKey: 'k', usdc: USDC, minFundingUsdc: 0.01, budget, fetch: down, spacingMs: 0 });
    expect((await n.firstFunder(FARM01)).skipped).toBe('Nansen call failed');
    expect((await n.firstFunder(FARM01)).skipped).toBe('Nansen call failed');
    expect((await n.firstFunder(FARM01)).skipped).toBe('circuit breaker open');
  });
});

describe('Budget (AN-8)', () => {
  it('enforces the per-wallet cap and rolls over at midnight UTC', () => {
    let t = Date.UTC(2026, 9, 9, 12);
    const b = new Budget({ dailyCapUsd: 1, perWalletCalls: 2, now: () => t });
    b.record('0xA', 0.01);
    b.record('0xa', 0.01);
    expect(b.check('0xA', 0.01)).toEqual({ ok: false, reason: 'per-wallet call cap reached' });
    t = Date.UTC(2026, 9, 10, 0, 1);
    expect(b.check('0xA', 0.01)).toEqual({ ok: true });
    expect(b.spent).toBe(0);
  });
});

describe('deep check in the assessor (AN-1, AN-2, PV-4)', () => {
  const cfg = makeConfig({ knownHubs: [FAUCET, EXCHANGE], closureExclude: [SELLER] });

  class FakeIntel implements WalletIntel {
    readonly name = 'fake-chain';
    calls = 0;
    constructor(private readonly ledger: Transfer[]) {}
    async gatherMany(wallets: Address[]) {
      this.calls += 4;
      return { inputs: wallets.map((w) => assembleInput(CHAIN, w, this.ledger, cfg)), transfers: this.ledger };
    }
  }
  class FakeNansen implements DeepIntel {
    readonly name = 'nansen';
    calls = 0;
    usd = 0;
    constructor(private readonly funderOf: (w: Address) => Address | null, private readonly skip?: string, private readonly recipients: number | null = 10) {}
    async firstFunder(w: Address) {
      if (this.skip) return { funder: null, skipped: this.skip };
      this.calls++;
      this.usd += 0.01;
      return { funder: this.funderOf(w) };
    }
    async funderRecipients() {
      this.calls++;
      this.usd += 0.05;
      return { recipients: this.recipients };
    }
  }

  const setup = (deep?: DeepIntel) => {
    const f = farm();
    const ind = independents();
    const store = new Store(':memory:');
    const intel = new FakeIntel([...f.transfers, ...ind.transfers]);
    const assessor = new Assessor({ store, salt: SALT, providers: { mainnet: intel, testnet: intel }, configs: { mainnet: cfg, testnet: cfg }, batchWindowMs: 10, ...(deep ? { deep } : {}) });
    return { f, ind, store, assessor, app: createApi({ store, assessor }) };
  };

  it('when both sources agree the verdict says so and Nansen is credited', async () => {
    const { f, assessor, store } = setup(new FakeNansen(() => f0F()));
    function f0F() {
      return farm().F;
    }
    const [v] = await assessor.assess('mainnet', [f.wallets[0]!], false, 'deep');
    expect(v).toMatchObject({ tierName: 'Linked', depth: 'deep' });
    expect(v!.reasons.join(' ')).toMatch(/Sources agree on the first funder: fake-chain, nansen/);
    expect(v!.reasons.join(' ')).toMatch(/Nansen also sees this funder paying 10 wallets/);
    const bundle = store.getEvidence(v!.evidenceHash) as { attribution: string; providers: { name: string; calls: number; usd: number }[]; crossCheck: { funderRecipients: number } };
    expect(bundle.attribution).toBe('Powered by Nansen API');
    expect(bundle.crossCheck.funderRecipients).toBe(10);
    expect(bundle.providers.find((p) => p.name === 'nansen')!.usd).toBeCloseTo(0.06);
    expect(JSON.stringify(bundle)).not.toMatch(/label/i);
  });

  it('when the sources disagree the wallet is Unclear with the reason', async () => {
    const { f, assessor } = setup(new FakeNansen(() => '0x00000000000000000000000000000000000dead1' as Address));
    const [v] = await assessor.assess('mainnet', [f.wallets[0]!], false, 'deep');
    expect(v).toMatchObject({ tierName: 'Unclear', depth: 'deep' });
    expect(v!.reasons[0]).toMatch(/Sources disagree/);
  });

  it('asks Nansen once per funder, not once per fleet wallet', async () => {
    const nansen = new FakeNansen(() => farm().F);
    const { f, assessor } = setup(nansen);
    await assessor.assess('mainnet', f.wallets.slice(0, 4), false, 'deep');
    // 4 transactions calls + 1 counterparties call
    expect(nansen.calls).toBe(5);
  });

  it('falls back to the light check when the budget is spent or there is no deep source', async () => {
    const spent = setup(new FakeNansen(() => null, 'daily budget reached'));
    const [a] = await spent.assessor.assess('mainnet', [spent.f.wallets[0]!], false, 'deep');
    expect(a).toMatchObject({ tierName: 'Linked', depth: 'light' });
    const none = setup();
    const [b] = await none.assessor.assess('mainnet', [none.f.wallets[0]!], false, 'deep');
    expect(b!.depth).toBe('light');
  });

  it('deep is mainnet only: testnet never calls Nansen', async () => {
    const nansen = new FakeNansen(() => farm().F);
    const { f, assessor } = setup(nansen);
    const [v] = await assessor.assess('testnet', [f.wallets[0]!], false, 'deep');
    expect(v!.depth).toBe('light');
    expect(nansen.calls).toBe(0);
  });

  it('a light verdict is upgraded by a deep request, a deep one is cached', async () => {
    const nansen = new FakeNansen(() => farm().F);
    const { f, assessor } = setup(nansen);
    await assessor.assess('mainnet', [f.wallets[0]!]);
    expect(nansen.calls).toBe(0);
    const [deepV] = await assessor.assess('mainnet', [f.wallets[0]!], false, 'deep');
    expect(deepV!.depth).toBe('deep');
    const before = nansen.calls;
    await assessor.assess('mainnet', [f.wallets[0]!], false, 'deep');
    expect(nansen.calls).toBe(before);
  });

  it('a settled promo claim on mainnet gets the deep check; a normal payment does not', async () => {
    const nansen = new FakeNansen(() => farm().F);
    const { f, ind, app } = setup(nansen);
    await request(app).post('/v1/paid').send({ network: 'mainnet', wallet: f.wallets[1], seller: 's', promo: true });
    expect(nansen.calls).toBeGreaterThan(0);
    const before = nansen.calls;
    await request(app).post('/v1/paid').send({ network: 'mainnet', wallet: ind.wallets[0], seller: 's', promo: false });
    expect(nansen.calls).toBe(before);
  });
});

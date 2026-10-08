import { describe, expect, it } from 'vitest';
import {
  Tier,
  assembleInput,
  buildEvidenceBundle,
  classify,
  countHubRecipients,
  decide,
  evidenceHash,
  makeConfig,
  operatorIdFor,
  sellerHints,
  usdc,
  type Address,
  type Transfer,
} from '../src/index.ts';
import {
  CHAIN,
  DAY,
  EXCHANGE,
  FAUCET,
  HOUR,
  SALT,
  SELLER,
  T0,
  addr,
  closureOnly,
  dustSprayedFarm,
  farm,
  independents,
  largeFunder,
  pair,
  sharedFunderOnly,
  tx,
} from './fixtures.ts';

const cfg = makeConfig({ knownHubs: [FAUCET, EXCHANGE], closureExclude: [SELLER] });
const assess = (wallet: Address, transfers: Transfer[], c = cfg) => decide(assembleInput(CHAIN, wallet, transfers, c), SALT, c);

describe('decision truth table (SC-3)', () => {
  const cases: Array<[boolean, boolean, boolean, boolean, Tier]> = [];
  for (let m = 0; m < 16; m++) {
    const [S1, S2, S3, S4] = [m & 8, m & 4, m & 2, m & 1].map(Boolean) as [boolean, boolean, boolean, boolean];
    const expected = !S1 ? Tier.Independent : S2 || S3 || S4 ? Tier.Linked : Tier.Unclear;
    cases.push([S1, S2, S3, S4, expected]);
  }
  it.each(cases)('S1=%s S2=%s S3=%s S4=%s -> tier %s', (S1, S2, S3, S4, expected) => {
    expect(classify({ S1, S2, S3, S4 }).tier).toBe(expected);
  });
});

describe('fixtures (SC-1)', () => {
  it('farm: all 10 wallets Linked, one operator, high confidence', () => {
    const f = farm();
    const ds = f.wallets.map((w) => assess(w, f.transfers));
    for (const d of ds) {
      expect(d.tier).toBe(Tier.Linked);
      expect(d.confidence).toBe('high');
      expect(d.groupSize).toBe(10);
      expect(d.signals).toMatchObject({ S1: true, S2: true, S3: true });
    }
    expect(new Set(ds.map((d) => d.operatorId)).size).toBe(1);
    expect(ds[0]!.operatorId).toBe(operatorIdFor(CHAIN, f.F, SALT));
    expect(ds[0]!.reasons[0]).toBe('First USDC funder also seeded 9 other wallets');
    expect(ds[0]!.reasons.join(' ')).toMatch(/identical 0.20 USDC amounts to 10 wallets within 5 minutes/);
  });

  it('independents created today are Independent (wallet age never matters)', () => {
    const ind = independents();
    const ds = ind.wallets.map((w) => assess(w, ind.transfers));
    expect(ds.map((d) => d.tier)).toEqual([Tier.Independent, Tier.Independent, Tier.Independent]);
    // faucet and exchange are known hubs -> high; a friend's wallet is medium on a single source
    expect(ds.map((d) => d.confidence)).toEqual(['high', 'high', 'medium']);
    expect(new Set(ds.map((d) => d.operatorId)).size).toBe(3);
  });

  it('the demo: 13 paying wallets resolve to 4 customers', () => {
    const f = farm();
    const ind = independents();
    const all = [...f.transfers, ...ind.transfers];
    const ds = [...f.wallets, ...ind.wallets].map((w) => assess(w, all));
    const customers = new Set(ds.map((d) => d.operatorId));
    expect(ds).toHaveLength(13);
    expect(customers.size).toBe(4);
  });

  it('large funder with 250 recipients merges nothing (hub by threshold)', () => {
    const lf = largeFunder();
    for (const w of lf.wallets.slice(0, 20)) {
      const d = assess(w, lf.transfers);
      expect(d.tier).toBe(Tier.Independent);
      expect(d.funderIsHub).toBe(true);
    }
  });

  it('faucet-funded wallets never merge, even many of them on one day', () => {
    const wallets = Array.from({ length: 30 }, (_, i) => addr(0xa000 + i));
    const transfers = wallets.map((w, i) => tx(FAUCET, w, 1, T0 + i));
    const ds = wallets.map((w) => assess(w, transfers));
    expect(ds.every((d) => d.tier === Tier.Independent && d.funderIsHub && d.confidence === 'high')).toBe(true);
  });

  it('a dust-sprayed funder is not a hub; its farm is still Linked', () => {
    const f = dustSprayedFarm();
    expect(countHubRecipients(f.transfers, f.F, usdc(0.1))).toBe(10);
    const d = assess(f.wallets[3]!, f.transfers);
    expect(d.funderIsHub).toBe(false);
    expect(d.tier).toBe(Tier.Linked);
  });

  it('pair: two wallets sharing a funder stay Independent', () => {
    const p = pair();
    const d = assess(p.wallets[0]!, p.transfers);
    expect(d.tier).toBe(Tier.Independent);
    expect(d.groupSize).toBe(2);
    expect(d.reasons[0]).toMatch(/seeded only 2 wallets/);
  });

  it('S1 alone is Unclear, never Linked', () => {
    const s = sharedFunderOnly();
    const d = assess(s.wallets[1]!, s.transfers);
    expect(d.signals).toEqual({ S1: true, S2: false, S3: false, S4: false });
    expect(d.tier).toBe(Tier.Unclear);
    expect(d.confidence).toBe('low');
    expect(d.operatorId).toBe('0x' + '0'.repeat(64));
  });

  it('S1 + value closure only is Linked with medium confidence', () => {
    const c = closureOnly();
    const d = assess(c.wallets[0]!, c.transfers);
    expect(d.signals).toEqual({ S1: true, S2: false, S3: false, S4: true });
    expect(d.tier).toBe(Tier.Linked);
    expect(d.confidence).toBe('medium');
    expect(d.reasons.join(' ')).toMatch(/go to the funder/);
  });

  it('paying the same seller is not value closure when the seller is excluded', () => {
    const s = sharedFunderOnly();
    const extra = s.wallets.map((w, i) => tx(w, SELLER, 5, T0 + 50 * DAY + i));
    const d = assess(s.wallets[0]!, [...s.transfers, ...extra]);
    expect(d.signals.S4).toBe(false);
    expect(d.tier).toBe(Tier.Unclear);
  });

  it('dust below minFunding is not a first funder', () => {
    const w = addr(0xb001);
    const d = assess(w, [tx(addr(0xbad), w, 0.001, T0), tx(EXCHANGE, w, 1, T0 + HOUR)]);
    expect(d.firstFunder).toBe(EXCHANGE);
    expect(d.tier).toBe(Tier.Independent);
  });
});

describe('unclear paths', () => {
  it('no funding trace', () => {
    const d = assess(addr(0xc001), []);
    expect(d.tier).toBe(Tier.Unclear);
    expect(d.reasons).toEqual(['No USDC funding trace found']);
  });

  it('data error', () => {
    const f = farm();
    const input = { ...assembleInput(CHAIN, f.wallets[0]!, f.transfers, cfg), dataError: 'hypersync timeout' };
    expect(decide(input, SALT, cfg).tier).toBe(Tier.Unclear);
  });

  it('sources that disagree on the funder give Unclear with a reason (PV-4)', () => {
    const p = pair();
    const input = {
      ...assembleInput(CHAIN, p.wallets[0]!, p.transfers, cfg),
      sources: [{ name: 'envio-hypersync', firstFunder: p.F }, { name: 'nansen', firstFunder: addr(0x1234) }],
    };
    const d = decide(input, SALT, cfg);
    expect(d.tier).toBe(Tier.Unclear);
    expect(d.agreement).toBe('disagree');
    expect(d.reasons[0]).toMatch(/envio-hypersync.*nansen/);
  });

  it('sources that agree raise an Independent to high confidence', () => {
    const p = pair();
    const input = {
      ...assembleInput(CHAIN, p.wallets[0]!, p.transfers, cfg),
      sources: [{ name: 'envio-hypersync', firstFunder: p.F }, { name: 'nansen', firstFunder: p.F }],
    };
    const d = decide(input, SALT, cfg);
    expect(d.tier).toBe(Tier.Independent);
    expect(d.confidence).toBe('high');
    expect(d.agreement).toBe('both-sources');
  });

  it('a source with no answer has no vote', () => {
    const p = pair();
    const input = {
      ...assembleInput(CHAIN, p.wallets[0]!, p.transfers, cfg),
      sources: [{ name: 'envio-hypersync', firstFunder: p.F }, { name: 'nansen', firstFunder: null }],
    };
    expect(decide(input, SALT, cfg).agreement).toBe('single-source');
  });
});

describe('determinism and configuration (SC-6, SC-7)', () => {
  it('same evidence in any order gives the same verdict', () => {
    const f = farm();
    const a = assess(f.wallets[4]!, f.transfers);
    const b = assess(f.wallets[4]!, [...f.transfers].reverse());
    expect(b).toEqual(a);
  });

  it('operatorId depends on chain and salt', () => {
    const F = addr(0xf00d);
    expect(operatorIdFor(143, F, SALT)).not.toBe(operatorIdFor(10143, F, SALT));
    expect(operatorIdFor(143, F, SALT)).not.toBe(operatorIdFor(143, F, ('0x' + '01'.repeat(32)) as `0x${string}`));
  });

  it('changing a threshold changes a verdict', () => {
    const f = farm();
    const strict = makeConfig({ knownHubs: [FAUCET, EXCHANGE], closureExclude: [SELLER], minGroupSize: 11 });
    expect(assess(f.wallets[0]!, f.transfers, strict).tier).toBe(Tier.Independent);
  });

  it('instalments outside the 24h window do not count', () => {
    const F = addr(0x5108);
    const wallets = [addr(0xd001), addr(0xd002), addr(0xd003)];
    const transfers = wallets.map((w, i) => tx(F, w, 0.2, T0 + i * 2 * DAY));
    const d = assess(wallets[0]!, transfers);
    expect(d.signals.S2).toBe(false);
    expect(d.signals.S3).toBe(false);
    expect(d.tier).toBe(Tier.Unclear);
  });

  it('instalments within 1% count, 2% apart do not', () => {
    const F = addr(0x5109);
    const w = [addr(0xe001), addr(0xe002), addr(0xe003)];
    const close = [tx(F, w[0]!, 1.0, T0), tx(F, w[1]!, 1.009, T0 + DAY + HOUR), tx(F, w[2]!, 0.995, T0 + 2 * DAY + HOUR)];
    const far = [tx(F, w[0]!, 1.0, T0), tx(F, w[1]!, 1.02, T0 + DAY + HOUR), tx(F, w[2]!, 1.04, T0 + 2 * DAY + HOUR)];
    // spread over 3 days so S3 stays off; window 48h so time is not the limit
    const wide = makeConfig({ knownHubs: [FAUCET], closureExclude: [SELLER], instalmentWindowHours: 72 });
    expect(assess(w[0]!, close, wide).signals.S2).toBe(true);
    expect(assess(w[0]!, far, wide).signals.S2).toBe(false);
  });
});

describe('seller hints never change the verdict (SC-5)', () => {
  it('flat clock and one-payee hints are produced but the tier is unchanged', () => {
    const ind = independents();
    const w = ind.wallets[2]!;
    const before = assess(w, ind.transfers);
    const requests = Array.from({ length: 96 }, (_, i) => ({ wallet: w, ts: T0 + i * 15 * 60 }));
    const hints = sellerHints(w, requests, ind.transfers, SELLER, cfg);
    expect(hints.map((h) => h.code).sort()).toEqual(['flat-clock', 'one-payee']);
    expect(assess(w, ind.transfers)).toEqual(before);
  });

  it('bursty human traffic gets no flat-clock hint', () => {
    const w = addr(0xf001);
    const requests = Array.from({ length: 60 }, (_, i) => ({ wallet: w, ts: T0 - (T0 % DAY) + 9 * HOUR + i * 60 }));
    expect(sellerHints(w, requests, [], SELLER, cfg)).toEqual([]);
  });
});

describe('evidence bundle', () => {
  it('hash is stable and the bundle carries no member list', () => {
    const f = farm();
    const d = assess(f.wallets[0]!, f.transfers);
    const b1 = buildEvidenceBundle(d, 'testnet', [{ name: 'envio-hypersync', calls: 3, usd: 0 }], T0);
    const b2 = JSON.parse(JSON.stringify(b1));
    expect(evidenceHash(b1)).toBe(evidenceHash(b2));
    expect(JSON.stringify(b1)).not.toContain(f.wallets[1]!.slice(2));
    expect(b1.attribution).toBeUndefined();
  });

  it('adds Nansen attribution when Nansen was used', () => {
    const f = farm();
    const d = assess(f.wallets[0]!, f.transfers);
    const b = buildEvidenceBundle(d, 'mainnet', [{ name: 'nansen', calls: 3, usd: 0.03 }], T0);
    expect(b.attribution).toBe('Powered by Nansen API');
  });
});

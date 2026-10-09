import { describe, expect, it } from 'vitest';
import { Tier, assembleInput, classify, decide, makeConfig, type Address, type Transfer } from '../src/index.ts';
import { CHAIN, HOUR, SALT, T0, addr } from './fixtures.ts';

const MON = 10n ** 18n;
const asset = { symbol: 'MON', decimals: 18 };
const cfg = makeConfig({ minFunding: MON / 100n, hubMinTransfer: MON / 10n });

/** A funder that sends the same 11 MON to many wallets within an hour: hub-sized, but a fleet. */
function spray(funder: Address, wallets: Address[], amount = 11n * MON): Transfer[] {
  return wallets.map((w, i) => ({ from: funder, to: w, amount, timestamp: T0 + i * 10, txHash: `0x${(i + 1).toString(16).padStart(64, '0')}` as `0x${string}` }));
}
const wallets = (n: number, base = 0x7000) => Array.from({ length: n }, (_, i) => addr(base + i));
const conc = (share: number, n: number) => ({ share, wallets: n, context: 'agent 182 feedback clients' });

describe('S5 context concentration', () => {
  const F = addr(0xfa111);

  it('a hub-sized funder that dominates a context set is one operator', () => {
    const ws = wallets(250);
    const input = assembleInput(CHAIN, ws[0]!, spray(F, ws), cfg, { asset, concentration: conc(0.83, 250) });
    const d = decide(input, SALT, cfg);
    expect(d.tier).toBe(Tier.Linked);
    expect(d.signals).toMatchObject({ S1: true, S2: true, S5: true });
    expect(d.confidence).toBe('high');
    expect(d.groupSize).toBe(250);
    expect(d.reasons.join(' | ')).toMatch(/Funded in identical 11\.00 MON amounts to 250 wallets/);
    expect(d.reasons.join(' | ')).toMatch(/83% of agent 182 feedback clients \(250 wallets\) were first funded by this one funder/);
  });

  it('the same funder without context stays a hub: Independent', () => {
    const ws = wallets(250);
    const d = decide(assembleInput(CHAIN, ws[0]!, spray(F, ws), cfg, { asset }), SALT, cfg);
    expect(d.tier).toBe(Tier.Independent);
    expect(d.funderIsHub).toBe(true);
    expect(d.reasons[0]).toMatch(/First MON funder is a hub \(250 recipients\)/);
  });

  it('a known hub never triggers S5, whatever the share', () => {
    const known = makeConfig({ minFunding: MON / 100n, hubMinTransfer: MON / 10n, knownHubs: [F] });
    const ws = wallets(60);
    const d = decide(assembleInput(CHAIN, ws[0]!, spray(F, ws), known, { asset, concentration: conc(1, 60) }), SALT, known);
    expect(d.tier).toBe(Tier.Independent);
    expect(d.reasons[0]).toMatch(/known hub/);
  });

  it('a funder with a small share of the context is left alone', () => {
    const ws = wallets(250);
    const d = decide(assembleInput(CHAIN, ws[0]!, spray(F, ws), cfg, { asset, concentration: conc(0.2, 250) }), SALT, cfg);
    expect(d.tier).toBe(Tier.Independent);
  });

  it('too few wallets in the context does not count, even at 100%', () => {
    const ws = wallets(250);
    const d = decide(assembleInput(CHAIN, ws[0]!, spray(F, ws), cfg, { asset, concentration: conc(1, 4) }), SALT, cfg);
    expect(d.tier).toBe(Tier.Independent);
  });

  it('S5 alone links with medium confidence; with S2 as well it is high', () => {
    expect(classify({ S1: true, S2: false, S3: false, S4: false, S5: true })).toEqual({ tier: Tier.Linked, fleetSignals: 1 });
    expect(classify({ S1: true, S2: true, S3: false, S4: false, S5: true })).toEqual({ tier: Tier.Linked, fleetSignals: 2 });
    expect(classify({ S1: false, S2: false, S3: false, S4: false, S5: true }).tier).toBe(Tier.Independent);
  });

  it('different amounts spread over weeks: S5 alone still links, S2 does not fire', () => {
    const ws = wallets(40, 0x8000);
    const varied: Transfer[] = ws.map((w, i) => ({ from: F, to: w, amount: BigInt(1 + i) * MON, timestamp: T0 + i * 3 * 86_400, txHash: `0x${(i + 1).toString(16).padStart(64, '0')}` as `0x${string}` }));
    const wide = makeConfig({ minFunding: MON / 100n, hubMinTransfer: MON / 10n, hubRecipientThreshold: 10 });
    const d = decide(assembleInput(CHAIN, ws[0]!, varied, wide, { asset, concentration: conc(0.9, 40) }), SALT, wide);
    expect(d.signals).toMatchObject({ S1: true, S2: false, S5: true });
    expect(d.tier).toBe(Tier.Linked);
    expect(d.confidence).toBe('medium');
  });

  it('keeps old behaviour when no context is given (USDC wording and no S5 key)', () => {
    const d = decide(assembleInput(CHAIN, addr(0x1), [{ from: addr(0xe), to: addr(0x1), amount: 5_000_000n, timestamp: T0 + HOUR }], makeConfig()), SALT, makeConfig());
    expect(d.signals).toEqual({ S1: false, S2: false, S3: false, S4: false });
    expect(d.reasons[0]).toMatch(/No other wallet shares its first USDC funder/);
  });
});

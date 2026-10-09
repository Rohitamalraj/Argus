import { describe, expect, it } from 'vitest';
import type { Address, Decision } from '@argus/scoring';
import { localResolver } from '../src/index.ts';

const w = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const decision = (wallet: Address, tierName: string): Decision =>
  ({ wallet, tier: tierName === 'Linked' ? 1 : 2, tierName, confidence: 'high', operatorId: `0x${'ab'.repeat(32)}`, groupSize: 3, firstFunder: w(0xf), funderIsHub: false, signals: {}, agreement: 'single-source', reasons: [`${tierName} because`] }) as unknown as Decision;

describe('localResolver', () => {
  it('checks wallets that arrive together in one batch and answers each', async () => {
    const batches: Address[][] = [];
    const resolve = localResolver(
      { checkWallets: async (ws) => (batches.push(ws), ws.map((x, i) => decision(x, i === 0 ? 'Linked' : 'Independent'))) },
      { batchWindowMs: 20, now: () => 1_000, ttlSec: 600 },
    );
    const [a, b] = await Promise.all([resolve(w(1)), resolve(w(2))]);
    expect(batches).toEqual([[w(1), w(2)]]);
    expect(a).toMatchObject({ tier: 1, tierName: 'Linked', expiresAt: 1_600, reasons: ['Linked because'] });
    expect(b).toMatchObject({ tier: 2, tierName: 'Independent' });
  });

  it('asks once for the same wallet requested twice at once', async () => {
    const seen: Address[][] = [];
    const resolve = localResolver({ checkWallets: async (ws) => (seen.push(ws), ws.map((x) => decision(x, 'Linked'))) }, { batchWindowMs: 20 });
    const [a, b] = await Promise.all([resolve(w(3)), resolve(w(3).toUpperCase().replace('0X', '0x') as Address)]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(a.tierName).toBe(b.tierName);
  });

  it('a failed batch rejects every waiting wallet, and the next batch starts clean', async () => {
    let fail = true;
    const resolve = localResolver({ checkWallets: async (ws) => (fail ? Promise.reject(new Error('HyperSync 429')) : ws.map((x) => decision(x, 'Linked'))) }, { batchWindowMs: 10 });
    await expect(Promise.all([resolve(w(4)), resolve(w(5))])).rejects.toThrow('HyperSync 429');
    fail = false;
    expect((await resolve(w(4))).tierName).toBe('Linked');
  });
});

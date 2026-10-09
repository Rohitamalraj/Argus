import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Hex as ViemHex } from 'viem';
import type { Address, Transfer } from '@argus/scoring';
import { NETWORKS, agentReputation, reputationAbi, type ChainLog, type ChainReader } from '../src/index.ts';

const MON = 10n ** 18n;
const T0 = 1_760_000_000;
const REP = NETWORKS.mainnet.erc8004.reputation;
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address;
const EXCHANGE = addr(0xe8c4a9);

/** A tiny in-memory chain: native transfers plus ERC-8004 feedback logs. */
class FakeChain implements ChainReader {
  calls = 0;
  transfers: Transfer[] = [];
  logs: ChainLog[] = [];
  private seq = 0;

  fund(from: Address, to: Address, amount: bigint, ts: number) {
    this.transfers.push({ from, to, amount, timestamp: ts, txHash: `0x${(++this.seq).toString(16).padStart(64, '0')}` });
  }
  feedback(agentId: bigint, client: Address, value: number, ts: number, index = 0n) {
    const topics = encodeEventTopics({ abi: reputationAbi, eventName: 'NewFeedback', args: { agentId, clientAddress: client, indexedTag1: 'quality' } });
    const data = encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'int128' }, { type: 'uint8' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }],
      [index, BigInt(value) * 100n, 2, 'quality', '', '', '', `0x${'00'.repeat(32)}`],
    );
    this.logs.push({ blockNumber: ++this.seq, logIndex: 0, txHash: `0x${this.seq.toString(16).padStart(64, '0')}`, timestamp: ts, topics: topics as ViemHex[], data });
  }
  revoke(agentId: bigint, client: Address, index: bigint, ts: number) {
    const topics = encodeEventTopics({ abi: reputationAbi, eventName: 'FeedbackRevoked', args: { agentId, clientAddress: client, feedbackIndex: index } });
    this.logs.push({ blockNumber: ++this.seq, logIndex: 0, txHash: `0x${this.seq.toString(16).padStart(64, '0')}`, timestamp: ts, topics: topics as ViemHex[], data: '0x' });
  }

  async nativeTransfers(selections: { from?: Address[]; to?: Address[] }[]): Promise<Transfer[]> {
    this.calls++;
    return this.transfers.filter((t) => selections.some((s) => (!s.from || s.from.includes(t.from)) && (!s.to || s.to.includes(t.to))));
  }
  async rawLogs(address: Address, topics: ViemHex[][]): Promise<ChainLog[]> {
    this.calls++;
    if (address.toLowerCase() !== REP.toLowerCase()) return [];
    return this.logs.filter((l) => topics.every((alt, i) => alt.length === 0 || alt.some((t) => l.topics[i]?.toLowerCase() === t.toLowerCase())));
  }
}

const AGENT = 182n;

/** 60 clients seeded by one hub-sized funder, 6 independents, 1 unattributed, 4 clients of an exchange. */
function scenario() {
  const chain = new FakeChain();
  const F = addr(0xfa1);
  // F also funds 240 wallets that never rate this agent: 300 recipients in all, over the hub threshold
  for (let i = 0; i < 300; i++) chain.fund(F, i < 60 ? addr(0x1000 + i) : addr(0x9000 + i), 11n * MON, T0 + i * 5);
  for (let i = 0; i < 60; i++) chain.feedback(AGENT, addr(0x1000 + i), 100, T0 + 3600 + i);
  for (let i = 0; i < 6; i++) {
    const w = addr(0x2000 + i);
    chain.fund(addr(0xaaa0 + i), w, BigInt(1 + i) * MON, T0 - 86_400 * (i + 3));
    chain.feedback(AGENT, w, 60 + i, T0 + 86_400 * (i + 1));
  }
  chain.feedback(AGENT, addr(0x3000), 40, T0 + 5); // nothing funded this one
  for (let i = 0; i < 4; i++) {
    const w = addr(0x4000 + i);
    chain.fund(EXCHANGE, w, BigInt(2 + i) * MON, T0 - 86_400 * 9);
    chain.feedback(AGENT, w, 80, T0 + 7 * 86_400);
  }
  return { chain, F };
}

describe('ERC-8004 operator-deduplicated reputation', () => {
  it('collapses a hub-sized fleet that dominates an agent into one operator', async () => {
    const { chain, F } = scenario();
    const r = await agentReputation(AGENT, { chain, network: 'mainnet', knownHubs: [EXCHANGE] });
    expect(r.raw).toMatchObject({ feedbackCount: 71, distinctClients: 71 });
    // 1 fleet + 6 independents + 1 unattributed + 4 exchange-funded = 12 operators
    expect(r.independent).toMatchObject({ operators: 12, linkedOperators: 1 });
    const fleet = r.operators[0]!;
    expect(fleet).toMatchObject({ kind: 'linked', funder: F, clients: 60, feedbackCount: 60, confidence: 'high' });
    expect(fleet.id).toBe(`funder:${F}`);
    expect(fleet.reasons.join(' | ')).toMatch(/Funded in identical 11\.00 MON amounts/);
    expect(fleet.reasons.join(' | ')).toMatch(/85% of agent 182 feedback clients \(60 wallets\)/);
    expect(r.largestOperatorShare).toBeCloseTo(60 / 71, 5);
    expect(r.unattributed).toBe(1);
  });

  it('the deduplicated mean no longer follows the fleet', async () => {
    const { chain } = scenario();
    const r = await agentReputation(AGENT, { chain, network: 'mainnet', knownHubs: [EXCHANGE] });
    // raw mean is dominated by 60 entries of value 100; the operator mean counts the fleet once
    expect(r.raw.meanValue!).toBeGreaterThan(90);
    expect(r.independent.meanValue!).toBeLessThan(80);
  });

  it('gives one representative client per operator for getSummary', async () => {
    const { chain } = scenario();
    const r = await agentReputation(AGENT, { chain, network: 'mainnet', knownHubs: [EXCHANGE] });
    expect(r.clientAllowlist).toHaveLength(12);
    expect(new Set(r.clientAllowlist).size).toBe(12);
    // exactly one of the 60 fleet clients is on the list
    expect(r.clientAllowlist.filter((a) => BigInt(a) >= 0x1000n && BigInt(a) < 0x1000n + 60n)).toHaveLength(1);
  });

  it('a known hub never merges its clients', async () => {
    const { chain } = scenario();
    const r = await agentReputation(AGENT, { chain, network: 'mainnet', knownHubs: [EXCHANGE] });
    expect(r.operators.filter((o) => o.funder === EXCHANGE).every((o) => o.kind === 'independent' && o.clients === 1)).toBe(true);
  });

  it('the same funder with a small share of an agent stays a hub: nothing merged', async () => {
    const chain = new FakeChain();
    const F = addr(0xfa2);
    for (let i = 0; i < 400; i++) chain.fund(F, addr(0x5000 + i), 11n * MON, T0 + i * 5);
    for (let i = 0; i < 6; i++) chain.feedback(AGENT, addr(0x5000 + i), 70, T0 + 86_400 * i); // 6 of 100 clients
    for (let i = 0; i < 94; i++) {
      chain.fund(addr(0xbb00 + i), addr(0x6000 + i), 5n * MON, T0 - 86_400);
      chain.feedback(AGENT, addr(0x6000 + i), 70, T0 + 86_400 * i);
    }
    const r = await agentReputation(AGENT, { chain, network: 'mainnet' });
    expect(r.independent.operators).toBe(100);
    expect(r.independent.linkedOperators).toBe(0);
  });

  it('a revoked feedback entry is not counted', async () => {
    const chain = new FakeChain();
    chain.fund(addr(0xc1), addr(0x7001), 2n * MON, T0);
    chain.fund(addr(0xc2), addr(0x7002), 2n * MON, T0);
    chain.feedback(AGENT, addr(0x7001), 90, T0 + 100, 0n);
    chain.feedback(AGENT, addr(0x7002), 90, T0 + 100, 0n);
    chain.revoke(AGENT, addr(0x7002), 0n, T0 + 200);
    const r = await agentReputation(AGENT, { chain, network: 'mainnet' });
    expect(r.raw).toMatchObject({ feedbackCount: 1, distinctClients: 1 });
  });

  it('absurd int128 values are counted but left out of every mean', async () => {
    const chain = new FakeChain();
    for (let i = 0; i < 4; i++) chain.fund(addr(0xd0 + i), addr(0x7100 + i), 2n * MON, T0);
    for (let i = 0; i < 3; i++) chain.feedback(AGENT, addr(0x7100 + i), 100, T0 + 100);
    // 10^38 is near the int128 maximum; a plain average of the four would be 2.5e37
    const topics = encodeEventTopics({ abi: reputationAbi, eventName: 'NewFeedback', args: { agentId: AGENT, clientAddress: addr(0x7103), indexedTag1: 'x' } });
    const data = encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'int128' }, { type: 'uint8' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }],
      [0n, 10n ** 38n, 0, 'x', '', '', '', `0x${'00'.repeat(32)}`],
    );
    chain.logs.push({ blockNumber: 999, logIndex: 0, txHash: `0x${'ab'.repeat(32)}`, timestamp: T0 + 100, topics: topics as ViemHex[], data });
    const r = await agentReputation(AGENT, { chain, network: 'mainnet' });
    expect(r.raw.feedbackCount).toBe(4);
    expect(r.raw.implausibleValues).toBe(1);
    expect(r.raw.meanValue).toBe(100);
    expect(r.independent.meanValue).toBe(100);
  });

  it('can trace an evenly spread sample of the clients and says so', async () => {
    const { chain } = scenario();
    const r = await agentReputation(AGENT, { chain, network: 'mainnet', knownHubs: [EXCHANGE], maxClients: 30 });
    expect(r.sampled).toEqual({ analyzed: 30, total: 71 });
    expect(r.raw.distinctClients).toBe(71);
    // the fleet is 60 of 71 clients, so it dominates the sample too
    expect(r.operators[0]).toMatchObject({ kind: 'linked' });
    expect(r.largestOperatorShare).toBeGreaterThan(0.7);
    expect(r.operators.reduce((s, o) => s + o.clients, 0)).toBe(30);
  });

  it('an agent with no feedback returns an empty result', async () => {
    const r = await agentReputation(999n, { chain: new FakeChain(), network: 'mainnet' });
    expect(r.raw.feedbackCount).toBe(0);
    expect(r.independent.operators).toBe(0);
  });

  it('only reads the feedback of the requested agent', async () => {
    const { chain } = scenario();
    chain.fund(addr(0xc9), addr(0x8001), 2n * MON, T0);
    chain.feedback(7n, addr(0x8001), 90, T0 + 1);
    const r = await agentReputation(7n, { chain, network: 'mainnet' });
    expect(r.raw.feedbackCount).toBe(1);
  });
});

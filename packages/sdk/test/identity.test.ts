import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Hex as ViemHex } from 'viem';
import type { Address, Transfer } from '@argus/scoring';
import { NETWORKS, agentReputation, isSafeHttpsUrl, loadMetadata, parseAgentMetadata, readAgentProfile, reputationAbi, type AgentIdentityReader, type ChainLog, type ChainReader } from '../src/index.ts';

const MON = 10n ** 18n;
const T0 = 1_760_000_000;
const REP = NETWORKS.mainnet.erc8004.reputation;
const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address;
const OWNER = addr(0x0aa1);
const AGENT = 182n;

class FakeChain implements ChainReader {
  calls = 0;
  transfers: Transfer[] = [];
  logs: ChainLog[] = [];
  private seq = 0;
  fund(from: Address, to: Address, ts: number, amount = 11n * MON) {
    this.transfers.push({ from, to, amount, timestamp: ts, txHash: `0x${(++this.seq).toString(16).padStart(64, '0')}` });
  }
  feedback(client: Address, ts: number) {
    const topics = encodeEventTopics({ abi: reputationAbi, eventName: 'NewFeedback', args: { agentId: AGENT, clientAddress: client, indexedTag1: 'x' } });
    const data = encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'int128' }, { type: 'uint8' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }],
      [0n, 100n, 0, 'x', '', '', '', `0x${'00'.repeat(32)}`],
    );
    this.logs.push({ blockNumber: ++this.seq, logIndex: 0, txHash: `0x${this.seq.toString(16).padStart(64, '0')}`, timestamp: ts, topics: topics as ViemHex[], data });
  }
  async nativeTransfers(selections: { from?: Address[]; to?: Address[] }[]) {
    this.calls++;
    return this.transfers.filter((t) => selections.some((s) => (!s.from || s.from.includes(t.from)) && (!s.to || s.to.includes(t.to))));
  }
  async rawLogs(address: Address, topics: ViemHex[][]) {
    this.calls++;
    if (address.toLowerCase() !== REP.toLowerCase()) return [];
    return this.logs.filter((l) => topics.every((alt, i) => alt.length === 0 || alt.some((t) => l.topics[i]?.toLowerCase() === t.toLowerCase())));
  }
}

const identity = (owner: Address | null, agentWallet: Address | null = null, uri: string | null = null): AgentIdentityReader => ({
  ownerOf: async () => owner,
  agentWallet: async () => agentWallet,
  tokenURI: async () => uri,
});

/** 40 reviewers all funded by `funder`, plus 6 independents funded by six different wallets. */
function scenario(funder: Address) {
  const chain = new FakeChain();
  for (let i = 0; i < 40; i++) {
    chain.fund(funder, addr(0x1000 + i), T0 + i * 3);
    chain.feedback(addr(0x1000 + i), T0 + 3600);
  }
  for (let i = 0; i < 6; i++) {
    chain.fund(addr(0xb000 + i), addr(0x2000 + i), T0 - 86_400 * (i + 2), BigInt(i + 1) * MON);
    chain.feedback(addr(0x2000 + i), T0 + 86_400 * (i + 1));
  }
  return chain;
}

describe('owner-funded reviewers', () => {
  it('flags a fleet funded by the agent owner and keeps it off the allowlist', async () => {
    const r = await agentReputation(AGENT, { chain: scenario(OWNER), network: 'mainnet', identity: identity(OWNER) });
    expect(r.agent?.owner).toBe(OWNER);
    const fleet = r.operators[0]!;
    expect(fleet).toMatchObject({ kind: 'linked', clients: 40, ownerLinked: true });
    expect(fleet.reasons.join(' | ')).toMatch(/The funder is this agent's own owner/);
    expect(r.ownerLinked).toMatchObject({ operators: 1, clients: 40 });
    expect(r.ownerLinked!.share).toBeCloseTo(40 / 46, 5);
    expect(r.independent).toMatchObject({ operators: 7, unrelatedToOwner: 6 });
    // one representative per operator, without the owner's fleet
    expect(r.clientAllowlist).toHaveLength(6);
    expect(r.clientAllowlist.every((a) => BigInt(a) >= 0x2000n && BigInt(a) < 0x2006n)).toBe(true);
  });

  it('a fleet funded by someone else is not owner-linked', async () => {
    const r = await agentReputation(AGENT, { chain: scenario(addr(0xfeed)), network: 'mainnet', identity: identity(OWNER) });
    expect(r.operators[0]).toMatchObject({ kind: 'linked', clients: 40 });
    expect(r.operators[0]!.ownerLinked).toBeUndefined();
    expect(r.ownerLinked).toMatchObject({ operators: 0, clients: 0, share: 0 });
    expect(r.clientAllowlist).toHaveLength(7);
  });

  it('also counts the agent wallet as the owner, and an owner who reviewed its own agent', async () => {
    const wallet = addr(0x0aa2);
    const viaWallet = await agentReputation(AGENT, { chain: scenario(wallet), network: 'mainnet', identity: identity(OWNER, wallet) });
    expect(viaWallet.operators[0]!.ownerLinked).toBe(true);

    const chain = scenario(addr(0xfeed));
    chain.fund(addr(0xb100), OWNER, T0 - 86_400 * 9);
    chain.feedback(OWNER, T0 + 5000);
    const selfReview = await agentReputation(AGENT, { chain, network: 'mainnet', identity: identity(OWNER) });
    const op = selfReview.operators.find((o) => o.id === `wallet:${OWNER}`)!;
    expect(op.ownerLinked).toBe(true);
    expect(op.reasons.join(' ')).toMatch(/owner reviewed it/);
  });

  it('without an identity reader nothing about the owner is claimed', async () => {
    const r = await agentReputation(AGENT, { chain: scenario(OWNER), network: 'mainnet' });
    expect(r.agent).toBeUndefined();
    expect(r.ownerLinked).toBeUndefined();
    expect(r.clientAllowlist).toHaveLength(7);
  });

  it('a failing identity read does not break the analysis', async () => {
    const broken: AgentIdentityReader = { ownerOf: async () => Promise.reject(new Error('rpc down')), agentWallet: async () => null, tokenURI: async () => null };
    const r = await agentReputation(AGENT, { chain: scenario(OWNER), network: 'mainnet', identity: broken });
    expect(r.agent).toBeUndefined();
    expect(r.independent.operators).toBe(7);
  });
});

describe('agent registration files', () => {
  const dataUri = (o: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(o)).toString('base64')}`;

  it('reads name and description from a data: URI with no network at all', async () => {
    const p = await readAgentProfile(identity(OWNER, null, dataUri({ name: 'Eve', description: 'A simulation', x402Support: true })), 1n, { fetch: (() => Promise.reject(new Error('no network'))) as never });
    expect(p).toMatchObject({ owner: OWNER, name: 'Eve', description: 'A simulation', x402Support: true });
  });

  it('does not fetch an https link unless asked to', async () => {
    let fetched = 0;
    const f = (async () => (fetched++, new Response(JSON.stringify({ name: 'Remote' })))) as unknown as typeof fetch;
    const off = await readAgentProfile(identity(OWNER, null, 'https://example.com/m.json'), 1n, { fetch: f });
    expect(off.name).toBeUndefined();
    expect(fetched).toBe(0);
    const on = await readAgentProfile(identity(OWNER, null, 'https://example.com/m.json'), 1n, { fetch: f, fetchMetadata: true });
    expect(on.name).toBe('Remote');
  });

  it('refuses unsafe links: http, localhost, private and literal IPs, credentials, internal names', () => {
    for (const u of ['http://example.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://192.168.1.5/a', 'https://[::1]/a', 'https://user:pw@example.com/a', 'https://metadata.internal/a', 'https://intranet/a', 'file:///etc/passwd', 'https://2130706433/a']) {
      expect(isSafeHttpsUrl(u)).toBe(false);
    }
    expect(isSafeHttpsUrl('https://eve-8004.vercel.app/metadata/m.json')).toBe(true);
  });

  it('never calls fetch for an unsafe link, and rejects a redirect and an oversized file', async () => {
    let calls = 0;
    const spy = (async () => (calls++, new Response('{}'))) as unknown as typeof fetch;
    expect(await loadMetadata('https://127.0.0.1/x', { fetch: spy })).toBeUndefined();
    expect(await loadMetadata('http://example.com/x', { fetch: spy })).toBeUndefined();
    expect(calls).toBe(0);

    const big = (async () => new Response('x'.repeat(200), { headers: { 'content-length': '200' } })) as unknown as typeof fetch;
    expect(await loadMetadata('https://example.com/x', { fetch: big, maxBytes: 100 })).toBeUndefined();
    let init: RequestInit | undefined;
    const capture = (async (_u: string, i: RequestInit) => ((init = i), new Response('{"name":"a"}'))) as unknown as typeof fetch;
    await loadMetadata('https://example.com/x', { fetch: capture });
    expect(init?.redirect).toBe('error'); // a redirect to an internal address is an error, not followed
  });

  it('serves ipfs links through a gateway and trims untrusted text', async () => {
    let url = '';
    const f = (async (u: string) => ((url = u), new Response(JSON.stringify({ name: `  Agent\u0000 Smith  `, description: 'd'.repeat(500) })))) as unknown as typeof fetch;
    const m = parseAgentMetadata(await loadMetadata('ipfs://bafyabc/agent.json', { fetch: f }));
    expect(url).toBe('https://ipfs.io/ipfs/bafyabc/agent.json');
    expect(m.name).toBe('Agent  Smith');
    expect(m.description).toHaveLength(300);
    expect(parseAgentMetadata('nonsense')).toEqual({});
  });
});

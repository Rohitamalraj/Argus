import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { Decision } from '@argus/scoring';
import type { AgentReputation, VerifyResult } from '@argus/sdk';
import { createServer, type ArgusFactory } from '../src/server.ts';

const F = '0x00000000000000000000000000000000000fa111';
const A = '0x0000000000000000000000000000000000000a01';
const B = '0x0000000000000000000000000000000000000b02';
const C = '0x0000000000000000000000000000000000000c03';

const decision = (wallet: string, tierName: string, firstFunder: string | null, reasons: string[]): Decision =>
  ({ wallet, tier: tierName === 'Linked' ? 1 : 2, tierName, confidence: 'high', operatorId: '0x', groupSize: tierName === 'Linked' ? 10 : 1, firstFunder, funderIsHub: false, signals: { S1: true, S2: true, S3: false, S4: false }, agreement: 'single-source', reasons }) as unknown as Decision;

const calls: { fn: string; args: unknown[] }[] = [];
const fake: ArgusFactory = (network) => ({
  network: { name: network } as never,
  async checkWallet(w) {
    calls.push({ fn: 'checkWallet', args: [network, w] });
    if (w === A || w === B) return decision(w, 'Linked', F, ['First USDC funder also seeded 9 other wallets', 'Funded in identical 0.20 USDC amounts to 10 wallets within 13 seconds']);
    return decision(w, 'Independent', '0x00000000000000000000000000000000000e0001', ['First USDC funder is a known hub']);
  },
  async verify(w, attestor) {
    calls.push({ fn: 'verify', args: [network, w, attestor] });
    return { wallet: w, attestor: attestor ?? A, onchain: { tierName: 'Linked', expired: false, exists: true, expiresAt: 1, evidenceHash: '0xab' }, local: decision(w, 'Linked', F, ['x']), matches: true, differences: [] } as unknown as VerifyResult;
  },
  async agentReputation(id, opts) {
    calls.push({ fn: 'agentReputation', args: [network, id, opts] });
    return {
      agentId: String(id),
      network,
      raw: { feedbackCount: 7665, distinctClients: 7665, meanValue: 100, implausibleValues: 117 },
      independent: { operators: 1, linkedOperators: 1, meanValue: 100 },
      sampled: { analyzed: 800, total: 7665 },
      largestOperatorShare: 1,
      operators: [{ id: `funder:${F}`, kind: 'linked', funder: F, clients: 800, feedbackCount: 800, meanValue: 100, confidence: 'high', reasons: ['100% of agent 182 feedback clients (800 wallets) were first funded by this one funder'] }],
      clientAllowlist: [A],
      unattributed: 0,
      hypersyncQueries: 12,
    } as unknown as AgentReputation;
  },
});

async function connect() {
  const server = createServer(fake);
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const textOf = (r: unknown) => (r as { content: { type: string; text: string }[] }).content[0]!.text;

describe('Argus MCP server', () => {
  it('lists the four tools, all read-only, and explains how to use the verdicts', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['argus_agent_reputation', 'argus_check_wallet', 'argus_same_operator', 'argus_verify_attestation']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(client.getInstructions()).toMatch(/shared funding, not wrongdoing/);
  });

  it('argus_check_wallet returns the tier and the reasons', async () => {
    const client = await connect();
    const r = await client.callTool({ name: 'argus_check_wallet', arguments: { wallet: A } });
    expect(r.isError).toBeFalsy();
    const t = textOf(r);
    expect(t).toMatch(/is Linked \(high confidence\), in a funding group of 10/);
    expect(t).toMatch(/identical 0\.20 USDC amounts/);
    expect(JSON.parse(t.split('```json\n')[1]!.split('\n```')[0]!)).toMatchObject({ tier: 'Linked', network: 'mainnet', firstFunder: F });
  });

  it('argus_same_operator says yes for two wallets of one fleet and no for an independent', async () => {
    const client = await connect();
    const yes = await client.callTool({ name: 'argus_same_operator', arguments: { walletA: A, walletB: B } });
    expect(textOf(yes)).toMatch(/^Yes: both wallets were first funded by /);
    const no = await client.callTool({ name: 'argus_same_operator', arguments: { walletA: A, walletB: C } });
    expect(textOf(no)).toMatch(/^No evidence they are the same operator/);
  });

  it('argus_agent_reputation reports raw versus independent counts, with a sampling note', async () => {
    const client = await connect();
    const r = await client.callTool({ name: 'argus_agent_reputation', arguments: { agentId: 182 } });
    const t = textOf(r);
    expect(t).toMatch(/7665 feedback entries from 7665 reviewers, which come from 1 operator \(traced a sample of 800 of 7665 reviewers\)/);
    expect(t).toMatch(/117 entries have absurd values/);
    expect(calls.at(-1)).toMatchObject({ fn: 'agentReputation', args: ['mainnet', 182, { maxClients: 800 }] });
    const data = JSON.parse(t.split('```json\n')[1]!.split('\n```')[0]!);
    expect(data.clientAllowlistSize).toBe(1);
  });

  it('passes the network, attestor and sample size through', async () => {
    const client = await connect();
    await client.callTool({ name: 'argus_agent_reputation', arguments: { agentId: '7', network: 'testnet', sampleClients: 300 } });
    expect(calls.at(-1)).toMatchObject({ args: ['testnet', '7', { maxClients: 300 }] });
    const v = await client.callTool({ name: 'argus_verify_attestation', arguments: { wallet: A, attestor: B } });
    expect(textOf(v)).toMatch(/matches the local recomputation/);
    expect(calls.at(-1)).toMatchObject({ fn: 'verify', args: ['mainnet', A, B] });
  });

  it('rejects a malformed address before doing any work', async () => {
    const client = await connect();
    const before = calls.length;
    const r = await client.callTool({ name: 'argus_check_wallet', arguments: { wallet: '0x123' } });
    expect(r.isError).toBe(true);
    expect(calls.length).toBe(before);
  });

  it('returns a readable error when the data source fails', async () => {
    const broken: ArgusFactory = () => ({
      network: { name: 'Monad' } as never,
      checkWallet: async () => {
        throw new Error('HyperSync 401: bad token');
      },
      verify: async () => {
        throw new Error('unused');
      },
      agentReputation: async () => {
        throw new Error('unused');
      },
    });
    const server = createServer(broken);
    const client = new Client({ name: 'test-agent', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: 'argus_check_wallet', arguments: { wallet: A } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/could not complete the check: HyperSync 401/);
  });
});

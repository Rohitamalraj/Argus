import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Address } from '@argus/scoring';
import type { Argus, Network } from '@argus/sdk';

/** The part of the SDK the tools use. Tests pass a fake. */
export type ArgusFactory = (network: Network) => Pick<Argus, 'network' | 'checkWallet' | 'verify' | 'agentReputation'>;

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'a 0x-prefixed 20-byte address')
  .describe('Wallet address on Monad');
const network = z.enum(['mainnet', 'testnet']).default('mainnet').describe('Monad network. Defaults to mainnet.');

const INSTRUCTIONS = `Argus tells you whether wallets are independent operators, using only public chain data.
Use it before you trust a count of distinct wallets: reviewers on an ERC-8004 agent, customers of a promo, participants in a campaign.
"Linked" means wallets were first funded by the same non-hub funder and show a second signal (identical amounts, same-day activity, or the funder dominating the group). It means shared funding, not wrongdoing: say "shares a funder", never "fraud".
"Independent" means no shared funder was found. "Unclear" means there is not enough evidence either way.
Results are recomputed locally from chain history and carry their reasons; quote the reasons when you explain a verdict.`;

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
const text = (summary: string, data: unknown) => ({ content: [{ type: 'text' as const, text: `${summary}\n\n\`\`\`json\n${json(data)}\n\`\`\`` }] });
const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function createServer(argusFor: ArgusFactory, opts: { defaultSample?: number } = {}): McpServer {
  const server = new McpServer({ name: 'argus', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;
  const guard = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      return fail(`Argus could not complete the check: ${(e as Error).message}`);
    }
  };

  server.registerTool(
    'argus_check_wallet',
    {
      title: 'Check whether a wallet is an independent operator',
      description:
        "Recomputes a wallet's operator-independence verdict from public chain data (who first funded it, and who else that funder funded). Returns the tier (Linked, Independent or Unclear), a confidence, the size of its funding group and the reasons.",
      inputSchema: { wallet: address, network },
      annotations: readOnly,
    },
    ({ wallet, network: net }) =>
      guard(async () => {
        const d = await argusFor(net).checkWallet(wallet as Address);
        const summary = `${wallet} is ${d.tierName} (${d.confidence} confidence), in a funding group of ${d.groupSize}.\n${d.reasons.map((r) => `- ${r}`).join('\n')}`;
        return text(summary, { wallet, network: net, tier: d.tierName, confidence: d.confidence, groupSize: d.groupSize, firstFunder: d.firstFunder, funderIsHub: d.funderIsHub, signals: d.signals, reasons: d.reasons });
      }),
  );

  server.registerTool(
    'argus_same_operator',
    {
      title: 'Check whether two wallets are run by the same operator',
      description:
        'Checks two wallets and says whether they share a first funder and are Linked into one operator. Use it before treating two agents or customers as independent of each other.',
      inputSchema: { walletA: address, walletB: address, network },
      annotations: readOnly,
    },
    ({ walletA, walletB, network: net }) =>
      guard(async () => {
        const a = argusFor(net);
        const [da, db] = await Promise.all([a.checkWallet(walletA as Address), a.checkWallet(walletB as Address)]);
        const same = da.tierName === 'Linked' && db.tierName === 'Linked' && !!da.firstFunder && da.firstFunder.toLowerCase() === db.firstFunder?.toLowerCase();
        const sharedFunder = !!da.firstFunder && da.firstFunder.toLowerCase() === db.firstFunder?.toLowerCase();
        const summary = same
          ? `Yes: both wallets were first funded by ${da.firstFunder} and are Linked into one operator.`
          : sharedFunder
            ? `They share a first funder (${da.firstFunder}) but the evidence is not enough to link them (${da.tierName} / ${db.tierName}).`
            : `No evidence they are the same operator: ${walletA} is ${da.tierName}, ${walletB} is ${db.tierName}, and they have different first funders.`;
        return text(summary, { sameOperator: same, sharedFirstFunder: sharedFunder, a: { wallet: walletA, tier: da.tierName, firstFunder: da.firstFunder, reasons: da.reasons }, b: { wallet: walletB, tier: db.tierName, firstFunder: db.firstFunder, reasons: db.reasons } });
      }),
  );

  server.registerTool(
    'argus_agent_reputation',
    {
      title: 'ERC-8004 agent reputation, deduplicated by operator',
      description:
        "Reads an ERC-8004 agent's feedback from the Reputation registry on Monad and groups the reviewers into operators by who first funded them. Returns raw feedback and reviewer counts next to the number of independent operators, the share held by the largest operator, and an allowlist (one reviewer per operator) to pass as clientAddresses to the registry's getSummary. Large agents are traced from a sample.",
      inputSchema: {
        agentId: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).describe('ERC-8004 agent id (the Identity registry token id)'),
        network,
        sampleClients: z.number().int().min(50).max(10000).optional().describe('How many reviewers to trace for a large agent (default 800). More is slower and more exact.'),
      },
      annotations: readOnly,
    },
    ({ agentId, network: net, sampleClients }) =>
      guard(async () => {
        const r = await argusFor(net).agentReputation(agentId, { maxClients: sampleClients ?? opts.defaultSample ?? 800 });
        const sampled = r.sampled ? ` (traced a sample of ${r.sampled.analyzed} of ${r.sampled.total} reviewers)` : '';
        const lines = [
          `ERC-8004 agent ${r.agentId}${r.agent?.name ? ` (${r.agent.name})` : ''}: ${r.raw.feedbackCount} feedback entries from ${r.raw.distinctClients} reviewer${r.raw.distinctClients === 1 ? '' : 's'}, which come from ${r.independent.operators} operator${r.independent.operators === 1 ? '' : 's'}${sampled}.`,
          r.independent.linkedOperators ? `${r.independent.linkedOperators} Linked fleet(s); the largest operator holds ${pct(r.largestOperatorShare)} of the traced reviewers.` : 'No Linked fleets found.',
          r.ownerLinked?.clients ? `${r.ownerLinked.clients} reviewer(s) (${pct(r.ownerLinked.share)}) were funded by the agent's own owner${r.agent?.owner ? ` (${r.agent.owner})` : ''}: self-dealing, not independent feedback. ${r.independent.unrelatedToOwner ?? 0} operator(s) are unrelated to the owner.` : '',
          r.raw.implausibleValues ? `${r.raw.implausibleValues} entries have absurd values (beyond 1e15) and are excluded from the means.` : '',
          `Mean feedback value: ${r.raw.meanValue?.toFixed(1) ?? 'n/a'} raw, ${r.independent.meanValue?.toFixed(1) ?? 'n/a'} counting each operator once.`,
          ...r.operators.slice(0, 3).flatMap((op) => [`- ${op.kind} ${op.id.slice(0, 20)}...: ${op.clients} reviewer(s), ${op.feedbackCount} feedback (${op.confidence})`, ...op.reasons.map((x) => `    ${x}`)]),
        ].filter(Boolean);
        const { operators, clientAllowlist, ...rest } = r;
        return text(lines.join('\n'), { ...rest, topOperators: operators.slice(0, 10), clientAllowlistSize: clientAllowlist.length, clientAllowlist: clientAllowlist.slice(0, 200) });
      }),
  );

  server.registerTool(
    'argus_verify_attestation',
    {
      title: 'Verify a published Argus verdict',
      description:
        'Reads the verdict an attestor published on the Argus registry for a wallet and recomputes it locally from public chain data, so you do not have to trust the attestor. Returns whether the two match.',
      inputSchema: { wallet: address, attestor: address.optional().describe('Attestor address. Defaults to the hosted Argus analyzer.'), network },
      annotations: readOnly,
    },
    ({ wallet, attestor, network: net }) =>
      guard(async () => {
        const v = await argusFor(net).verify(wallet as Address, attestor as Address | undefined);
        const summary = v.matches
          ? `The published verdict (${v.onchain.tierName}) matches the local recomputation (${v.local.tierName}).`
          : `Not confirmed: ${v.differences.join('; ') || 'verdicts differ'}.`;
        return text(summary, { wallet, attestor: v.attestor, matches: v.matches, published: { tier: v.onchain.tierName, expired: v.onchain.expired, exists: v.onchain.exists, expiresAt: v.onchain.expiresAt, evidenceHash: v.onchain.evidenceHash }, recomputed: { tier: v.local.tierName, confidence: v.local.confidence, reasons: v.local.reasons }, differences: v.differences });
      }),
  );

  return server;
}

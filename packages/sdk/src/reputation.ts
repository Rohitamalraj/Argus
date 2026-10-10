import { Tier, decide, makeConfig, type Address, type AssessmentInput, type Confidence, type GroupMember, type Hex, type ScoringConfig, type Transfer } from '@argus/scoring';
import { fetchAgentFeedback, type Feedback } from './erc8004.ts';
import { readAgentProfile, type AgentIdentityReader, type AgentProfile } from './identity.ts';
import type { Network, NetworkInfo } from './networks.ts';
import { NETWORKS } from './networks.ts';
import type { ChainReader } from './providers/hypersync.ts';

const MON = 10n ** 18n;
const ZERO_SALT: Hex = `0x${'00'.repeat(32)}`;
const CHUNK = 500;
const lc = (a: string) => a.toLowerCase() as Address;

/** Scoring thresholds for native-MON funding: 0.01 MON is funding, 0.1 MON counts toward the hub rule. */
export function nativeConfig(knownHubs: Iterable<string> = []): ScoringConfig {
  return makeConfig({ minFunding: MON / 100n, hubMinTransfer: MON / 10n, knownHubs });
}

export interface OperatorSummary {
  /** `funder:0x…` for a shared-funder operator, `wallet:0x…` for a wallet that stands alone. */
  id: string;
  kind: 'linked' | 'independent' | 'unattributed';
  funder: Address | null;
  clients: number;
  feedbackCount: number;
  /** Mean feedback value of this operator's entries (implausible values left out). */
  meanValue: number | null;
  confidence: Confidence;
  reasons: string[];
  /** The funder is the agent's owner or agent wallet, or the owner itself reviewed. Such reviewers are not independent of the agent. */
  ownerLinked?: boolean;
}

export interface AgentReputation {
  agentId: string;
  network: Network;
  raw: {
    feedbackCount: number;
    distinctClients: number;
    /** Mean over entries with a plausible value. */
    meanValue: number | null;
    /** Entries whose value is beyond 1e15 (int128 extremes); left out of every mean. */
    implausibleValues: number;
  };
  /** The agent's owner, wallet and registration (when an identity reader was given). */
  agent?: AgentProfile;
  /** Reviewers funded by, or equal to, the agent's owner. Present when the owner is known. */
  ownerLinked?: { operators: number; clients: number; share: number };
  /** Each operator counted once. `unrelatedToOwner` leaves out operators the agent's owner funded. */
  independent: { operators: number; linkedOperators: number; meanValue: number | null; unrelatedToOwner?: number };
  /** Set when only some clients were traced: shares and counts then describe the sample. */
  sampled?: { analyzed: number; total: number };
  /** Share of all clients that belong to the single largest operator. */
  largestOperatorShare: number;
  operators: OperatorSummary[];
  /**
   * One representative client per operator, leaving out operators the agent's owner funded. Pass it as
   * `clientAddresses` to the registry's `getSummary(agentId, clientAddresses, tag1, tag2)` for a Sybil-filtered
   * summary. It can be empty when every reviewer is owner-linked.
   */
  clientAllowlist: Address[];
  /** Clients with no inbound native transfer we could see (funded through a contract, or too old). Counted as independent. */
  unattributed: number;
  hypersyncQueries: number;
}

export interface ReputationOptions {
  chain: ChainReader;
  network: Network;
  /** Funders that never link wallets (exchanges, faucets, bridges). Lowercase or checksummed. */
  knownHubs?: Iterable<string>;
  /** Override the scoring thresholds. */
  config?: ScoringConfig;
  /** Reputation registry override (defaults to the Monad deployment). */
  reputation?: Address;
  /** Reads the agent's owner and registration from the Identity registry; enables the owner-funded check. */
  identity?: AgentIdentityReader;
  /** Also fetch the registration file (https or ipfs) for the agent's name. Off by default. */
  fetchMetadata?: boolean;
  /** Trace at most this many clients (evenly spread through the feedback history). Default: all of them. */
  maxClients?: number;
  onProgress?: (msg: string) => void;
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Operator-deduplicated ERC-8004 reputation. The spec warns that unfiltered feedback is open to Sybil and
 * spam attacks and expects third-party systems to supply the reviewer filter; this builds that filter from
 * public chain data: feedback clients first funded by the same non-hub funder count as one operator.
 */
export async function agentReputation(agentId: bigint | number | string, o: ReputationOptions): Promise<AgentReputation> {
  const net: NetworkInfo = NETWORKS[o.network];
  const id = BigInt(agentId);
  const cfg = o.config ?? nativeConfig(o.knownHubs);
  const log = o.onProgress ?? (() => {});
  const profileP: Promise<AgentProfile | undefined> = o.identity ? readAgentProfile(o.identity, id, { fetchMetadata: o.fetchMetadata }).catch(() => undefined) : Promise.resolve(undefined);

  const feedback = await fetchAgentFeedback(o.chain, o.reputation ?? net.erc8004.reputation, id);
  const allByClient = new Map<Address, Feedback[]>();
  for (const f of feedback) allByClient.set(f.client, [...(allByClient.get(f.client) ?? []), f]);
  const allClients = [...allByClient.keys()];
  log(`${feedback.length} feedback entries from ${allClients.length} clients`);
  const plausible = (fs: Feedback[]) => fs.filter((f) => !f.implausible).map((f) => f.value);
  const rawMean = mean(plausible(feedback));
  const implausibleValues = feedback.filter((f) => f.implausible).length;
  if (allClients.length === 0) {
    const emptyAgent = await profileP;
    return { agentId: id.toString(), network: o.network, ...(emptyAgent ? { agent: emptyAgent } : {}), raw: { feedbackCount: 0, distinctClients: 0, meanValue: null, implausibleValues: 0 }, independent: { operators: 0, linkedOperators: 0, meanValue: null }, largestOperatorShare: 0, operators: [], clientAllowlist: [], unattributed: 0, hypersyncQueries: o.chain.calls };
  }

  // Optionally trace only a deterministic, evenly spread sample of the clients.
  const limit = o.maxClients && o.maxClients > 0 ? o.maxClients : Infinity;
  const clients = allClients.length <= limit ? allClients : Array.from({ length: limit }, (_, i) => allClients[Math.floor((i * allClients.length) / limit)]!);
  const byClient = new Map<Address, Feedback[]>(clients.map((c) => [c, allByClient.get(c)!]));
  const sampled = clients.length < allClients.length ? { analyzed: clients.length, total: allClients.length } : undefined;
  if (sampled) log(`tracing a sample of ${sampled.analyzed} of ${sampled.total} clients`);

  // 1. First native funder of every client: the earliest inbound transfer of at least minFunding.
  const first = new Map<Address, Transfer>();
  for (const [i, part] of chunks(clients, CHUNK).entries()) {
    log(`tracing first funders ${i * CHUNK + part.length}/${clients.length}`);
    for (const t of await o.chain.nativeTransfers([{ to: part }])) {
      if (t.amount < cfg.minFunding || t.from === t.to) continue;
      const cur = first.get(t.to);
      if (!cur || t.timestamp < cur.timestamp || (t.timestamp === cur.timestamp && (t.txHash ?? '') < (cur.txHash ?? ''))) first.set(t.to, t);
    }
  }
  const groups = new Map<Address, Address[]>();
  const unattributed: Address[] = [];
  for (const c of clients) {
    const f = first.get(c);
    if (!f) unattributed.push(c);
    else groups.set(f.from, [...(groups.get(f.from) ?? []), c]);
  }

  // 2. For funders that seeded enough clients to matter: what else they sent (hub rule, identical instalments).
  const operators: OperatorSummary[] = [];
  const reps = new Map<string, Address>(); // operator id -> one reviewer to put on the allowlist
  const memberLists = new Map<string, Address[]>();
  const add = (op: OperatorSummary, members: Address[], rep: Address) => (operators.push(op), reps.set(op.id, rep), memberLists.set(op.id, members));
  const summarize = (members: Address[], extra: Pick<OperatorSummary, 'id' | 'kind' | 'funder' | 'confidence' | 'reasons'>): OperatorSummary => {
    const entries = members.flatMap((m) => byClient.get(m)!);
    return { ...extra, clients: members.length, feedbackCount: entries.length, meanValue: mean(plausible(entries)) };
  };

  for (const [funder, members] of groups) {
    if (members.length < cfg.minGroupSize) {
      for (const m of members) {
        add(summarize([m], { id: `wallet:${m}`, kind: 'independent', funder, confidence: 'medium', reasons: [`First MON funder seeded only ${members.length} feedback client${members.length === 1 ? '' : 's'} of this agent`] }), [m], m);
      }
      continue;
    }
    log(`checking funder ${funder} (${members.length} clients)`);
    const sent = await o.chain.nativeTransfers([{ from: [funder] }]);
    const recipients = new Set(sent.filter((t) => t.amount >= cfg.hubMinTransfer).map((t) => t.to));
    const memberSet = new Set(members);
    const group: GroupMember[] = members.map((m) => ({ wallet: m, firstFundedAt: first.get(m)!.timestamp, firstActiveAt: Math.min(...byClient.get(m)!.map((e) => e.timestamp)) }));
    const input: AssessmentInput = {
      chainId: net.chainId,
      wallet: members[0]!,
      firstFunder: funder,
      funderRecipientCount: recipients.size,
      group,
      funderTransfers: sent.filter((t) => memberSet.has(t.to)),
      groupOutflows: [],
      asset: { symbol: 'MON', decimals: 18 },
      concentration: { share: members.length / clients.length, wallets: members.length, context: `agent ${id} feedback clients` },
    };
    const d = decide(input, ZERO_SALT, cfg);
    if (d.tier === Tier.Linked) {
      add(summarize(members, { id: `funder:${funder}`, kind: 'linked', funder, confidence: d.confidence, reasons: d.reasons }), members, members[0]!);
    } else {
      // Not enough evidence to merge them: each client stands alone, and we say why.
      for (const m of members) {
        add(summarize([m], { id: `wallet:${m}`, kind: 'independent', funder, confidence: d.confidence, reasons: d.reasons }), [m], m);
      }
    }
  }
  for (const m of unattributed) {
    add(summarize([m], { id: `wallet:${m}`, kind: 'unattributed', funder: null, confidence: 'low', reasons: ['No inbound MON transfer found for this client'] }), [m], m);
  }

  // 3. Did the agent's own owner fund these reviewers? Those are not independent of the agent, whoever else they resemble.
  const agent = await profileP;
  const ownerAddrs = new Set([agent?.owner, agent?.agentWallet].filter((a): a is Address => !!a).map(lc));
  if (ownerAddrs.size > 0) {
    for (const op of operators) {
      const fundedByOwner = !!op.funder && ownerAddrs.has(lc(op.funder));
      const ownerReviewed = memberLists.get(op.id)!.some((m) => ownerAddrs.has(lc(m)));
      if (!fundedByOwner && !ownerReviewed) continue;
      op.ownerLinked = true;
      if (fundedByOwner) op.reasons = [...op.reasons, `The funder is this agent's own owner (${agent?.owner})`];
      if (ownerReviewed) op.reasons = [...op.reasons, "The agent's own owner reviewed it"];
    }
  }
  const ownerOps = operators.filter((op) => op.ownerLinked);
  const clientAllowlist = operators.filter((op) => !op.ownerLinked).map((op) => reps.get(op.id)!);

  operators.sort((a, b) => b.clients - a.clients || a.id.localeCompare(b.id));
  const opMeans = operators.map((op) => op.meanValue).filter((v): v is number => v !== null);
  return {
    agentId: id.toString(),
    network: o.network,
    raw: { feedbackCount: feedback.length, distinctClients: allClients.length, meanValue: rawMean, implausibleValues },
    ...(agent ? { agent } : {}),
    ...(ownerAddrs.size > 0 ? { ownerLinked: { operators: ownerOps.length, clients: ownerOps.reduce((n, op) => n + op.clients, 0), share: ownerOps.reduce((n, op) => n + op.clients, 0) / clients.length } } : {}),
    independent: { operators: operators.length, linkedOperators: operators.filter((op) => op.kind === 'linked').length, meanValue: mean(opMeans), ...(ownerAddrs.size > 0 ? { unrelatedToOwner: operators.length - ownerOps.length } : {}) },
    ...(sampled ? { sampled } : {}),
    largestOperatorShare: operators[0] ? operators[0].clients / clients.length : 0,
    operators,
    clientAllowlist,
    unattributed: unattributed.length,
    hypersyncQueries: o.chain.calls,
  };
}

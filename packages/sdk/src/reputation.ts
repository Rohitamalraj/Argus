import { Tier, decide, makeConfig, type Address, type AssessmentInput, type Confidence, type GroupMember, type Hex, type ScoringConfig, type Transfer } from '@argus/scoring';
import { fetchAgentFeedback, type Feedback } from './erc8004.ts';
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
  /** Each operator counted once. */
  independent: { operators: number; linkedOperators: number; meanValue: number | null };
  /** Set when only some clients were traced: shares and counts then describe the sample. */
  sampled?: { analyzed: number; total: number };
  /** Share of all clients that belong to the single largest operator. */
  largestOperatorShare: number;
  operators: OperatorSummary[];
  /**
   * One representative client per operator. Pass it as `clientAddresses` to the registry's
   * `getSummary(agentId, clientAddresses, tag1, tag2)` for a Sybil-filtered summary.
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

  const feedback = await fetchAgentFeedback(o.chain, o.reputation ?? net.erc8004.reputation, id);
  const allByClient = new Map<Address, Feedback[]>();
  for (const f of feedback) allByClient.set(f.client, [...(allByClient.get(f.client) ?? []), f]);
  const allClients = [...allByClient.keys()];
  log(`${feedback.length} feedback entries from ${allClients.length} clients`);
  const plausible = (fs: Feedback[]) => fs.filter((f) => !f.implausible).map((f) => f.value);
  const rawMean = mean(plausible(feedback));
  const implausibleValues = feedback.filter((f) => f.implausible).length;
  if (allClients.length === 0) {
    return { agentId: id.toString(), network: o.network, raw: { feedbackCount: 0, distinctClients: 0, meanValue: null, implausibleValues: 0 }, independent: { operators: 0, linkedOperators: 0, meanValue: null }, largestOperatorShare: 0, operators: [], clientAllowlist: [], unattributed: 0, hypersyncQueries: o.chain.calls };
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
  const clientAllowlist: Address[] = [];
  const summarize = (members: Address[], extra: Pick<OperatorSummary, 'id' | 'kind' | 'funder' | 'confidence' | 'reasons'>): OperatorSummary => {
    const entries = members.flatMap((m) => byClient.get(m)!);
    return { ...extra, clients: members.length, feedbackCount: entries.length, meanValue: mean(plausible(entries)) };
  };

  for (const [funder, members] of groups) {
    if (members.length < cfg.minGroupSize) {
      for (const m of members) {
        operators.push(summarize([m], { id: `wallet:${m}`, kind: 'independent', funder, confidence: 'medium', reasons: [`First MON funder seeded only ${members.length} feedback client${members.length === 1 ? '' : 's'} of this agent`] }));
        clientAllowlist.push(m);
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
      operators.push(summarize(members, { id: `funder:${funder}`, kind: 'linked', funder, confidence: d.confidence, reasons: d.reasons }));
      clientAllowlist.push(members[0]!);
    } else {
      // Not enough evidence to merge them: each client stands alone, and we say why.
      for (const m of members) {
        operators.push(summarize([m], { id: `wallet:${m}`, kind: 'independent', funder, confidence: d.confidence, reasons: d.reasons }));
        clientAllowlist.push(m);
      }
    }
  }
  for (const m of unattributed) {
    operators.push(summarize([m], { id: `wallet:${m}`, kind: 'unattributed', funder: null, confidence: 'low', reasons: ['No inbound MON transfer found for this client'] }));
    clientAllowlist.push(m);
  }

  operators.sort((a, b) => b.clients - a.clients || a.id.localeCompare(b.id));
  const opMeans = operators.map((op) => op.meanValue).filter((v): v is number => v !== null);
  return {
    agentId: id.toString(),
    network: o.network,
    raw: { feedbackCount: feedback.length, distinctClients: allClients.length, meanValue: rawMean, implausibleValues },
    independent: { operators: operators.length, linkedOperators: operators.filter((op) => op.kind === 'linked').length, meanValue: mean(opMeans) },
    ...(sampled ? { sampled } : {}),
    largestOperatorShare: operators[0] ? operators[0].clients / clients.length : 0,
    operators,
    clientAllowlist,
    unattributed: unattributed.length,
    hypersyncQueries: o.chain.calls,
  };
}

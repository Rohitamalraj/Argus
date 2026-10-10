export const ANALYZER_URL = process.env.NEXT_PUBLIC_ANALYZER_URL ?? 'http://localhost:8787';

export type Network = 'testnet' | 'mainnet';
export type TierName = 'Unclear' | 'Linked' | 'Independent' | 'Verified';

export interface Verdict {
  wallet: string;
  tier: number;
  tierName: TierName;
  operatorId: string;
  groupSize: number;
  confidence: string;
  reasons: string[];
  firstFunder: string | null;
  evidenceHash: string;
  issuedAt: number;
  expiresAt: number;
  attestationTx?: string;
}

export interface Overview {
  network: Network;
  counts: { rawWallets: number; customers: number; operators: number; linked: number; independent: number; unclear: number };
  operators: { operatorId: string; firstFunder: string | null; tierName: TierName; wallets: string[] }[];
  wallets: Verdict[];
  costs: { provider: string; network: string; calls: number; usd: number }[];
}

export async function getOverview(network: Network): Promise<Overview> {
  const r = await fetch(`${ANALYZER_URL}/v1/overview?network=${network}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`analyzer ${r.status}`);
  return r.json();
}

export const explorer = (network: Network) => (network === 'mainnet' ? 'https://monadvision.com' : 'https://testnet.monadvision.com');
export const short = (a: string, n = 4) => `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
export const tierClass = (t: string) => t.toLowerCase();

export interface AgentReputation {
  agentId: string;
  network: Network;
  cached?: boolean;
  raw: { feedbackCount: number; distinctClients: number; meanValue: number | null; implausibleValues: number };
  independent: { operators: number; linkedOperators: number; meanValue: number | null; unrelatedToOwner?: number };
  agent?: { owner: string | null; agentWallet: string | null; uri: string | null; name?: string; description?: string };
  ownerLinked?: { operators: number; clients: number; share: number };
  sampled?: { analyzed: number; total: number };
  largestOperatorShare: number;
  unattributed: number;
  topOperators: { id: string; kind: 'linked' | 'independent' | 'unattributed'; ownerLinked?: boolean; funder: string | null; clients: number; feedbackCount: number; meanValue: number | null; confidence: string; reasons: string[] }[];
  clientAllowlistSize: number;
  hypersyncQueries: number;
}

export async function getAgentReputation(agentId: string, network: Network, sample = 800): Promise<AgentReputation> {
  const r = await fetch(`${ANALYZER_URL}/v1/agent/${agentId}/reputation?network=${network}&sample=${sample}`, { cache: 'no-store' });
  const body = (await r.json().catch(() => ({}))) as AgentReputation & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `analyzer ${r.status}`);
  return body;
}

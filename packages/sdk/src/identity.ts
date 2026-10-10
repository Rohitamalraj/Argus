import { createPublicClient, http, parseAbi, zeroAddress, type PublicClient } from 'viem';
import { monad, monadTestnet } from 'viem/chains';
import type { Address } from '@argus/scoring';
import { NETWORKS, type Network } from './networks.ts';

const identityAbi = parseAbi([
  'function ownerOf(uint256 agentId) view returns (address)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function tokenURI(uint256 agentId) view returns (string)',
]);

/** What the reputation analysis needs from the ERC-8004 Identity registry. Tests pass a fake. */
export interface AgentIdentityReader {
  ownerOf(agentId: bigint): Promise<Address | null>;
  agentWallet(agentId: bigint): Promise<Address | null>;
  tokenURI(agentId: bigint): Promise<string | null>;
}

export interface AgentProfile {
  /** The ERC-721 owner of the agent. */
  owner: Address | null;
  /** The wallet the agent says it acts from, when set. */
  agentWallet: Address | null;
  /** The agentURI as registered (https, ipfs or data). */
  uri: string | null;
  /** From the registration file, when it could be read. Untrusted text, length-limited. */
  name?: string;
  description?: string;
  x402Support?: boolean;
}

/** Read an agent's owner, wallet and URI from the Identity registry over RPC. */
export function identityReader(network: Network, opts: { rpcUrl?: string; registry?: Address } = {}): AgentIdentityReader {
  const chain = network === 'mainnet' ? monad : monadTestnet;
  const client = createPublicClient({ chain, transport: http(opts.rpcUrl || chain.rpcUrls.default.http[0]) }) as PublicClient;
  const address = opts.registry ?? NETWORKS[network].erc8004.identity;
  const read = <T>(functionName: 'ownerOf' | 'getAgentWallet' | 'tokenURI', agentId: bigint): Promise<T | null> =>
    client.readContract({ address, abi: identityAbi, functionName, args: [agentId] }).then((v) => v as T, () => null);
  const wallet = (v: Address | null) => (v && v.toLowerCase() !== zeroAddress ? v : null);
  return {
    ownerOf: async (id) => wallet(await read<Address>('ownerOf', id)),
    agentWallet: async (id) => wallet(await read<Address>('getAgentWallet', id)),
    tokenURI: async (id) => (await read<string>('tokenURI', id)) || null,
  };
}

export interface MetadataOptions {
  /** Fetch an https or ipfs registration file. Off by default: a server should not fetch links an agent chose. */
  fetchMetadata?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Owner, wallet and URI, plus name and description when the registration file can be read safely. */
export async function readAgentProfile(reader: AgentIdentityReader, agentId: bigint, opts: MetadataOptions = {}): Promise<AgentProfile> {
  const [owner, agentWallet, uri] = await Promise.all([reader.ownerOf(agentId), reader.agentWallet(agentId), reader.tokenURI(agentId)]);
  const profile: AgentProfile = { owner, agentWallet, uri };
  // data: URIs carry their own content, so reading them touches no network.
  const json = uri && (uri.startsWith('data:') || opts.fetchMetadata) ? await loadMetadata(uri, opts) : undefined;
  return { ...profile, ...parseAgentMetadata(json) };
}

const clean = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max) || undefined : undefined;

/** Pick the few fields we show from an agent registration file. The content is untrusted. */
export function parseAgentMetadata(json: unknown): Pick<AgentProfile, 'name' | 'description' | 'x402Support'> {
  if (!json || typeof json !== 'object') return {};
  const j = json as Record<string, unknown>;
  const name = clean(j.name, 80);
  const description = clean(j.description, 300);
  return { ...(name ? { name } : {}), ...(description ? { description } : {}), ...(typeof j.x402Support === 'boolean' ? { x402Support: j.x402Support } : {}) };
}

/** https only; no credentials; no localhost, internal names or IP literals (private ranges included). */
export function isSafeHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  if (h.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\d+$/.test(h)) return false; // IP literals
  return true;
}

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

/** Read a registration file from a data:, ipfs:// or https URI, within a size and time limit. */
export async function loadMetadata(uri: string, opts: MetadataOptions = {}): Promise<unknown | undefined> {
  const maxBytes = opts.maxBytes ?? 64 * 1024;
  try {
    if (uri.startsWith('data:')) {
      const comma = uri.indexOf(',');
      if (comma < 0) return undefined;
      const head = uri.slice(5, comma);
      const body = uri.slice(comma + 1);
      const text = head.includes(';base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
      return text.length <= maxBytes ? JSON.parse(text) : undefined;
    }
    const url = uri.startsWith('ipfs://') ? IPFS_GATEWAY + uri.slice(7).replace(/^ipfs\//, '') : uri;
    if (!isSafeHttpsUrl(url)) return undefined;
    const res = await (opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 5000), redirect: 'error', headers: { accept: 'application/json' } });
    if (!res.ok) return undefined;
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxBytes) return undefined;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength <= maxBytes ? JSON.parse(new TextDecoder().decode(buf)) : undefined;
  } catch {
    return undefined;
  }
}

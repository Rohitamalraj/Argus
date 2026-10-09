import { decodeEventLog, pad, parseAbi, toEventSelector, toHex, type Hex as ViemHex } from 'viem';
import type { Address } from '@argus/scoring';
import type { ChainReader } from './providers/hypersync.ts';

/**
 * ERC-8004 Reputation registry (draft standard, deployed on Monad). The event and read signatures were
 * checked against the deployed contract: the NewFeedback selector below matches every feedback log on-chain.
 */
export const reputationAbi = parseAbi([
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex)',
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function getClients(uint256 agentId) view returns (address[])',
]);

export const NEW_FEEDBACK = toEventSelector('NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)');
export const FEEDBACK_REVOKED = toEventSelector('FeedbackRevoked(uint256,address,uint64)');

/** Feedback values are scores and ratings. Beyond this magnitude a value is treated as noise in means. */
export const IMPLAUSIBLE_VALUE = 1e15;

export interface Feedback {
  agentId: bigint;
  client: Address;
  index: bigint;
  /** value / 10^decimals */
  value: number;
  /** The value is absurdly large (beyond 1e15 after decimals): int128 extremes that wreck any average. */
  implausible: boolean;
  tag1: string;
  tag2: string;
  timestamp: number;
  txHash: `0x${string}`;
}

/** Every live (non-revoked) feedback entry for one agent, oldest first. */
export async function fetchAgentFeedback(chain: ChainReader, reputation: Address, agentId: bigint): Promise<Feedback[]> {
  const logs = await chain.rawLogs(reputation, [[NEW_FEEDBACK, FEEDBACK_REVOKED], [pad(toHex(agentId), { size: 32 })]]);
  const live = new Map<string, Feedback>();
  for (const l of logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)) {
    const topics = l.topics as [ViemHex, ...ViemHex[]];
    if (topics[0] === NEW_FEEDBACK) {
      const { args } = decodeEventLog({ abi: reputationAbi, eventName: 'NewFeedback', topics, data: l.data });
      const f = args as { agentId: bigint; clientAddress: Address; feedbackIndex: bigint; value: bigint; valueDecimals: number; tag1: string; tag2: string };
      const client = f.clientAddress.toLowerCase() as Address;
      live.set(`${client}:${f.feedbackIndex}`, {
        agentId: f.agentId,
        client,
        index: f.feedbackIndex,
        value: Number(f.value) / 10 ** f.valueDecimals,
        implausible: Math.abs(Number(f.value) / 10 ** f.valueDecimals) > IMPLAUSIBLE_VALUE,
        tag1: f.tag1,
        tag2: f.tag2,
        timestamp: l.timestamp,
        txHash: l.txHash,
      });
    } else if (topics[0] === FEEDBACK_REVOKED) {
      const { args } = decodeEventLog({ abi: reputationAbi, eventName: 'FeedbackRevoked', topics, data: l.data });
      const r = args as { clientAddress: Address; feedbackIndex: bigint };
      live.delete(`${r.clientAddress.toLowerCase()}:${r.feedbackIndex}`);
    }
  }
  return [...live.values()];
}

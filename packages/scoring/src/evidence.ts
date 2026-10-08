import { keccak256, toBytes } from 'viem';
import type { Decision, Hex } from './types.ts';

export interface ProviderCost {
  name: string;
  calls: number;
  usd: number;
}

/** Evidence bundle (off-chain; its hash goes on-chain). Summaries only: no raw provider data, labels, hints or member lists. */
export interface EvidenceBundle {
  version: 2;
  network: 'mainnet' | 'testnet';
  wallet: string;
  generatedAt: number;
  providers: ProviderCost[];
  funding: { firstFunder: string | null; funderIsHub: boolean; groupSize: number };
  signals: Decision['signals'];
  agreement: Decision['agreement'];
  decision: { tier: number; tierName: string; confidence: string; operatorId: string };
  reasons: string[];
  attribution?: 'Powered by Nansen API';
}

export function buildEvidenceBundle(
  d: Decision,
  network: 'mainnet' | 'testnet',
  providers: ProviderCost[],
  generatedAt: number,
): EvidenceBundle {
  const usedNansen = providers.some((p) => p.name === 'nansen' && p.calls > 0);
  return {
    version: 2,
    network,
    wallet: d.wallet.toLowerCase(),
    generatedAt,
    providers,
    funding: { firstFunder: d.firstFunder?.toLowerCase() ?? null, funderIsHub: d.funderIsHub, groupSize: d.groupSize },
    signals: d.signals,
    agreement: d.agreement,
    decision: { tier: d.tier, tierName: d.tierName, confidence: d.confidence, operatorId: d.operatorId },
    reasons: d.reasons,
    ...(usedNansen ? { attribution: 'Powered by Nansen API' as const } : {}),
  };
}

/** JSON with keys sorted at every level, so the same bundle always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function evidenceHash(bundle: EvidenceBundle): Hex {
  return keccak256(toBytes(canonicalJson(bundle)));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  if (typeof v === 'bigint') return v.toString();
  return v;
}

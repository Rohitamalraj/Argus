import type { Address } from './types.ts';

const isAddr = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

/** The payer the client claims on the unpaid request (MW-1). A claim, not proof. */
export function claimedPayer(header: string | string[] | undefined): Address | undefined {
  const v = Array.isArray(header) ? header[0] : header;
  return isAddr(v?.trim()) ? (v!.trim().toLowerCase() as Address) : undefined;
}

/**
 * The payer who actually signed, decoded from the x402 payment header ourselves (MW-1):
 * base64 JSON whose payload.authorization.from is the EIP-3009 `from`.
 */
export function signedPayer(header: string | string[] | undefined): Address | undefined {
  return decodePayment(header)?.from;
}

/** Payer and authorization nonce of an x402 payment header; the nonce ties a settlement back to its request. */
export function decodePayment(header: string | string[] | undefined): { from: Address; nonce?: string } | undefined {
  const v = Array.isArray(header) ? header[0] : header;
  if (!v) return;
  try {
    const json = JSON.parse(Buffer.from(v, 'base64').toString('utf8')) as { payload?: unknown };
    return fromPayload(json.payload);
  } catch {
    return;
  }
}

/** Same as decodePayment, for an already-parsed payload (settlement hooks). */
export function fromPayload(payload: unknown): { from: Address; nonce?: string } | undefined {
  const p = payload as { authorization?: { from?: unknown; nonce?: unknown }; permit2Authorization?: { from?: unknown; nonce?: unknown } } | undefined;
  const auth = p?.authorization ?? p?.permit2Authorization;
  if (!isAddr(auth?.from)) return;
  return { from: auth.from.toLowerCase() as Address, ...(auth.nonce !== undefined ? { nonce: String(auth.nonce) } : {}) };
}

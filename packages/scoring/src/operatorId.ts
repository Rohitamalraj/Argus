import { encodeAbiParameters, keccak256, zeroHash } from 'viem';
import type { Address, Hex } from './types.ts';

/**
 * operatorId, matching the registry spec:
 *   Linked:      keccak256(abi.encode(chainId, F, attestorSalt))
 *   Independent: keccak256(abi.encode(chainId, wallet, attestorSalt))
 *   Unclear:     zero
 */
export function operatorIdFor(chainId: number, subject: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
      [BigInt(chainId), subject, salt],
    ),
  );
}

export const UNCLEAR_OPERATOR: Hex = zeroHash;

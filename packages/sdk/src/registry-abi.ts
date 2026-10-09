import { parseAbi } from 'viem';

export const registryAbi = parseAbi([
  'struct Verdict { bytes32 operatorId; uint8 tier; uint16 groupSize; uint64 issuedAt; uint64 expiresAt; bytes32 evidenceHash; }',
  'function attest(address wallet, Verdict v)',
  'function attestBatch(address[] wallets, Verdict[] v)',
  'function verdictOf(address wallet, address attestor) view returns (Verdict)',
  'function tierOf(address wallet, address attestor) view returns (uint8)',
  'function sameOperator(address a, address b, address attestor) view returns (bool)',
  'event Attested(address indexed wallet, address indexed attestor, bytes32 indexed operatorId, uint8 tier, uint64 expiresAt)',
]);

import { describe, expect, it } from 'vitest';
import { DynamicSigner, type DynamicEvmClient } from '../src/dynamic-signer.ts';

const ADDR = '0x00000000000000000000000000000000000000aa';

describe('DynamicSigner', () => {
  it('uses the Dynamic wallet address as its identity and holds no private key', () => {
    const client: DynamicEvmClient = { signTransaction: async () => '0x' };
    const s = new DynamicSigner('testnet', client, { walletMetadata: { accountAddress: ADDR } });
    expect(s.address).toBe(ADDR);
    expect(Object.values(s).some((v) => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v))).toBe(false);
  });
});

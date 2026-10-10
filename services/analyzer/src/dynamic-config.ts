import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DynamicWalletFile } from './dynamic-signer.ts';

export const dynamicAttestorPath = (root: string) => resolve(root, 'data/dynamic-attestor.json');

export function loadDynamicWallet(root: string): DynamicWalletFile | undefined {
  const f = dynamicAttestorPath(root);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as DynamicWalletFile) : undefined;
}

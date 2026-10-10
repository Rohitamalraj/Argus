import { mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';

// @x402/next imports 'next/server' without a file extension, which plain Node ESM rejects; let Vite resolve it.
export default mergeConfig(shared, { test: { server: { deps: { inline: ['@x402/next'] } } } });

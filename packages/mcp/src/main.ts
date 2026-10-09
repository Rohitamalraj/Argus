#!/usr/bin/env -S npx tsx
/**
 * Argus MCP server (stdio).
 *
 *   claude mcp add argus -e ENVIO_API_TOKEN=... -- npx tsx packages/mcp/src/main.ts
 *
 * ENVIO_API_TOKEN is a free Envio HyperSync token (https://envio.dev/app/api-tokens). Wallet addresses are
 * looked up against public chain data only; nothing is sent to an Argus server.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createArgus, type Network } from '@argus/sdk';
import { createServer } from './server.ts';

for (const dir of ['.', '..', '../..', '../../..']) {
  try {
    process.loadEnvFile(`${dir}/.env`);
    break;
  } catch {
    // no .env here
  }
}

const token = process.env.ENVIO_API_TOKEN;
if (!token) {
  console.error('argus-mcp: set ENVIO_API_TOKEN (a free Envio HyperSync token from https://envio.dev/app/api-tokens)');
  process.exit(1);
}

const cache = new Map<Network, ReturnType<typeof createArgus>>();
const server = createServer((network) => {
  let a = cache.get(network);
  if (!a) cache.set(network, (a = createArgus({ network, hypersyncToken: token })));
  return a;
});

await server.connect(new StdioServerTransport());
console.error('argus-mcp ready (stdio)');

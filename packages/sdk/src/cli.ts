#!/usr/bin/env -S npx tsx
/**
 * argus: check wallets and ERC-8004 agent reputation from the command line.
 *
 *   argus reputation <agentId> [--network mainnet|testnet] [--json]
 *   argus check <wallet> [--network ...]
 *   argus verify <wallet> [--attestor 0x...] [--network ...]
 *
 * Needs a free Envio HyperSync token in ENVIO_API_TOKEN (https://envio.dev/app/api-tokens).
 * Everything is recomputed locally from public chain data; no wallet address is sent to an Argus server.
 */
import { isAddress } from 'viem';
import type { Address } from '@argus/scoring';
import { createArgus } from './argus.ts';
import type { Network } from './networks.ts';

for (const dir of ['.', '..', '../..', '../../..']) {
  try {
    process.loadEnvFile(`${dir}/.env`);
    break;
  } catch {
    // no .env here
  }
}

const argv = process.argv.slice(2);
const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]!.startsWith('--') && a !== argv[0]));
const [command, subject] = positional;
const json = argv.includes('--json');
const network = (flag('--network') ?? 'mainnet') as Network;

const usage = () => {
  console.log(`argus <command>

  reputation <agentId>   ERC-8004 reputation, deduplicated by operator (--sample N traces N clients for speed)
  check <wallet>         operator-independence verdict, recomputed locally
  verify <wallet>        compare the published on-chain verdict with a local recomputation

options: --network mainnet|testnet (default mainnet)  --attestor 0x...  --sample N  --json
needs:   ENVIO_API_TOKEN (free HyperSync token)`);
};

const n = (x: number) => x.toLocaleString('en-US');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fixed = (x: number | null) => (x === null ? '-' : x.toFixed(1));
const stringify = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

async function main() {
  if (!command || command === 'help' || command === '--help') return usage();
  if (!['mainnet', 'testnet'].includes(network)) throw new Error('--network must be mainnet or testnet');
  const argus = createArgus({ network, hypersyncToken: process.env.ENVIO_API_TOKEN });

  if (command === 'reputation') {
    if (!subject || !/^\d+$/.test(subject)) throw new Error('usage: argus reputation <agentId>');
    const sample = flag('--sample');
    const r = await argus.agentReputation(subject, {
      ...(sample ? { maxClients: Number(sample) } : {}),
      ...(json ? {} : { onProgress: (m: string) => process.stderr.write(`  ${m}\n`) }),
    });
    if (json) return console.log(stringify(r));
    const s = r.sampled ? ` (sample of ${n(r.sampled.analyzed)} clients)` : '';
    console.log(`\nERC-8004 agent ${r.agentId} on ${argus.network.name}`);
    console.log(`  raw            ${n(r.raw.feedbackCount)} feedback entries from ${n(r.raw.distinctClients)} clients (mean value ${fixed(r.raw.meanValue)})`);
    if (r.raw.implausibleValues) console.log(`                 ${n(r.raw.implausibleValues)} entries have absurd values (beyond 1e15) and are left out of every mean`);
    console.log(`  by operator    ${n(r.independent.operators)} operator${r.independent.operators === 1 ? '' : 's'}${s}; ${r.independent.linkedOperators ? `${n(r.independent.linkedOperators)} of them a Linked fleet` : 'none linked'} (mean value ${fixed(r.independent.meanValue)})`);
    console.log(`  largest        one operator holds ${pct(r.largestOperatorShare)} of ${r.sampled ? 'the sampled' : 'all'} clients`);
    if (r.unattributed) console.log(`  unattributed   ${n(r.unattributed)} clients had no visible MON funding and are counted as independent`);
    for (const op of r.operators.slice(0, 5)) {
      console.log(`\n  ${op.kind === 'linked' ? 'Linked' : op.kind === 'independent' ? 'Independent' : 'Unattributed'}  ${op.id.slice(0, 22)}...  ${n(op.clients)} client(s), ${n(op.feedbackCount)} feedback (${op.confidence})`);
      for (const reason of op.reasons) console.log(`    - ${reason}`);
    }
    console.log(`\n  getSummary filter: ${n(r.clientAllowlist.length)} addresses (one per operator). Use --json for the list.`);
    console.log(`  ${n(r.hypersyncQueries)} HyperSync queries. Verdicts use public chain data only; "Linked" means shared funding, not wrongdoing.`);
    return;
  }

  if (!subject || !isAddress(subject)) throw new Error(`usage: argus ${command} <wallet address>`);
  const wallet = subject as Address;

  if (command === 'check') {
    const d = await argus.checkWallet(wallet);
    if (json) return console.log(stringify(d));
    console.log(`\n${wallet}\n  ${d.tierName} (${d.confidence} confidence), group of ${d.groupSize}`);
    for (const reason of d.reasons) console.log(`  - ${reason}`);
    return;
  }

  if (command === 'verify') {
    const v = await argus.verify(wallet, (flag('--attestor') as Address | undefined) ?? undefined);
    if (json) return console.log(stringify(v));
    console.log(`\n${wallet}\n  published by ${v.attestor}: ${v.onchain.exists ? `${v.onchain.tierName}${v.onchain.expired ? ' (expired)' : ''}` : 'no verdict'}`);
    console.log(`  recomputed locally:        ${v.local.tierName} (${v.local.confidence})`);
    console.log(v.matches ? '  MATCH: the published verdict agrees with public chain data.' : `  DIFFERENT: ${v.differences.join('; ')}`);
    return;
  }
  usage();
  process.exitCode = 1;
}

main().catch((e: Error) => {
  console.error(`argus: ${e.message}`);
  process.exitCode = 1;
});

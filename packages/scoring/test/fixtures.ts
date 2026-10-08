import { usdc, type Address, type Transfer } from '../src/index.ts';

/** Synthetic USDC ledgers for the scoring fixtures (PRD SC-1). Times are unix seconds. */

export const T0 = 1_760_000_000; // 2025-10-09 08:53 UTC
export const HOUR = 3600;
export const DAY = 86_400;
export const CHAIN = 10143;
export const SALT = '0x' + 'ab'.repeat(32) as `0x${string}`;

let txCounter = 0;
export const addr = (tag: number): Address => `0x${tag.toString(16).padStart(40, '0')}` as Address;
export const tx = (from: Address, to: Address, dollars: number, timestamp: number): Transfer => ({
  from,
  to,
  amount: usdc(dollars),
  timestamp,
  txHash: `0x${(++txCounter).toString(16).padStart(64, '0')}`,
});

// Well-known addresses
export const SELLER = addr(0x5e11e7);
export const FAUCET = addr(0xfa0ce7); // on the known-hub list
export const EXCHANGE = addr(0xe8c4a9); // on the known-hub list

/** The demo farm: F seeds 10 wallets with identical 0.20 USDC within 6 minutes; each then pays the seller. */
export function farm(opts: { funder?: Address; size?: number; amount?: number; start?: number; base?: number } = {}) {
  const F = opts.funder ?? addr(0xf00d);
  const size = opts.size ?? 10;
  const start = opts.start ?? T0;
  const base = opts.base ?? 0x1000;
  const wallets = Array.from({ length: size }, (_, i) => addr(base + i));
  const transfers: Transfer[] = [
    tx(EXCHANGE, F, 5, start - DAY),
    ...wallets.map((w, i) => tx(F, w, opts.amount ?? 0.2, start + i * 36)),
    ...wallets.flatMap((w, i) => [tx(w, SELLER, 0.01, start + HOUR + i * 60), tx(w, SELLER, 0.01, start + HOUR + i * 60 + 5)]),
  ];
  return { F, wallets, transfers };
}

/** Three new independents, created the same day as the farm, funded from unrelated sources. */
export function independents(start = T0) {
  const viaFaucet = addr(0x2001);
  const viaExchange = addr(0x2002);
  const viaFriend = addr(0x2003);
  const friend = addr(0xf41e9d);
  const transfers: Transfer[] = [
    tx(FAUCET, viaFaucet, 1, start + 2 * HOUR),
    tx(EXCHANGE, viaExchange, 3, start + 3 * HOUR),
    tx(EXCHANGE, friend, 50, start - 30 * DAY),
    tx(friend, viaFriend, 2, start + 4 * HOUR),
    tx(viaFaucet, SELLER, 0.01, start + 5 * HOUR),
    tx(viaExchange, SELLER, 0.01, start + 5 * HOUR),
    tx(viaFriend, SELLER, 0.01, start + 5 * HOUR),
  ];
  return { wallets: [viaFaucet, viaExchange, viaFriend], friend, transfers };
}

/** A large funder (payroll, airdrop, exchange-like): 250 recipients of 0.50 USDC, same day. */
export function largeFunder() {
  const F = addr(0x1a46e);
  const wallets = Array.from({ length: 250 }, (_, i) => addr(0x30000 + i));
  const transfers = wallets.map((w, i) => tx(F, w, 0.5, T0 + i * 10));
  return { F, wallets, transfers };
}

/** A farm whose funder also sprays dust to 300 wallets to look like a hub. */
export function dustSprayedFarm() {
  const f = farm({ funder: addr(0xd057), base: 0x4000 });
  const dust = Array.from({ length: 300 }, (_, i) => tx(f.F, addr(0x50000 + i), 0.001, T0 + 2 * DAY + i));
  return { ...f, transfers: [...f.transfers, ...dust] };
}

/** Two wallets with identical funding: a pair is below the group minimum. */
export function pair() {
  const F = addr(0x9a14);
  const wallets = [addr(0x6001), addr(0x6002)];
  return { F, wallets, transfers: wallets.map((w, i) => tx(F, w, 0.2, T0 + i * 30)) };
}

/** S1 only: one non-hub funder, 3 wallets, different amounts, weeks apart, spending at different places. */
export function sharedFunderOnly() {
  const F = addr(0x5a1f);
  const wallets = [addr(0x7001), addr(0x7002), addr(0x7003)];
  const transfers = [
    tx(F, wallets[0]!, 0.5, T0),
    tx(F, wallets[1]!, 1.3, T0 + 14 * DAY),
    tx(F, wallets[2]!, 2.0, T0 + 40 * DAY),
    tx(wallets[0]!, addr(0x8001), 0.3, T0 + DAY),
    tx(wallets[1]!, addr(0x8002), 0.6, T0 + 15 * DAY),
    tx(wallets[2]!, addr(0x8003), 1.1, T0 + 41 * DAY),
  ];
  return { F, wallets, transfers };
}

/** S1 + S4 only: different amounts and days, but every wallet sends its money back to F. */
export function closureOnly() {
  const F = addr(0xc105e);
  const wallets = [addr(0x9001), addr(0x9002), addr(0x9003)];
  const transfers = [
    tx(F, wallets[0]!, 0.5, T0),
    tx(F, wallets[1]!, 1.3, T0 + 14 * DAY),
    tx(F, wallets[2]!, 2.0, T0 + 40 * DAY),
    tx(wallets[0]!, F, 0.45, T0 + DAY),
    tx(wallets[1]!, F, 1.2, T0 + 15 * DAY),
    tx(wallets[2]!, F, 1.9, T0 + 41 * DAY),
  ];
  return { F, wallets, transfers };
}

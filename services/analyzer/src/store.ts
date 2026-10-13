import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// Loaded through require so Vite (tests) does not try to resolve the newer `node:sqlite` builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import type { Address, Hex, TierName } from '@argus/scoring';
import type { Network } from './networks.ts';

/** What the API returns for one wallet. */
export interface VerdictRecord {
  wallet: Address;
  network: Network;
  tier: number;
  tierName: TierName;
  operatorId: Hex;
  groupSize: number;
  confidence: string;
  reasons: string[];
  firstFunder: Address | null;
  evidenceHash: Hex;
  issuedAt: number;
  expiresAt: number;
  /** light: chain data only. deep: also cross-checked with Nansen (mainnet promo claims). */
  depth?: 'light' | 'deep';
  /** Computed for a group member that has not asked yet (AN-3). */
  precomputed: boolean;
  /** The wallet paid a seller, so its verdict may be published (AN-7). */
  paid: boolean;
  attestationTx?: Hex;
}

export interface Claim {
  network: Network;
  wallet: Address;
  seller: string;
  ns?: string;
  promo: boolean;
  amount?: string;
  tier?: string;
  operator?: string;
  promoLeft?: number;
  tx?: string;
  ts: number;
}

export class Store {
  private db: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verdicts (
        network TEXT NOT NULL, wallet TEXT NOT NULL, json TEXT NOT NULL,
        expires_at INTEGER NOT NULL, published_key TEXT, attestation_tx TEXT, paid INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (network, wallet));
      CREATE TABLE IF NOT EXISTS evidence (hash TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (network TEXT, wallet TEXT, seller TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT NOT NULL, wallet TEXT NOT NULL, seller TEXT NOT NULL,
        ns TEXT, promo INTEGER NOT NULL, amount TEXT, tier TEXT, operator TEXT, promo_left INTEGER, tx TEXT, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS costs (provider TEXT, network TEXT, calls INTEGER, usd REAL, ts INTEGER);
    `);
  }

  getVerdict(network: Network, wallet: Address): VerdictRecord | undefined {
    const row = this.db
      .prepare('SELECT json, attestation_tx, paid FROM verdicts WHERE network = ? AND wallet = ?')
      .get(network, wallet.toLowerCase()) as { json: string; attestation_tx: string | null; paid: number } | undefined;
    if (!row) return undefined;
    const v = JSON.parse(row.json) as VerdictRecord;
    return { ...v, paid: row.paid === 1, ...(row.attestation_tx ? { attestationTx: row.attestation_tx as Hex } : {}) };
  }

  /** Save a verdict. A precomputed verdict never replaces a fresh one the wallet earned itself. */
  saveVerdict(v: VerdictRecord, now: number): void {
    const existing = this.getVerdict(v.network, v.wallet);
    if (v.precomputed && existing && !existing.precomputed && existing.expiresAt > now) return;
    this.db
      .prepare(
        `INSERT INTO verdicts (network, wallet, json, expires_at, paid) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (network, wallet) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at,
           paid = MAX(paid, excluded.paid)`,
      )
      .run(
        v.network,
        v.wallet.toLowerCase(),
        JSON.stringify({ ...v, wallet: v.wallet.toLowerCase() }),
        v.expiresAt,
        this.hasPaid(v.network, v.wallet) ? 1 : 0,
      );
  }

  markPaid(network: Network, wallet: Address, seller: string, ts: number): void {
    this.db.prepare('INSERT INTO payments (network, wallet, seller, ts) VALUES (?, ?, ?, ?)').run(network, wallet.toLowerCase(), seller, ts);
    this.db.prepare('UPDATE verdicts SET paid = 1 WHERE network = ? AND wallet = ?').run(network, wallet.toLowerCase());
  }

  /** A settled payment at a seller, with what the seller decided: the price, the tier, the operator. */
  addClaim(c: Claim): void {
    this.db
      .prepare('INSERT INTO claims (network, wallet, seller, ns, promo, amount, tier, operator, promo_left, tx, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.network, c.wallet.toLowerCase(), c.seller, c.ns ?? null, c.promo ? 1 : 0, c.amount ?? null, c.tier ?? null, c.operator ?? null, c.promoLeft ?? null, c.tx ?? null, c.ts);
  }

  /** Newest first. `ns` filters to one promo namespace (for example "seller-a:live"). */
  recentClaims(network: Network, limit: number, ns?: string): Claim[] {
    const rows = this.db
      .prepare(`SELECT * FROM claims WHERE network = ? ${ns ? 'AND ns = ?' : ''} ORDER BY id DESC LIMIT ?`)
      .all(...(ns ? [network, ns, limit] : [network, limit])) as Record<string, unknown>[];
    return rows.map((r) => ({
      network: r.network as Network,
      wallet: r.wallet as Address,
      seller: r.seller as string,
      ...(r.ns ? { ns: r.ns as string } : {}),
      promo: r.promo === 1,
      ...(r.amount ? { amount: r.amount as string } : {}),
      ...(r.tier ? { tier: r.tier as string } : {}),
      ...(r.operator ? { operator: r.operator as string } : {}),
      ...(r.promo_left != null ? { promoLeft: r.promo_left as number } : {}),
      ...(r.tx ? { tx: r.tx as string } : {}),
      ts: r.ts as number,
    }));
  }

  hasPaid(network: Network, wallet: Address): boolean {
    return !!this.db.prepare('SELECT 1 FROM payments WHERE network = ? AND wallet = ? LIMIT 1').get(network, wallet.toLowerCase());
  }

  /** Paid wallets whose current verdict differs from what is on-chain. */
  pendingPublish(network: Network): VerdictRecord[] {
    const rows = this.db
      .prepare('SELECT json, published_key FROM verdicts WHERE network = ? AND paid = 1')
      .all(network) as { json: string; published_key: string | null }[];
    return rows
      .map((r) => ({ v: JSON.parse(r.json) as VerdictRecord, published: r.published_key }))
      .filter(({ v, published }) => v.tier !== 0 && publishKey(v) !== published)
      .map(({ v }) => ({ ...v, paid: true }));
  }

  /** Verdicts of wallets that paid a seller, for the dashboard. */
  paidVerdicts(network: Network): VerdictRecord[] {
    const rows = this.db
      .prepare('SELECT json, attestation_tx FROM verdicts WHERE network = ? AND paid = 1')
      .all(network) as { json: string; attestation_tx: string | null }[];
    return rows.map((r) => ({ ...(JSON.parse(r.json) as VerdictRecord), paid: true, ...(r.attestation_tx ? { attestationTx: r.attestation_tx as Hex } : {}) }));
  }

  markPublished(network: Network, wallets: VerdictRecord[], tx: Hex): void {
    const stmt = this.db.prepare('UPDATE verdicts SET published_key = ?, attestation_tx = ? WHERE network = ? AND wallet = ?');
    for (const v of wallets) stmt.run(publishKey(v), tx, network, v.wallet.toLowerCase());
  }

  saveEvidence(hash: Hex, json: string): void {
    this.db.prepare('INSERT OR IGNORE INTO evidence (hash, json) VALUES (?, ?)').run(hash, json);
  }

  getEvidence(hash: string): unknown | undefined {
    const row = this.db.prepare('SELECT json FROM evidence WHERE hash = ?').get(hash.toLowerCase()) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }

  addCost(provider: string, network: Network, calls: number, usd: number, ts: number): void {
    this.db.prepare('INSERT INTO costs (provider, network, calls, usd, ts) VALUES (?, ?, ?, ?, ?)').run(provider, network, calls, usd, ts);
  }

  costs(): { provider: string; network: string; calls: number; usd: number }[] {
    return this.db
      .prepare('SELECT provider, network, SUM(calls) AS calls, SUM(usd) AS usd FROM costs GROUP BY provider, network')
      .all() as { provider: string; network: string; calls: number; usd: number }[];
  }
}

/** A verdict is re-published when any field that goes on-chain changes. */
const publishKey = (v: VerdictRecord) => `${v.tier}:${v.operatorId}:${v.groupSize}:${v.evidenceHash}`;

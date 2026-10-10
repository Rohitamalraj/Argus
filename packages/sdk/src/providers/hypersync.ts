import type { Address, Hex, Transfer } from '@argus/scoring';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a: string) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const unpad = (t: string) => ('0x' + t.slice(-40)) as Address;

interface RawLog {
  block_number: number;
  log_index: number;
  transaction_hash: Hex;
  topic0?: string | null;
  topic1: string;
  topic2: string;
  topic3?: string | null;
  data: Hex;
}
interface RawTx {
  block_number: number;
  hash: Hex;
  from: string | null;
  to: string | null;
  value?: string | null;
  status?: number | string | null;
  contract_address?: string | null;
}
interface RawResponse {
  data: Array<{ logs?: RawLog[]; transactions?: RawTx[]; blocks?: Array<{ number: number; timestamp: string }> }>;
  archive_height: number;
  next_block: number;
}

/** An event log with its block time, topics in order (topic0 first). */
export interface ChainLog {
  blockNumber: number;
  logIndex: number;
  txHash: Hex;
  timestamp: number;
  topics: Hex[];
  data: Hex;
}

/**
 * What the analysis code needs from a chain data source. HyperSync implements it;
 * tests use a fake, and an RPC-based reader can implement it too.
 */
export interface ChainReader {
  /** Queries made so far (retries not counted). */
  readonly calls: number;
  /** Native-asset (MON) transfers matching any selection: direct value transfers only. */
  nativeTransfers(selections: { from?: Address[]; to?: Address[] }[], maxTransfers?: number): Promise<Transfer[]>;
  /** Event logs of one contract whose topics match (each position is an OR list; omit a position for any). */
  rawLogs(address: Address, topics: Hex[][], startBlock?: number): Promise<ChainLog[]>;
  /** Who created each contract, when it was created by a plain transaction (not through a factory). Optional. */
  contractCreators?(addresses: Address[]): Promise<Map<Address, { creator: Address; timestamp: number }>>;
}

export interface TransferQuery {
  from?: Address[];
  to?: Address[];
  fromBlock?: number;
  /** Stop paging once this many transfers are collected (hub short-circuit). */
  maxTransfers?: number;
  /**
   * Stop paging as soon as this returns true. Blocks arrive oldest first, so a caller that only needs the earliest
   * matching transfers (a first funder) can stop once it has them instead of reading a busy wallet's whole history.
   */
  stop?: (soFar: Transfer[]) => boolean;
}

/** Minimal HyperSync JSON client: ERC-20 Transfer logs of one token, native transfers, and raw contract logs. */
export class HyperSyncClient implements ChainReader {
  calls = 0;
  constructor(
    private readonly url: string,
    private readonly token: Address,
    private readonly apiToken: string,
    /** First block with a USDC transfer; nothing earlier needs scanning. */
    private readonly startBlock = 0,
  ) {}

  /** Direct native-asset transfers (successful transactions with a value). Internal transfers are not visible. */
  async nativeTransfers(selections: { from?: Address[]; to?: Address[] }[], maxTransfers?: number): Promise<Transfer[]> {
    const transactions = selections.map((s) => ({ ...(s.from?.length ? { from: s.from } : {}), ...(s.to?.length ? { to: s.to } : {}) }));
    const out: Transfer[] = [];
    let fromBlock = 0;
    for (;;) {
      const res = await this.query({
        from_block: fromBlock,
        transactions,
        field_selection: { transaction: ['block_number', 'hash', 'from', 'to', 'value', 'status'], block: ['number', 'timestamp'] },
      });
      const ts = new Map<number, number>();
      for (const page of res.data) for (const b of page.blocks ?? []) ts.set(b.number, Number(BigInt(b.timestamp)));
      for (const page of res.data) {
        for (const t of page.transactions ?? []) {
          const value = BigInt(t.value ?? '0x0');
          if (value === 0n || !t.from || !t.to) continue;
          if (t.status !== undefined && t.status !== null && Number(t.status) !== 1) continue; // failed transaction
          out.push({ from: t.from.toLowerCase() as Address, to: t.to.toLowerCase() as Address, amount: value, timestamp: ts.get(t.block_number) ?? 0, txHash: t.hash });
        }
      }
      if (maxTransfers && out.length >= maxTransfers) break;
      if (res.next_block > res.archive_height || res.next_block <= fromBlock) break;
      fromBlock = res.next_block;
    }
    return out;
  }

  /** The deploying account of each contract created by a direct deployment transaction. Factory-made contracts are not found. */
  async contractCreators(addresses: Address[]): Promise<Map<Address, { creator: Address; timestamp: number }>> {
    const out = new Map<Address, { creator: Address; timestamp: number }>();
    if (addresses.length === 0) return out;
    let fromBlock = 0;
    for (;;) {
      const res = await this.query({
        from_block: fromBlock,
        transactions: [{ contract_address: addresses }],
        field_selection: { transaction: ['block_number', 'from', 'contract_address', 'status'], block: ['number', 'timestamp'] },
      });
      const ts = new Map<number, number>();
      for (const page of res.data) for (const b of page.blocks ?? []) ts.set(b.number, Number(BigInt(b.timestamp)));
      for (const page of res.data) {
        for (const t of page.transactions ?? []) {
          if (!t.from || !t.contract_address) continue;
          out.set(t.contract_address.toLowerCase() as Address, { creator: t.from.toLowerCase() as Address, timestamp: ts.get(t.block_number) ?? 0 });
        }
      }
      if (res.next_block > res.archive_height || res.next_block <= fromBlock) break;
      fromBlock = res.next_block;
    }
    return out;
  }

  async rawLogs(address: Address, topics: Hex[][], startBlock = 0): Promise<ChainLog[]> {
    const out: ChainLog[] = [];
    let fromBlock = startBlock;
    for (;;) {
      const res = await this.query({
        from_block: fromBlock,
        logs: [{ address: [address], topics }],
        field_selection: {
          log: ['block_number', 'log_index', 'transaction_hash', 'topic0', 'topic1', 'topic2', 'topic3', 'data'],
          block: ['number', 'timestamp'],
        },
      });
      const ts = new Map<number, number>();
      for (const page of res.data) for (const b of page.blocks ?? []) ts.set(b.number, Number(BigInt(b.timestamp)));
      for (const page of res.data) {
        for (const l of page.logs ?? []) {
          out.push({
            blockNumber: l.block_number,
            logIndex: l.log_index,
            txHash: l.transaction_hash,
            timestamp: ts.get(l.block_number) ?? 0,
            topics: [l.topic0, l.topic1, l.topic2, l.topic3].filter((t): t is string => !!t) as Hex[],
            data: l.data,
          });
        }
      }
      if (res.next_block > res.archive_height || res.next_block <= fromBlock) break;
      fromBlock = res.next_block;
    }
    return out;
  }

  async transfers(q: TransferQuery): Promise<Transfer[]> {
    return this.transfersAny([q], q.maxTransfers, q.fromBlock, q.stop);
  }

  /** Transfers matching any of the selections, in one paged query (one rate-limit unit per page). */
  async transfersAny(selections: Omit<TransferQuery, 'fromBlock' | 'maxTransfers' | 'stop'>[], maxTransfers?: number, startBlock?: number, stop?: (soFar: Transfer[]) => boolean): Promise<Transfer[]> {
    const logs = selections.map((s) => ({
      address: [this.token],
      topics: [[TRANSFER_TOPIC], (s.from ?? []).map(pad), (s.to ?? []).map(pad)],
    }));
    const out: Transfer[] = [];
    let fromBlock = startBlock ?? this.startBlock;
    for (;;) {
      const res = await this.query({
        from_block: fromBlock,
        logs,
        field_selection: {
          log: ['block_number', 'log_index', 'transaction_hash', 'topic1', 'topic2', 'data'],
          block: ['number', 'timestamp'],
        },
      });
      const ts = new Map<number, number>();
      for (const page of res.data) for (const b of page.blocks ?? []) ts.set(b.number, Number(BigInt(b.timestamp)));
      for (const page of res.data) {
        for (const l of page.logs ?? []) {
          out.push({
            from: unpad(l.topic1),
            to: unpad(l.topic2),
            amount: BigInt(l.data),
            timestamp: ts.get(l.block_number) ?? 0,
            txHash: l.transaction_hash,
          });
        }
      }
      if (maxTransfers && out.length >= maxTransfers) break;
      if (stop?.(out)) break;
      if (res.next_block > res.archive_height || res.next_block <= fromBlock) break;
      fromBlock = res.next_block;
    }
    return out;
  }

  private async query(body: unknown, attempts = 6): Promise<RawResponse> {
    const debug = typeof process !== 'undefined' && !!process.env.ARGUS_DEBUG;
    for (let attempt = 1; ; attempt++) {
      const t0 = Date.now();
      const r = await fetch(`${this.url}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (debug) console.error(`[hypersync] ${r.status} ${Date.now() - t0} ms ${JSON.stringify(body).slice(0, 90)}`);
      if (r.ok) {
        this.calls++;
        const json = (await r.json()) as RawResponse;
        if (debug) console.error(`[hypersync]   -> next_block ${json.next_block} of ${json.archive_height}`);
        return json;
      }
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || attempt >= attempts) {
        throw new Error(`HyperSync ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
      // Free tier: 15,000 cost units per 60 s window, ~1,000 per query. Wait for the window to reset.
      const reset = Number(r.headers.get('x-ratelimit-reset') ?? r.headers.get('retry-after'));
      const waitMs = reset > 0 ? reset * 1000 + 250 : Math.min(1000 * 2 ** (attempt - 1), 16_000);
      await new Promise((res) => setTimeout(res, waitMs));
    }
  }
}

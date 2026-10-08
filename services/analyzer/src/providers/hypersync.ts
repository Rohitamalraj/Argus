import type { Address, Hex, Transfer } from '@argus/scoring';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a: string) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const unpad = (t: string) => ('0x' + t.slice(-40)) as Address;

interface RawLog {
  block_number: number;
  log_index: number;
  transaction_hash: Hex;
  topic1: string;
  topic2: string;
  data: Hex;
}
interface RawResponse {
  data: Array<{ logs?: RawLog[]; blocks?: Array<{ number: number; timestamp: string }> }>;
  archive_height: number;
  next_block: number;
}

export interface TransferQuery {
  from?: Address[];
  to?: Address[];
  fromBlock?: number;
  /** Stop paging once this many transfers are collected (hub short-circuit). */
  maxTransfers?: number;
}

/** Minimal HyperSync JSON client for ERC-20 Transfer logs of one token. */
export class HyperSyncClient {
  calls = 0;
  constructor(
    private readonly url: string,
    private readonly token: Address,
    private readonly apiToken: string,
  ) {}

  async transfers(q: TransferQuery): Promise<Transfer[]> {
    const topics: string[][] = [[TRANSFER_TOPIC], (q.from ?? []).map(pad), (q.to ?? []).map(pad)];
    const out: Transfer[] = [];
    let fromBlock = q.fromBlock ?? 0;
    for (;;) {
      const res = await this.query({
        from_block: fromBlock,
        logs: [{ address: [this.token], topics }],
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
      if (q.maxTransfers && out.length >= q.maxTransfers) break;
      if (res.next_block > res.archive_height || res.next_block <= fromBlock) break;
      fromBlock = res.next_block;
    }
    return out;
  }

  private async query(body: unknown, attempts = 6): Promise<RawResponse> {
    for (let attempt = 1; ; attempt++) {
      this.calls++;
      const r = await fetch(`${this.url}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (r.ok) return (await r.json()) as RawResponse;
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

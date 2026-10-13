'use client';

import { useCallback, useEffect, useState } from 'react';
import { Footer, Nav } from '@/components/chrome';
import { ANALYZER_URL, explorer, short, tierClass } from '@/lib/api';

/**
 * A real seller on Monad testnet. The API behind this page is the Argus demo seller (apps/seller-demo): an Express
 * app with the argus-x402-middleware, charging over x402. Nothing here is mocked: quotes come from the middleware
 * (verdict, promo counter), and every row in the feed is a payment that settled on-chain.
 */
const SELLER = `${ANALYZER_URL}/seller`;
const NS = 'seller-a:live';
const DEMO_WALLETS = [
  { label: 'Wallet A', address: '0x8E42867836402110Cd005f5e39c182BBce59045e' },
  { label: 'Wallet B', address: '0x2a297E336C07fCf284f1DB57896d6cEca9557af7' },
  { label: 'Wallet C', address: '0xD1FE0a30cfCe1975659808fDEc15E01aF960c08d' },
];

interface Info {
  seller: string;
  price: { standard: string; promo: string };
  promoCalls: number;
  payTo: string;
}
interface Quote {
  payer: string;
  tierName: string;
  price: 'promo' | 'standard';
  priceUsd: string;
  standardUsd: string;
  promoLeft: number;
  promoCalls: number;
  operatorId?: string;
  reasons: string[];
  verdictSource?: string;
}
interface Claim {
  wallet: string;
  promo: boolean;
  amount?: string;
  tier?: string;
  operator?: string;
  promoLeft?: number;
  tx?: string;
  ts: number;
}
interface OperatorUse {
  operator: string;
  tier: string;
  promoUsed: number;
  standardPaid: number;
  wallets: string[];
}

const usd = (units?: string) => (units ? `$${(Number(units) / 1e6).toFixed(3)}` : '');
const Chip = ({ tier }: { tier: string }) => (
  <span className={`chip ${tierClass(tier)}`}>
    <span className="chip-dot" />
    {tier}
  </span>
);

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
const ago = (ts: number, now: number) => {
  const s = Math.max(0, Math.round(now / 1000 - ts));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

export default function Store() {
  const now = useNow();
  const [info, setInfo] = useState<Info | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [ops, setOps] = useState<OperatorUse[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [payer, setPayer] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);

  const [buy, setBuy] = useState<{ busy: boolean; msg?: string; ok?: boolean; data?: unknown }>({ busy: false });

  useEffect(() => {
    fetch(`${SELLER}/api/info`)
      .then((r) => r.json())
      .then(setInfo)
      .catch((e: Error) => setErr(e.message));
  }, []);

  const loadClaims = useCallback(() => {
    fetch(`${ANALYZER_URL}/v1/claims?network=testnet&ns=${encodeURIComponent(NS)}&limit=40`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b: { claims: Claim[]; operators: OperatorUse[] }) => {
        setClaims(b.claims);
        setOps(b.operators);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => {
    loadClaims();
    const t = setInterval(loadClaims, 3000);
    return () => clearInterval(t);
  }, [loadClaims]);

  async function getQuote(address = payer) {
    const a = address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return void setQuoteErr('Enter a wallet address (0x…, 42 characters).');
    setQuoting(true);
    setQuoteErr(null);
    try {
      const r = await fetch(`${SELLER}/api/quote?payer=${a}`, { cache: 'no-store' });
      const b = (await r.json()) as Quote & { error?: string };
      if (!r.ok) throw new Error(b.error ?? `seller ${r.status}`);
      setQuote(b);
    } catch (e) {
      setQuote(null);
      setQuoteErr((e as Error).message);
    } finally {
      setQuoting(false);
    }
  }

  /** Pay the seller from the visitor's own browser wallet, over x402 on Monad testnet. */
  async function buyWithWallet() {
    setBuy({ busy: true, msg: 'Waiting for your wallet…' });
    try {
      const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!eth) throw new Error('No browser wallet found. Install one (for example MetaMask) and switch to Monad testnet.');
      const [addr] = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] });
      } catch {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: '0x279f', chainName: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: ['https://testnet-rpc.monad.xyz'], blockExplorerUrls: ['https://testnet.monadvision.com'] }],
        });
      }
      setPayer(addr!);
      setBuy({ busy: true, msg: 'Sign the payment in your wallet…' });
      const [{ createWalletClient, custom }, { ExactEvmScheme }, { wrapFetchWithPaymentFromConfig }] = await Promise.all([import('viem'), import('@x402/evm'), import('@x402/fetch')]);
      const wc = createWalletClient({ account: addr as `0x${string}`, transport: custom(eth as never) });
      const signer = { address: addr as `0x${string}`, signTypedData: (m: never) => wc.signTypedData({ account: addr as `0x${string}`, ...(m as object) } as never) };
      const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: 'eip155:10143', client: new ExactEvmScheme(signer as never) }] });
      const res = await pay(`${SELLER}/api/premium`, { headers: { 'x-payer-address': addr! } });
      const body = (await res.json().catch(() => ({}))) as { argus?: { price: string; tierName: string } };
      if (!res.ok) throw new Error(res.status === 402 ? 'Payment was not accepted. This wallet needs testnet USDC on Monad testnet.' : `Seller answered ${res.status}`);
      setBuy({ busy: false, ok: true, msg: `Paid at the ${body.argus?.price} price as ${body.argus?.tierName}. It appears in the live feed below.`, data: body });
      loadClaims();
      getQuote(addr!);
    } catch (e) {
      setBuy({ busy: false, ok: false, msg: (e as Error).message });
    }
  }

  const limit = info?.promoCalls ?? 20;
  const wallets = new Set(claims.map((c) => c.wallet));
  const promoClaims = claims.filter((c) => c.promo).length;

  return (
    <>
      <Nav active="store" />
      <main className="container">
        <div className="dash-head">
          <div>
            <p className="eyebrow">Demo store · Monad testnet</p>
            <h1>A real seller, protected by Argus</h1>
          </div>
        </div>

        <p className="muted" style={{ maxWidth: 780, margin: '0 0 18px' }}>
          This store sells a paid API over x402 and runs the <span className="mono">argus-x402-middleware</span>. Every wallet that pays gets a price from its
          verdict: a seller&apos;s promo is shared by all wallets one operator controls, so ten wallets from one funder cannot claim ten promos. Nothing on this
          page is mocked: quotes come from the live middleware and every claim below is a payment that settled on Monad testnet.
        </p>

        {err && (
          <div className="card" style={{ marginBottom: 12, background: 'var(--error-bg)', color: 'var(--error)' }}>
            <span className="mono small">The store backend is not reachable ({err}).</span>
          </div>
        )}

        <div className="stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat">
            <div className="v">{claims.length ? wallets.size : '–'}</div>
            <div className="k">paying wallets</div>
          </div>
          <div className="stat accent">
            <div className="v">{claims.length ? ops.length : '–'}</div>
            <div className="k">real customers (operators)</div>
          </div>
          <div className="stat">
            <div className="v" style={{ color: 'var(--tier-linked)' }}>{claims.length ? promoClaims : '–'}</div>
            <div className="k">promo calls settled</div>
          </div>
          <div className="stat">
            <div className="v">{info ? `${info.price.promo}` : '–'}</div>
            <div className="k">promo price · standard {info?.price.standard ?? '–'}</div>
          </div>
        </div>

        <div className="dash-grid">
          <div className="card card-solid">
            <div className="panel-title">
              <h3>Product: Monad market signal API</h3>
              <span className="mono small muted">GET /api/premium</span>
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>
              Standard price {info?.price.standard ?? '…'} per call. A promo price of {info?.price.promo ?? '…'} applies to the first {limit} calls of each
              operator, shared across all of that operator&apos;s wallets. The seller added this with one middleware line.
            </p>
            <pre className="code" style={{ margin: '12px 0 0' }}>
              {`app.use(argus({
  network: 'testnet', payTo: SELLER,
  price: { standard: '$0.002', promo: '$0.001' },
  routes: ['GET /api/premium'],
  policy: { promoCalls: ${limit}, promoPerOperator: true },
}));`}
            </pre>
          </div>

          <div className="card card-solid">
            <div className="panel-title">
              <h3>What would this wallet pay?</h3>
              <span className="mono small muted">live quote from the seller</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && getQuote()}
                placeholder="0x… wallet address"
                className="mono"
                style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--line-2)', borderRadius: 10, background: '#fff', fontSize: 13 }}
                aria-label="Wallet address"
              />
              <button className="btn btn-dark" onClick={() => getQuote()} disabled={quoting}>
                {quoting ? 'Checking…' : 'Get quote'} <span className="chev">›</span>
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {DEMO_WALLETS.map((w) => (
                <button
                  key={w.address}
                  className="chip"
                  style={{ cursor: 'pointer', border: 0 }}
                  onClick={() => {
                    setPayer(w.address);
                    getQuote(w.address);
                  }}
                >
                  {w.label} · {short(w.address)}
                </button>
              ))}
            </div>
            {quoteErr && <p className="small" style={{ color: 'var(--error)', marginBottom: 0 }}>{quoteErr}</p>}
            {quote && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.03em', color: quote.price === 'promo' ? 'var(--tier-independent)' : 'var(--ink)' }}>{quote.priceUsd}</span>
                  <span className="mono small muted">{quote.price === 'promo' ? `promo (standard ${quote.standardUsd})` : 'standard price'}</span>
                  <Chip tier={quote.tierName} />
                </div>
                <p className="small" style={{ margin: '8px 0 0' }}>
                  {quote.reasons.at(-1)} · {quote.promoLeft} of {quote.promoCalls} promo calls left for this operator
                </p>
                <p className="mono small muted" style={{ margin: '6px 0 0' }}>
                  verdict from the {quote.verdictSource ?? 'analyzer'}{quote.operatorId ? ` · operator ${short(quote.operatorId, 5)}` : ''}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="card card-solid" style={{ marginTop: 12 }}>
          <div className="panel-title">
            <h3>Buy with your own wallet</h3>
            <span className="mono small muted">real x402 payment on Monad testnet</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-dark" onClick={buyWithWallet} disabled={buy.busy}>
              {buy.busy ? 'Working…' : 'Connect wallet and buy'} <span className="chev">›</span>
            </button>
            <span className="small muted" style={{ maxWidth: 640 }}>
              Needs a browser wallet with a little testnet USDC on Monad testnet. You sign a gasless payment authorization; the seller quotes you from your
              verdict. Without a wallet you can still get a quote above and watch real claims arrive below.
            </span>
          </div>
          {buy.msg && <p className="small" style={{ margin: '10px 0 0', color: buy.ok === false ? 'var(--error)' : buy.ok ? 'var(--tier-independent)' : 'var(--ink-3)' }}>{buy.msg}</p>}
        </div>

        <div className="card card-solid" style={{ marginTop: 12 }}>
          <div className="panel-title">
            <h3>Promo allowance by operator</h3>
            <span className="mono small muted">{limit} promo calls per operator, shared by its wallets</span>
          </div>
          {ops.length === 0 ? (
            <div className="empty">No claims yet. Payments appear here as they settle.</div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {ops.map((o) => {
                const pct = Math.min(100, (o.promoUsed / limit) * 100);
                return (
                  <div key={o.operator}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <Chip tier={o.tier} />
                      <strong>{o.wallets.length === 1 ? '1 wallet' : `${o.wallets.length} wallets`}</strong>
                      <span className="mono small muted">operator {short(o.operator, 5)} · {o.promoUsed} of {limit} promo calls used{o.standardPaid ? ` · ${o.standardPaid} at standard price` : ''}</span>
                    </div>
                    <div style={{ height: 12, borderRadius: 6, background: 'rgba(0,0,0,0.07)', margin: '8px 0 6px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: o.tier === 'Linked' ? 'var(--tier-linked)' : 'var(--tier-independent)', transition: 'width 600ms ease' }} />
                    </div>
                    <div className="mono small muted" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {o.wallets.map((w) => (
                        <span key={w}>{short(w)}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card card-solid" style={{ marginTop: 12, marginBottom: 40 }}>
          <div className="panel-title">
            <h3>Live claims</h3>
            <span className="mono small muted">settled payments, newest first</span>
          </div>
          {claims.length === 0 ? (
            <div className="empty">Nothing has been bought yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Wallet</th>
                    <th>Tier</th>
                    <th>Paid</th>
                    <th>Promo left</th>
                    <th>Settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c, i) => (
                    <tr key={`${c.tx ?? c.wallet}-${i}`}>
                      <td className="mono small">{ago(c.ts, now)}</td>
                      <td className="mono small">{short(c.wallet)}</td>
                      <td>{c.tier ? <Chip tier={c.tier} /> : '–'}</td>
                      <td className="mono small">
                        {usd(c.amount)} <span className="muted">{c.promo ? 'promo' : 'standard'}</span>
                      </td>
                      <td className="mono small">{c.promo && c.promoLeft != null ? c.promoLeft : '–'}</td>
                      <td className="mono small">
                        {c.tx ? (
                          <a href={`${explorer('testnet')}/tx/${c.tx}`} target="_blank" rel="noreferrer">
                            {short(c.tx, 5)} ↗
                          </a>
                        ) : (
                          '–'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

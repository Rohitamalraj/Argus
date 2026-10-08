'use client';

import { useCallback, useEffect, useState } from 'react';
import { Footer, Nav } from '@/components/chrome';
import { GroupGraph } from '@/components/group-graph';
import { ANALYZER_URL, explorer, getOverview, short, tierClass, type Network, type Overview, type Verdict } from '@/lib/api';

interface SimResult {
  ok: boolean;
  namespace?: string;
  log?: string[];
  error?: string;
}

export default function Dashboard() {
  const [network, setNetwork] = useState<Network>('testnet');
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | undefined>();
  const [sim, setSim] = useState<{ running: boolean; result?: SimResult }>({ running: false });

  const load = useCallback(() => {
    getOverview(network)
      .then((x) => {
        setO(x);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [network]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function runSim() {
    setSim({ running: true });
    try {
      const r = await fetch(`${ANALYZER_URL}/v1/sim/run`, { method: 'POST' });
      const body = (await r.json()) as SimResult;
      setSim({ running: false, result: r.ok ? body : { ok: false, error: body.error ?? `HTTP ${r.status}` } });
      load();
    } catch (e) {
      setSim({ running: false, result: { ok: false, error: (e as Error).message } });
    }
  }

  const selected: Verdict | undefined = o?.wallets.find((w) => w.wallet === sel);
  const hs = o?.costs.find((c) => c.provider === 'envio-hypersync');
  const nansen = o?.costs.find((c) => c.provider === 'nansen');

  return (
    <>
      <Nav active="dashboard" />
      <main className="container">
        <div className="dash-head">
          <div>
            <p className="eyebrow">Seller dashboard</p>
            <h1>Customers, not wallets</h1>
          </div>
          <div className="toggle" role="tablist" aria-label="Network">
            {(['testnet', 'mainnet'] as const).map((n) => (
              <button key={n} className={network === n ? 'on' : ''} onClick={() => (setNetwork(n), setSel(undefined))} role="tab" aria-selected={network === n}>
                Monad {n}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="card" style={{ marginBottom: 12, background: 'var(--error-bg)', color: 'var(--error)' }}>
            <span className="mono small">Analyzer not reachable at {ANALYZER_URL} ({err}). Start it with: npm run dev -w @argus/analyzer</span>
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <div className="v">{o?.counts.rawWallets ?? '–'}</div>
            <div className="k">paying wallets</div>
          </div>
          <div className="stat accent">
            <div className="v">{o?.counts.customers ?? '–'}</div>
            <div className="k">real customers</div>
          </div>
          <div className="stat">
            <div className="v" style={{ color: 'var(--tier-linked)' }}>
              {o?.counts.linked ?? '–'}
            </div>
            <div className="k">linked wallets · {o?.counts.operators ?? 0} operator(s)</div>
          </div>
          <div className="stat">
            <div className="v" style={{ color: 'var(--tier-independent)' }}>
              {o?.counts.independent ?? '–'}
            </div>
            <div className="k">independent</div>
          </div>
          <div className="stat">
            <div className="v" style={{ color: 'var(--tier-unclear)' }}>
              {o?.counts.unclear ?? '–'}
            </div>
            <div className="k">unclear</div>
          </div>
        </div>

        <div className="card card-solid" style={{ marginTop: 12 }}>
          <div className="panel-title">
            <h3>Funding groups</h3>
            <span className="mono small muted">funder → wallets it seeded · click a wallet</span>
          </div>
          {o && o.operators.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <GroupGraph overview={o} selected={sel} onSelect={setSel} />
            </div>
          ) : (
            <div className="empty">No paying wallets yet on {network}. Run the simulation below.</div>
          )}
        </div>

        <div className="dash-grid">
          <div className="card card-solid">
            <div className="panel-title">
              <h3>Paying wallets</h3>
              <span className="mono small muted">{o?.wallets.length ?? 0} seen</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Tier</th>
                    <th>Group</th>
                    <th>Confidence</th>
                    <th>On-chain</th>
                  </tr>
                </thead>
                <tbody>
                  {(o?.wallets ?? [])
                    .slice()
                    .sort((a, b) => a.tier - b.tier || a.operatorId.localeCompare(b.operatorId))
                    .map((w) => (
                      <tr key={w.wallet} className={`clickable ${sel === w.wallet ? 'selected' : ''}`} onClick={() => setSel(w.wallet)}>
                        <td className="mono">{short(w.wallet)}</td>
                        <td>
                          <span className={`chip ${tierClass(w.tierName)}`}>
                            <span className="chip-dot" />
                            {w.tierName}
                          </span>
                        </td>
                        <td className="mono">{w.groupSize}</td>
                        <td className="mono">{w.confidence}</td>
                        <td className="mono small">
                          {w.attestationTx ? (
                            <a href={`${explorer(network)}/tx/${w.attestationTx}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>
                              published ↗
                            </a>
                          ) : (
                            <span className="muted">pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <div className="card card-solid">
              <div className="panel-title">
                <h3>Why this verdict</h3>
                {selected && (
                  <span className={`chip ${tierClass(selected.tierName)}`}>
                    <span className="chip-dot" />
                    {selected.tierName}
                  </span>
                )}
              </div>
              {selected ? (
                <>
                  <ul className="reasons">
                    {selected.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <dl className="kv">
                    <dt>wallet</dt>
                    <dd>{selected.wallet}</dd>
                    <dt>first funder</dt>
                    <dd>{selected.firstFunder ?? '—'}</dd>
                    <dt>operator</dt>
                    <dd>{short(selected.operatorId, 8)}</dd>
                    <dt>evidence</dt>
                    <dd>
                      <a href={`${ANALYZER_URL}/v1/evidence/${selected.evidenceHash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>
                        {short(selected.evidenceHash, 8)} ↗
                      </a>
                    </dd>
                    <dt>expires</dt>
                    <dd>{new Date(selected.expiresAt * 1000).toLocaleString()}</dd>
                  </dl>
                </>
              ) : (
                <p className="mono small muted">Select a wallet in the graph or the table.</p>
              )}
            </div>

            <div className="card card-solid">
              <div className="panel-title">
                <h3>Cost</h3>
                <span className="mono small muted">this network</span>
              </div>
              <dl className="kv" style={{ marginTop: 0 }}>
                <dt>HyperSync</dt>
                <dd>{hs?.calls ?? 0} queries · free</dd>
                <dt>Nansen</dt>
                <dd>
                  {nansen?.calls ?? 0} calls · ${(nansen?.usd ?? 0).toFixed(2)}
                </dd>
              </dl>
              {network === 'mainnet' && <p className="powered" style={{ marginTop: 12 }}>Deep checks: Powered by Nansen API</p>}
            </div>

            <div className="card card-solid" id="simulate">
              <div className="panel-title">
                <h3>Run the simulation</h3>
                <span className="mono small muted">testnet · no keys needed</span>
              </div>
              <p className="mono small" style={{ color: 'var(--ink-2)', margin: 0 }}>
                13 pre-funded wallets (one funder&apos;s fleet of 10 and 3 independents) pay the demo seller through x402 at 0.001 USDC per
                call. Watch 13 wallets become 4 customers.
              </p>
              <button className="btn btn-dark" style={{ marginTop: 14 }} onClick={runSim} disabled={sim.running || network !== 'testnet'}>
                {sim.running ? 'Running… (about 2 minutes)' : 'Run simulation'} <span className="chev">›</span>
              </button>
              {sim.result && (
                <div className="sim-log">
                  {sim.result.ok ? (sim.result.log ?? []).map((l, i) => <div key={i}>{l}</div>) : <div>Simulation failed: {sim.result.error}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <div style={{ height: 64 }} />
      <Footer />
    </>
  );
}

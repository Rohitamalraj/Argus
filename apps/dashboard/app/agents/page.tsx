'use client';

import { useEffect, useState } from 'react';
import { Footer, Nav } from '@/components/chrome';
import { getAgentReputation, short, type AgentReputation, type Network } from '@/lib/api';

/** Agents worth a look on Monad mainnet, from the ERC-8004 Reputation registry (checked 9 Oct 2026). */
const EXAMPLES: { id: string; note: string }[] = [
  { id: '182', note: '7,665 reviewers' },
  { id: '10182', note: '16 reviewers' },
  { id: '9', note: '1 reviewer' },
];

const n = (x: number) => x.toLocaleString('en-US');

export default function Agents() {
  const [network, setNetwork] = useState<Network>('mainnet');
  const [agentId, setAgentId] = useState('182');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<AgentReputation | null>(null);

  async function analyze(id = agentId, net: Network = network) {
    if (!/^\d+$/.test(id)) return setError('Enter the agent id, a number.');
    setBusy(true);
    setError(null);
    try {
      setR(await getAgentReputation(id, net));
      window.history.replaceState(null, '', `/agents?agent=${id}&network=${net}`);
    } catch (e) {
      setR(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A shared link like /agents?agent=182 runs the analysis on load.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get('agent');
    if (!id) return;
    const net: Network = q.get('network') === 'testnet' ? 'testnet' : 'mainnet';
    setAgentId(id);
    setNetwork(net);
    void analyze(id, net);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reviewers = r?.raw.distinctClients ?? 0;
  const traced = r?.sampled?.analyzed ?? reviewers;

  return (
    <>
      <Nav active="agents" />
      <main className="container">
        <div className="dash-head">
          <div>
            <p className="eyebrow">ERC-8004 reputation</p>
            <h1>Reviews, counted by operator</h1>
          </div>
          <div className="toggle" role="tablist" aria-label="Network">
            {(['mainnet', 'testnet'] as const).map((x) => (
              <button key={x} className={network === x ? 'on' : ''} onClick={() => (setNetwork(x), setR(null))} role="tab" aria-selected={network === x}>
                Monad {x}
              </button>
            ))}
          </div>
        </div>

        <p className="lede" style={{ maxWidth: '70ch', marginTop: -8 }}>
          The ERC-8004 spec warns that unfiltered feedback is open to Sybil attacks and expects third parties to supply the reviewer filter. Argus builds
          it from public chain data: reviewers first funded by the same funder are one operator.
        </p>

        <div className="card card-solid" style={{ marginTop: 16 }}>
          <form
            onSubmit={(e) => (e.preventDefault(), void analyze())}
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <label className="mono small muted" htmlFor="agent">
              agent id
            </label>
            <input
              id="agent"
              inputMode="numeric"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value.trim())}
              className="mono"
              style={{ border: '1px solid var(--line-2)', borderRadius: 8, padding: '10px 12px', fontSize: 15, width: 140, background: '#fff' }}
            />
            <button type="submit" className="btn btn-dark" disabled={busy}>
              {busy ? 'Tracing reviewers…' : 'Analyze'} <span className="chev">›</span>
            </button>
            <span className="mono small muted">try</span>
            {EXAMPLES.map((x) => (
              <button key={x.id} type="button" className="btn btn-light" onClick={() => (setAgentId(x.id), void analyze(x.id))} disabled={busy}>
                #{x.id} <span className="muted">{x.note}</span>
              </button>
            ))}
          </form>
          {busy && <p className="mono small muted" style={{ marginTop: 12 }}>Reading the feedback and tracing who funded each reviewer. Big agents take up to a minute.</p>}
          {error && <p className="mono small" style={{ color: 'var(--error)', marginTop: 12 }}>{error}</p>}
        </div>

        {r && r.raw.feedbackCount === 0 && (
          <div className="card card-solid" style={{ marginTop: 12 }}>
            <p className="mono small">Agent #{r.agentId} has no feedback on Monad {r.network}.</p>
          </div>
        )}

        {r && r.raw.feedbackCount > 0 && (
          <>
            <div className="card card-solid" style={{ marginTop: 12 }}>
              <div className="bignum" style={{ marginBottom: 8 }}>
                <div className="n">
                  {n(reviewers)}
                  <span className="label">reviewers · {n(r.raw.feedbackCount)} feedback entries</span>
                </div>
                <div className="arrow">→</div>
                <div className="n">
                  {n(r.independent.operators)}
                  <span className="label">
                    {r.independent.operators === 1 ? 'operator' : 'operators'}
                    {r.sampled ? ` (in a sample of ${n(traced)})` : ''}
                  </span>
                </div>
              </div>
              <p className="mono small" style={{ color: 'var(--ink-2)' }}>
                {r.independent.linkedOperators > 0
                  ? `One operator holds ${(r.largestOperatorShare * 100).toFixed(0)}% of ${r.sampled ? 'the sampled ' : ''}reviewers. `
                  : 'No reviewers share a funder strongly enough to link. '}
                Mean feedback value: {r.raw.meanValue?.toFixed(1) ?? 'n/a'} raw, {r.independent.meanValue?.toFixed(1) ?? 'n/a'} counting each operator once.
                {r.raw.implausibleValues > 0 && ` ${n(r.raw.implausibleValues)} entries have absurd values (beyond 1e15) and are left out of both means.`}
              </p>
            </div>

            <div className="dash-grid">
              <div className="card card-solid">
                <div className="panel-title">
                  <h3>Operators</h3>
                  <span className="mono small muted">largest first</span>
                </div>
                <div style={{ display: 'grid', gap: 14 }}>
                  {r.topOperators.slice(0, 6).map((op) => (
                    <div key={op.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className={`chip ${op.kind === 'linked' ? 'linked' : op.kind === 'independent' ? 'independent' : 'unclear'}`}>
                          <span className="chip-dot" />
                          {op.kind === 'linked' ? 'Linked fleet' : op.kind === 'independent' ? 'Independent' : 'Unattributed'}
                        </span>
                        <span className="mono small">{op.funder ? `funder ${short(op.funder)}` : short(op.id.replace('wallet:', ''))}</span>
                        <span className="mono small muted">
                          {n(op.clients)} reviewer{op.clients === 1 ? '' : 's'} · {n(op.feedbackCount)} feedback · {op.confidence}
                        </span>
                      </div>
                      <ul className="reasons">
                        {op.reasons.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {r.unattributed > 0 && (
                  <p className="mono small muted" style={{ marginTop: 12 }}>
                    {n(r.unattributed)} reviewers have no visible MON funding and are counted as independent.
                  </p>
                )}
              </div>

              <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
                <div className="card card-solid">
                  <div className="panel-title">
                    <h3>Use it in your contract</h3>
                  </div>
                  <p className="mono small" style={{ color: 'var(--ink-2)', margin: 0 }}>
                    Pass one reviewer per operator ({n(r.clientAllowlistSize)} address{r.clientAllowlistSize === 1 ? '' : 'es'}) as <code>clientAddresses</code> to the registry&apos;s <code>getSummary</code>{' '}
                    for a Sybil-filtered score.
                  </p>
                  <pre className="code" style={{ marginTop: 12, fontSize: 12 }}>
                    <span className="k">const</span> r = <span className="k">await</span> argus.agentReputation({r.agentId});{'\n'}
                    registry.getSummary({r.agentId}n, r.clientAllowlist, <span className="s">&quot;&quot;</span>, <span className="s">&quot;&quot;</span>);
                  </pre>
                </div>
                <div className="card card-solid">
                  <div className="panel-title">
                    <h3>How to read this</h3>
                  </div>
                  <p className="mono small" style={{ color: 'var(--ink-2)', margin: 0 }}>
                    Linked means reviewers were first funded by the same funder and show a second signal. It means shared funding, not wrongdoing.
                    {` ${n(r.hypersyncQueries)} chain queries, public data only.`}
                    {r.cached ? ' Cached result.' : ''}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
      <div style={{ height: 64 }} />
      <Footer />
    </>
  );
}

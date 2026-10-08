'use client';

import { useEffect, useState } from 'react';
import { explorer, short, type Network } from '@/lib/api';

export const ENVIO_GRAPHQL_URL = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? '';

interface EnvioData {
  SellerStats: { seller: string; paymentCount: number; distinctPayers: number; totalReceived: string }[];
  Operator: { operatorId: string; tierName: string; walletCount: number; linkedCount: number }[];
  SellerPayment: { payer: string; amount: string; ts: number; txHash: string }[];
}

const QUERY = `query Argus($chainId: Int!) {
  SellerStats(where: { chainId: { _eq: $chainId } }) { seller paymentCount distinctPayers totalReceived }
  Operator(where: { chainId: { _eq: $chainId }, walletCount: { _gt: 0 } }) { operatorId tierName walletCount linkedCount }
  SellerPayment(where: { chainId: { _eq: $chainId } }, order_by: { ts: desc }, limit: 8) { payer amount ts txHash }
}`;

/** DB-5: on-chain history from the Envio HyperIndex GraphQL API (registry events and seller payments). */
export function EnvioPanel({ network }: { network: Network }) {
  const [data, setData] = useState<EnvioData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ENVIO_GRAPHQL_URL) return;
    const chainId = network === 'mainnet' ? 143 : 10143;
    const load = () =>
      fetch(ENVIO_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { chainId } }),
      })
        .then((r) => r.json())
        .then((j: { data?: EnvioData; errors?: { message: string }[] }) => {
          if (j.errors?.length) throw new Error(j.errors[0]!.message);
          setData(j.data ?? null);
          setErr(null);
        })
        .catch((e: Error) => setErr(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [network]);

  const stats = data?.SellerStats.reduce(
    (a, s) => ({ payments: a.payments + s.paymentCount, payers: a.payers + s.distinctPayers, usdc: a.usdc + Number(s.totalReceived) / 1e6 }),
    { payments: 0, payers: 0, usdc: 0 },
  );
  const linkedOps = data?.Operator.filter((o) => o.linkedCount > 0) ?? [];

  return (
    <div className="card card-solid">
      <div className="panel-title">
        <h3>On-chain activity</h3>
        <span className="mono small muted">indexed by Envio HyperIndex</span>
      </div>
      {!ENVIO_GRAPHQL_URL ? (
        <p className="mono small muted">Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to the deployed indexer&apos;s GraphQL endpoint.</p>
      ) : err ? (
        <p className="mono small" style={{ color: 'var(--error)' }}>Indexer not reachable: {err}</p>
      ) : !data ? (
        <p className="mono small muted">Loading…</p>
      ) : (
        <>
          <dl className="kv" style={{ marginTop: 0 }}>
            <dt>payments</dt>
            <dd>
              {stats?.payments ?? 0} from {stats?.payers ?? 0} wallets · {(stats?.usdc ?? 0).toFixed(3)} USDC
            </dd>
            <dt>operators</dt>
            <dd>
              {data.Operator.length} on-chain · {linkedOps.map((o) => `${o.linkedCount} linked wallets`).join(', ') || 'none linked'}
            </dd>
          </dl>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Payer</th>
                  <th>USDC</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.SellerPayment.map((p) => (
                  <tr key={p.txHash + p.payer}>
                    <td className="mono">{short(p.payer)}</td>
                    <td className="mono">{(Number(p.amount) / 1e6).toFixed(3)}</td>
                    <td className="mono small">
                      <a href={`${explorer(network)}/tx/${p.txHash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>
                        {short(p.txHash, 4)} ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

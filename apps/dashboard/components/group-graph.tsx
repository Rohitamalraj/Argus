'use client';

import type { Overview } from '@/lib/api';
import { short } from '@/lib/api';

const COLOR: Record<string, string> = {
  Linked: '#e14b1e',
  Independent: '#027a48',
  Unclear: '#807574',
  Verified: '#231f20',
};

/** DB-2: funder -> wallets, one cluster per customer, coloured by tier. */
export function GroupGraph({
  overview,
  selected,
  onSelect,
}: {
  overview: Overview;
  selected?: string;
  onSelect: (wallet: string) => void;
}) {
  const ops = [...overview.operators].sort((a, b) => b.wallets.length - a.wallets.length);
  const widths = ops.map((o) => (o.wallets.length > 1 ? Math.max(300, o.wallets.length * 46) : 140));
  const total = widths.reduce((s, w) => s + w, 0);
  const W = Math.max(total + 40, 600);
  const H = 300;
  let x = (W - total) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Funding groups" style={{ display: "block", margin: "0 auto", maxWidth: "none" }}>
      {ops.map((o, i) => {
        const w = widths[i]!;
        const cx = x + w / 2;
        x += w;
        const color = COLOR[o.tierName] ?? '#807574';
        const linked = o.tierName === 'Linked';
        const fy = 54;
        const wallets = o.wallets.map((wal, j) => {
          const n = o.wallets.length;
          const spread = n === 1 ? 0 : (j / (n - 1) - 0.5) * (w - 60);
          return { wal, x: cx + spread, y: n === 1 ? 210 : 190 + Math.abs(spread) * 0.12 };
        });
        return (
          <g key={o.operatorId}>
            {wallets.map((p) => (
              <line key={`l${p.wal}`} x1={cx} y1={fy} x2={p.x} y2={p.y} stroke={linked ? color : '#231f20'} strokeOpacity={linked ? 0.55 : 0.25} strokeDasharray={linked ? undefined : '4 5'} />
            ))}
            <g>
              {linked ? (
                <rect x={cx - 44} y={fy - 16} width={88} height={32} rx={8} fill="#231f20" />
              ) : (
                <rect x={cx - 44} y={fy - 16} width={88} height={32} rx={8} fill="none" stroke="#231f20" strokeOpacity={0.25} strokeDasharray="4 4" />
              )}
              <text x={cx} y={fy + 5} textAnchor="middle" fontSize="12" fontFamily="var(--font-mono)" fill={linked ? '#f3efec' : '#807574'}>
                {linked ? short(o.firstFunder ?? '', 3) : 'hub'}
              </text>
            </g>
            {wallets.map((p) => {
              const isSel = selected === p.wal;
              return (
                <g key={p.wal} onClick={() => onSelect(p.wal)} style={{ cursor: 'pointer' }}>
                  <circle cx={p.x} cy={p.y} r={isSel ? 13 : 10} fill={isSel ? color : '#fff'} stroke={color} strokeWidth={3} />
                  <text x={p.x} y={p.y + 30} textAnchor="middle" fontSize="10.5" fontFamily="var(--font-mono)" fill="#807574">
                    {short(p.wal, 2)}
                  </text>
                </g>
              );
            })}
            <text x={cx} y={H - 14} textAnchor="middle" fontSize="13" fontWeight={600} fill={color}>
              {linked ? `1 operator · ${o.wallets.length} wallets` : o.tierName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

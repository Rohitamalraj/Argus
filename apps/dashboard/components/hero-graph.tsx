'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';

/**
 * The idea in one interactive picture, built from the real mainnet demo: 13 wallets paid a seller. One funder is
 * behind 10 of them; the other 3 came from public hubs (a bridge, a DEX pool) and never link anyone.
 * Switch between "13 wallets" and "4 customers" and watch the wallets regroup. Hover a group to see the evidence.
 */

type Mode = 'wallets' | 'operators';
type Group = 'A' | 'I1' | 'I2' | 'I3';

const INK = '#231f20';
const LINKED = '#e14b1e';
const INDEPENDENT = '#027a48';
const NEUTRAL = '#9d9291';
const EASE = [0.22, 1, 0.36, 1] as const;

const FUNDER = { x: 168, y: 205 };
const HULL_R = 124;
const RING_R = 92;
const HUBS = {
  bridge: { x: 468, y: 62, label: 'Bridge payout' },
  pool: { x: 452, y: 268, label: 'Uniswap pool' },
};

interface Wallet {
  id: string;
  group: Group;
  scatter: { x: number; y: number };
  ring: { x: number; y: number };
}

// 10 wallets of one operator arranged around their funder; 3 independents beside their hubs.
const SCATTER = [
  [58, 70], [196, 40], [318, 96], [438, 30], [560, 84],
  [96, 168], [262, 170], [388, 150], [508, 196], [70, 318],
  [226, 350], [372, 322], [536, 346],
];
const WALLETS: Wallet[] = SCATTER.map(([x, y], i) => {
  const farm = i < 10;
  const a = ((-90 + i * 36) * Math.PI) / 180;
  const independent: Record<number, { group: Group; x: number; y: number }> = {
    10: { group: 'I1', x: 556, y: 110 },
    11: { group: 'I2', x: 548, y: 222 },
    12: { group: 'I3', x: 548, y: 322 },
  };
  const ind = independent[i];
  return {
    id: `w${i}`,
    group: farm ? 'A' : ind!.group,
    scatter: { x: x!, y: y! },
    ring: farm ? { x: FUNDER.x + Math.cos(a) * RING_R, y: FUNDER.y + Math.sin(a) * RING_R } : { x: ind!.x, y: ind!.y },
  };
});

const EVIDENCE: Record<Group, { title: string; tier: 'Linked' | 'Independent'; confidence: string; chips: string[]; reasons: string[] }> = {
  A: {
    title: 'Operator 1 · 10 wallets · funder 0xFFa8…6869',
    tier: 'Linked',
    confidence: 'high confidence',
    chips: ['S1 shared funder', 'S2 identical amounts', 'S3 same day'],
    reasons: ['First USDC funder also seeded 9 other wallets', 'Funded in identical 0.20 USDC amounts to 10 wallets within 13 seconds'],
  },
  I1: {
    title: 'Customer 2 · 1 wallet',
    tier: 'Independent',
    confidence: 'high confidence',
    chips: ['funded by a hub'],
    reasons: ['First funder is a known hub: a bridge payout', 'Hubs never link wallets'],
  },
  I2: {
    title: 'Customer 3 · 1 wallet',
    tier: 'Independent',
    confidence: 'high confidence',
    chips: ['funded by a hub'],
    reasons: ['First funder is a known hub: the Uniswap WMON/USDC pool', 'Hubs never link wallets'],
  },
  I3: {
    title: 'Customer 4 · 1 wallet',
    tier: 'Independent',
    confidence: 'high confidence',
    chips: ['funded by a hub'],
    reasons: ['Same hub as customer 3, so still its own operator', 'A shared hub is not a shared owner'],
  },
};

export function HeroGraph() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>(reduce ? 'operators' : 'wallets');
  const [focus, setFocus] = useState<Group | null>(null);
  const touched = useRef(false);

  // Play the story on its own until the visitor takes over: scattered wallets, then regrouped, then back.
  useEffect(() => {
    if (reduce) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const step = (next: Mode) => {
      if (!alive || touched.current) return;
      setMode(next);
      timer = setTimeout(() => step(next === 'wallets' ? 'operators' : 'wallets'), next === 'wallets' ? 3200 : 7000);
    };
    timer = setTimeout(() => step('operators'), 1800);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [reduce]);

  const choose = (m: Mode) => {
    touched.current = true;
    setMode(m);
  };
  const operators = mode === 'operators';
  const shown: Group = focus ?? 'A';
  const dim = (g: Group) => (operators && focus && focus !== g ? 0.22 : 1);

  // a gentle tilt that follows the cursor
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [3, -3]), { stiffness: 90, damping: 18 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-4, 4]), { stiffness: 90, damping: 18 });
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onLeave = () => {
    mx.set(0);
    my.set(0);
    setFocus(null);
  };

  const ev = EVIDENCE[shown];

  return (
    <div className="hg" onPointerMove={reduce ? undefined : onMove} onPointerLeave={onLeave}>
      <div className="hg-bar">
        <div className="hg-seg" role="group" aria-label="View">
          {(['wallets', 'operators'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => choose(m)} className={mode === m ? 'on' : undefined}>
              {mode === m && !reduce && <motion.span layoutId="hg-pill" className="hg-pill" transition={{ duration: 0.45, ease: EASE }} />}
              <span className="hg-seg-label">{m === 'wallets' ? '13 wallets' : '4 customers'}</span>
            </button>
          ))}
        </div>
        <span className="hg-hint">{operators ? 'hover a group for the evidence' : 'looks like 13 customers…'}</span>
      </div>

      <motion.div style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}>
        <svg viewBox="0 0 620 400" className="hg-svg" role="img" aria-label="Thirteen wallets that regroup into four customers: ten share one funder, three come from public hubs">
          {/* the operator's hull */}
          <motion.circle
            cx={FUNDER.x}
            cy={FUNDER.y}
            fill={LINKED}
            stroke={LINKED}
            strokeDasharray="4 6"
            animate={{ r: operators ? HULL_R : HULL_R * 0.55, opacity: operators ? dim('A') : 0, fillOpacity: 0.06, strokeOpacity: 0.55 }}
            transition={{ duration: 0.8, ease: EASE }}
          />

          {/* funding edges */}
          {WALLETS.filter((w) => w.group === 'A').map((w) => (
            <motion.line
              key={`e-${w.id}`}
              className="hg-flow"
              x1={FUNDER.x}
              y1={FUNDER.y}
              stroke={LINKED}
              strokeWidth={1.2}
              initial={false}
              animate={{ x2: operators ? w.ring.x : FUNDER.x, y2: operators ? w.ring.y : FUNDER.y, opacity: operators ? 0.75 * dim('A') : 0 }}
              transition={{ duration: 0.8, ease: EASE }}
            />
          ))}
          {([['I1', HUBS.bridge], ['I2', HUBS.pool], ['I3', HUBS.pool]] as const).map(([g, hub]) => {
            const w = WALLETS.find((x) => x.group === g)!;
            return (
              <motion.line
                key={`h-${g}`}
                x1={hub.x}
                y1={hub.y}
                stroke={NEUTRAL}
                strokeWidth={1.1}
                strokeDasharray="2 5"
                initial={false}
                animate={{ x2: operators ? w.ring.x : hub.x, y2: operators ? w.ring.y : hub.y, opacity: operators ? 0.9 * dim(g) : 0 }}
                transition={{ duration: 0.8, ease: EASE }}
              />
            );
          })}

          {/* funder and hubs */}
          <motion.g initial={false} animate={{ opacity: operators ? dim('A') : 0, scale: operators ? 1 : 0.6 }} style={{ originX: `${FUNDER.x}px`, originY: `${FUNDER.y}px` }} transition={{ duration: 0.7, ease: EASE }}>
            <rect x={FUNDER.x - 11} y={FUNDER.y - 11} width={22} height={22} rx={6} fill={INK} />
            <circle cx={FUNDER.x} cy={FUNDER.y} r={3.2} fill="#f3efec" />
            <text x={FUNDER.x} y={FUNDER.y + 27} textAnchor="middle" className="hg-label">funder</text>
          </motion.g>
          {([[HUBS.bridge, ['I1']], [HUBS.pool, ['I2', 'I3']]] as const).map(([hub, owns]) => (
            <motion.g key={hub.label} initial={false} animate={{ opacity: operators ? (focus && !(owns as readonly Group[]).includes(focus) ? 0.22 : 1) : 0 }} transition={{ duration: 0.7, ease: EASE }}>
              <rect x={hub.x - 9} y={hub.y - 9} width={18} height={18} rx={5} fill="#fff" stroke={NEUTRAL} strokeWidth={1.4} />
              <text x={hub.x} y={hub.y - 15} textAnchor="middle" className="hg-label">{hub.label}</text>
              <text x={hub.x} y={hub.y + 24} textAnchor="middle" className="hg-label hg-faint">hub · never links</text>
            </motion.g>
          ))}

          {/* wallets */}
          {WALLETS.map((w, i) => (
            <g key={w.id} data-group={w.group} onPointerEnter={() => operators && setFocus(w.group)} onPointerLeave={() => setFocus(null)} style={{ cursor: operators ? 'pointer' : 'default' }}>
              <motion.circle
                initial={false}
                animate={{
                  cx: operators ? w.ring.x : w.scatter.x,
                  cy: operators ? w.ring.y : w.scatter.y,
                  r: operators && focus === w.group ? 9 : 7.5,
                  stroke: operators ? (w.group === 'A' ? LINKED : INDEPENDENT) : NEUTRAL,
                  opacity: dim(w.group),
                }}
                transition={{ duration: 0.9, ease: EASE, delay: operators ? i * 0.02 : (12 - i) * 0.015 }}
                fill="#fff"
                strokeWidth={2}
              />
              {!operators && !reduce && (
                <motion.circle
                  cx={w.scatter.x}
                  cy={w.scatter.y}
                  r={7.5}
                  fill="none"
                  stroke={NEUTRAL}
                  strokeWidth={1}
                  animate={{ r: [7.5, 15], opacity: [0.45, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, delay: (i % 5) * 0.4, ease: 'easeOut' }}
                />
              )}
              <circle cx={operators ? w.ring.x : w.scatter.x} cy={operators ? w.ring.y : w.scatter.y} r={14} fill="transparent" />
            </g>
          ))}

          {/* group labels */}
          <motion.text x={FUNDER.x} y={FUNDER.y - HULL_R - 10} textAnchor="middle" className="hg-label hg-strong" initial={false} animate={{ opacity: operators ? dim('A') : 0 }}>
            Operator 1 · 10 wallets
          </motion.text>
          {(['I1', 'I2', 'I3'] as const).map((g, i) => {
            const w = WALLETS.find((x) => x.group === g)!;
            return (
              <motion.text key={g} x={w.ring.x} y={w.ring.y - 15} textAnchor="middle" className="hg-label hg-strong" initial={false} animate={{ opacity: operators ? dim(g) : 0 }}>
                Customer {i + 2}
              </motion.text>
            );
          })}
        </svg>
      </motion.div>

      <div className="hg-panel" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {operators ? (
            <motion.div key={shown} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }}>
              <div className="hg-panel-head">
                <span className={`chip ${ev.tier === 'Linked' ? 'linked' : 'independent'}`}>
                  <span className="chip-dot" />
                  {ev.tier}
                </span>
                <span className="hg-title">{ev.title}</span>
                <span className="hg-conf">{ev.confidence}</span>
              </div>
              <ul className="hg-reasons">
                {ev.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <div className="hg-chips">
                {ev.chips.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.p key="unknown" className="hg-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              Thirteen wallets paid a seller. Count them and you get thirteen customers. Argus asks who funded each one.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

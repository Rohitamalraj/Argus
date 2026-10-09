import Link from 'next/link';
import { Footer, GITHUB, Marquee, Nav } from '@/components/chrome';
import { HeroArt } from '@/components/hero-art';
import { LiveCount } from '@/components/live-count';

const STEPS = [
  {
    t: 'Read the funding graph',
    d: 'Envio HyperSync finds who first funded each wallet (USDC for x402 payers, MON for ERC-8004 reviewers) and every other wallet that funder seeded. Exchanges, bridges, faucets and DEX pools are hubs and never link anyone.',
  },
  {
    t: 'Need a second signal',
    d: 'A shared funder alone is never enough. Linked needs another: identical instalments, same-day activity, money flowing back to one address, or one funder dominating a group such as an agent’s reviewers.',
  },
  {
    t: 'Two sources agree',
    d: 'On mainnet, Nansen independently reports each wallet’s first funder. Agreement raises confidence; disagreement makes the verdict Unclear.',
  },
  {
    t: 'Anyone can recompute it',
    d: 'The rule is deterministic over public data. Verdicts are published to a permissionless registry per attestor, and the SDK re-checks them locally. Verify, don’t trust.',
  },
];

const USES = [
  {
    who: 'x402 seller',
    pkg: 'argus-x402-middleware',
    line: 'One promo per operator, not per wallet.',
    code: `app.use(argus({
  network: 'mainnet', payTo: SELLER,
  price: { standard: '$0.01', promo: '$0.005' },
  routes: ['GET /api/premium'],
  attestors: [ARGUS],
}));`,
  },
  {
    who: 'AI agent',
    pkg: 'argus-x402-mcp',
    line: 'Tools for Claude Code and any MCP client.',
    code: `claude mcp add argus \\
  -e ENVIO_API_TOKEN=<token> \\
  -- npx -y argus-x402-mcp

> How many operators are behind
> agent 182's ERC-8004 reviews?`,
  },
  {
    who: 'Developer',
    pkg: 'argus-x402-sdk',
    line: 'Verify locally. De-duplicate reputation.',
    code: `const argus = createArgus({ network: 'mainnet', hypersyncToken });
const rep = await argus.agentReputation(182);
rep.raw.distinctClients;   // 7665
rep.independent.operators; // 1`,
  },
  {
    who: 'Smart contract',
    pkg: 'ArgusGate',
    line: 'Gate a function by an explicit set of tiers.',
    code: `uint8 constant OK = (1 << 2) | (1 << 3);
function claim() external
  onlyTiers(ATTESTOR, OK) { ... }`,
  },
];

const TIERS = [
  ['Unclear', 'unclear', 'No verdict yet, expired, no funding trace, or a shared funder with no second signal', 'Standard price'],
  ['Linked', 'linked', 'Seeded by the same non-hub funder as 2+ other wallets, plus one more fleet signal', 'One promo for the whole operator'],
  ['Independent', 'independent', 'Funding traced, no shared non-hub funder. Wallet age never matters', 'Its own full promo'],
  ['Verified', 'verified', 'A valid agent credential (reserved)', 'Full promo'],
] as const;

export default function Home() {
  return (
    <>
      <Nav active="home" />
      <section className="hero">
        <HeroArt />
        <div className="container hero-inner">
          <h1>Count operators, not wallets.</h1>
          <p className="lede">
            Argus tells you whether the wallets in front of you are one operator or many: x402 payers, ERC-8004 reviewers, campaign claimants. Public
            chain data in, a verdict anyone can recompute out. Built on Monad for sellers, developers and AI agents.
          </p>
          <div className="hero-cta">
            <Link href="/agents?agent=182" className="btn btn-dark btn-lg">
              Try it on agent #182 <span className="chev">›</span>
            </Link>
            <a href={`${GITHUB}/blob/main/docs/INTEGRATE.md`} target="_blank" rel="noreferrer" className="btn btn-light btn-lg">
              Integration guide
            </a>
          </div>
        </div>
        <Marquee />
      </section>

      <section className="section-tight">
        <div className="container">
          <p className="eyebrow">On Monad mainnet right now</p>
          <div className="bignum">
            <div className="n">
              7,665
              <span className="label">ERC-8004 reviewers of agent #182</span>
            </div>
            <div className="arrow">→</div>
            <div className="n">
              1
              <span className="label">operator: one funder first funded every one of them</span>
            </div>
          </div>
          <p className="mono small muted" style={{ marginTop: 18, maxWidth: '72ch' }}>
            The ERC-8004 spec warns that unfiltered feedback is open to Sybil attacks and expects third parties to supply the reviewer filter. This is that
            filter, from public data. Linked means shared funding, not wrongdoing.{' '}
            <Link href="/agents?agent=182" style={{ color: 'var(--brand-deep)' }}>
              Run it live →
            </Link>
          </p>
        </div>
      </section>

      <section className="section" id="developers">
        <div className="container">
          <p className="eyebrow">Four ways to use it</p>
          <h2 className="display" style={{ maxWidth: '18ch' }}>
            A primitive, not an app
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12 }}>
            {USES.map((u) => (
              <div className="card card-solid" key={u.who}>
                <div className="panel-title" style={{ marginBottom: 6 }}>
                  <h3 style={{ fontSize: 22 }}>{u.who}</h3>
                  <span className="mono small muted">{u.pkg}</span>
                </div>
                <p className="mono small" style={{ color: 'var(--ink-2)', margin: '0 0 14px' }}>
                  {u.line}
                </p>
                <pre className="code" style={{ fontSize: 12.5 }}>
                  {u.code}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container split">
          <div className="sticky-col">
            <p className="eyebrow">How it works</p>
            <h2 className="display">Find the operator behind the wallets</h2>
            <p className="lede" style={{ fontSize: 15 }}>
              Soft policy, never an accusation: a Linked wallet still pays and is served. It just shares one promo with the rest of its fleet.
            </p>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="card step" key={s.t}>
                <span className="step-num">0{i + 1}</span>
                <div>
                  <h3 className="title" style={{ fontSize: 22 }}>
                    {s.t}
                  </h3>
                  <p>{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <p className="eyebrow">The x402 demo, live on Monad testnet</p>
          <LiveCount />
        </div>
      </section>

      <section className="section" id="tiers">
        <div className="container">
          <p className="eyebrow">Tiers</p>
          <h2 className="display" style={{ maxWidth: '16ch' }}>
            Numbers rise with how sure we are
          </h2>
          <div className="card table-wrap" style={{ padding: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Meaning</th>
                  <th>Default policy</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map(([name, cls, meaning, policy], i) => (
                  <tr key={name}>
                    <td>
                      <span className={`chip ${cls}`}>
                        <span className="chip-dot" />
                        {i} {name}
                      </span>
                    </td>
                    <td className="mono small">{meaning}</td>
                    <td>{policy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mono small muted" style={{ marginTop: 14 }}>
            Contracts check an explicit set of allowed tiers with onlyTiers(attestor, mask), never “tier at least N”.
          </p>
        </div>
      </section>

      <Footer />
    </>
  );
}

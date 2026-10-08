import Link from 'next/link';
import { AnnouncementBar, Footer, GITHUB, Marquee, Nav } from '@/components/chrome';
import { HeroArt } from '@/components/hero-art';
import { LiveCount } from '@/components/live-count';

const STEPS = [
  {
    t: 'Quote',
    d: 'The buyer names its wallet on the unpaid request. The middleware looks for a verdict in its cache, the on-chain registry, then the analyzer, and answers 402 at the promo or the standard price.',
  },
  {
    t: 'Trace the first funder',
    d: 'Envio HyperSync finds who sent each paying wallet its first USDC, and every other wallet that funder seeded. Exchanges, bridges, faucets and DEX pools are hubs and never link anyone.',
  },
  {
    t: 'Need two signals',
    d: 'A shared funder alone is never enough. Linked needs a second fleet signal: identical instalments, same-day activation, or money flowing back to one address.',
  },
  {
    t: 'Publish on Monad',
    d: 'Verdicts of wallets that paid go to the PayerAttestations registry with a 7-day expiry and an evidence hash. Every seller reads the same answer.',
  },
];

const TIERS = [
  ['Unclear', 'unclear', 'No verdict yet, expired, no funding trace, or a shared funder with no second signal', 'Standard price'],
  ['Linked', 'linked', 'Seeded by the same non-hub funder as 2+ other wallets, plus one more fleet signal', 'One promo for the whole operator'],
  ['Independent', 'independent', 'Funding traced, no shared non-hub funder. Wallet age never matters', 'Its own full promo'],
  ['Verified', 'verified', 'A valid agent credential (planned)', 'Full promo'],
] as const;

export default function Home() {
  return (
    <>
      <AnnouncementBar />
      <Nav active="home" />
      <section className="hero">
        <HeroArt />
        <div className="container hero-inner">
          <h1>One promo per customer. Not per wallet.</h1>
          <p className="lede">
            x402 sellers on Monad hand promos to wallets, and one operator can spin up a hundred. Argus traces who funded each paying
            wallet, groups wallets seeded by the same funder, and gives the promo to real customers.
          </p>
          <div className="hero-cta">
            <Link href="/dashboard#simulate" className="btn btn-dark btn-lg">
              Run the simulation <span className="chev">›</span>
            </Link>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="btn btn-light btn-lg">
              View on GitHub
            </a>
          </div>
        </div>
        <Marquee />
      </section>

      <section className="section" id="how">
        <div className="container split">
          <div className="sticky-col">
            <p className="eyebrow">How it works</p>
            <h2 className="display">Find the operator behind the wallets</h2>
            <p className="lede" style={{ fontSize: 15 }}>
              Soft policy, never an accusation: a Linked wallet still pays and is served. It just shares one promo with the rest of its
              fleet.
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
          <p className="eyebrow">Live on Monad testnet</p>
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
                  <th>Default seller policy</th>
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

      <section className="section" id="developers">
        <div className="container split">
          <div className="sticky-col">
            <p className="eyebrow">Developers</p>
            <h2 className="display">Ten lines on your x402 route</h2>
            <p className="lede" style={{ fontSize: 15 }}>
              Argus wraps the official @x402/express middleware with a per-payer price. Promo counters move only after a payment settles,
              and an analyzer outage falls back to the standard price.
            </p>
          </div>
          <pre className="code">
            <span className="k">import</span> {'{ argus }'} <span className="k">from</span> <span className="s">&apos;@argus/middleware&apos;</span>;{'\n\n'}
            app.<span className="k">use</span>(argus({'{'}
            {'\n'}  network: <span className="s">&apos;testnet&apos;</span>,{'\n'}  payTo: SELLER,{'\n'}  price: {'{'} standard:{' '}
            <span className="s">&apos;$0.01&apos;</span>, promo: <span className="s">&apos;$0.005&apos;</span> {'}'},{'\n'}  routes: [
            <span className="s">&apos;GET /api/premium&apos;</span>],{'\n'}  attestors: [ANALYZER],{'\n'}  analyzerUrl: process.env.ANALYZER_URL,
            {'\n'}
            {'}'}));{'\n\n'}
            <span className="c">{'// req.argus = { tierName, operatorId, reasons, price, promoLeft }'}</span>
          </pre>
        </div>
      </section>

      <Footer />
    </>
  );
}

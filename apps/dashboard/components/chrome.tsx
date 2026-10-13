import Link from 'next/link';

export const GITHUB = 'https://github.com/Rohitamalraj/Argus';

/** The Argus mark: a watchful eye drawn in two strokes. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="argus-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7cfc3" />
          <stop offset="1" stopColor="#e14b1e" />
        </linearGradient>
      </defs>
      <path d="M3 16 C 9 6, 23 6, 29 16 C 23 26, 9 26, 3 16 Z" fill="none" stroke="url(#argus-mark)" strokeWidth="3.2" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="4.6" fill="#231f20" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Argus home">
      <Mark />
      Argus
    </Link>
  );
}

export function Nav({ active }: { active?: 'home' | 'dashboard' | 'agents' | 'store' }) {
  return (
    <header className="nav">
      <div className="container">
        <Logo />
        <nav className="nav-pill" aria-label="Main">
          <Link href="/#how">How it works</Link>
          <Link href="/#tiers">Tiers</Link>
          <Link href="/#developers">Developers</Link>
          <Link href="/agents" className={active === 'agents' ? 'active' : undefined}>
            Agents
          </Link>
          <Link href="/store" className={active === 'store' ? 'active' : undefined}>
            Store
          </Link>
          <Link href="/dashboard" className={active === 'dashboard' ? 'active' : undefined}>
            Dashboard
          </Link>
          <a href={GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="nav-actions">
          <Link href="/store" className="btn btn-dark">
            Try the live store
          </Link>
          <a href={`${GITHUB}#readme`} target="_blank" rel="noreferrer" className="btn btn-light">
            Read the docs
          </a>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div>
          <div className="logo" style={{ fontSize: 20 }}>
            <Mark size={22} />
            Argus
          </div>
          <p className="mono small" style={{ maxWidth: 440, marginTop: 12 }}>
            Argus estimates operators and limits promos. Linked wallets are still served, at the standard price.
          </p>
        </div>
        <div>
          <div className="links">
            <Link href="/store">Store</Link>
            <Link href="/dashboard">Dashboard</Link>
            <a href="https://www.npmjs.com/search?q=argus-x402" target="_blank" rel="noreferrer">
              npm packages
            </a>
            <a href={GITHUB} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://testnet.monadvision.com/address/0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE" target="_blank" rel="noreferrer">
              Testnet registry
            </a>
            <a href="https://monadvision.com/address/0x151e488618FC0F79F7f91447351174Fb8D98cE98" target="_blank" rel="noreferrer">
              Mainnet registry
            </a>
          </div>
          <p className="powered" style={{ marginTop: 16 }}>
            Funding data on mainnet: Powered by Nansen API · Chain data: Envio HyperSync · MIT licensed
          </p>
        </div>
      </div>
    </footer>
  );
}

const STACK: [string, string][] = [
  ['Monad', 'settlement'],
  ['x402', 'payments'],
  ['Envio', 'HyperSync + HyperIndex'],
  ['Nansen', 'deep checks'],
  ['Dynamic', 'server wallet'],
  ['Circle USDC', 'EIP-3009'],
  ['Foundry', 'registry'],
];

export function Marquee() {
  const items = [...STACK, ...STACK];
  return (
    <div className="marquee" aria-label="Built with">
      <div className="marquee-track">
        {items.map(([name, role], i) => (
          <span className="marquee-item" key={i} aria-hidden={i >= STACK.length}>
            {name} <small>{role}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

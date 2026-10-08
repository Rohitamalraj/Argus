/**
 * Hero line art: a warm glow, long hairlines, and the idea in one picture: one funder fanning out to a
 * fleet of wallets, watched by the Argus eye.
 */
export function HeroArt() {
  const funder = { x: 1104, y: 262 };
  const fleet = Array.from({ length: 10 }, (_, i) => {
    const a = (-12 + i * 9.5) * (Math.PI / 180);
    const r = 330 + (i % 3) * 40;
    return { x: funder.x + Math.cos(a) * r * 0.82, y: funder.y + 120 + Math.sin(a) * r };
  });
  return (
    <svg className="hero-art" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="glow-a" cx="0.72" cy="0.3" r="0.42">
          <stop offset="0" stopColor="#f7b5a6" stopOpacity="0.9" />
          <stop offset="0.45" stopColor="#f7cfc3" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f3efec" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="glow-b" cx="0.92" cy="0.12" r="0.3">
          <stop offset="0" stopColor="#efe2f3" stopOpacity="0.9" />
          <stop offset="1" stopColor="#f3efec" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="glow-c" cx="0.6" cy="0.62" r="0.32">
          <stop offset="0" stopColor="#fbe7c9" stopOpacity="0.7" />
          <stop offset="1" stopColor="#f3efec" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#glow-c)" />
      <rect width="1440" height="900" fill="url(#glow-a)" />
      <rect width="1440" height="900" fill="url(#glow-b)" />

      <g stroke="#231f20" strokeWidth="1" fill="none" opacity="0.35">
        <line x1="470" y1="640" x2="1440" y2="300" />
        <line x1="640" y1="420" x2="1440" y2="150" />
        <line x1="960" y1="40" x2="1440" y2="760" />
        <line x1="780" y1="90" x2="1230" y2="760" />
        <line x1="932" y1="0" x2="934" y2="760" />
      </g>

      <g stroke="#231f20" strokeWidth="1" opacity="0.55">
        {fleet.map((p, i) => (
          <line key={i} x1={funder.x} y1={funder.y} x2={p.x} y2={p.y} />
        ))}
      </g>
      {fleet.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="5" fill="#f3efec" stroke="#e14b1e" strokeWidth="2" />
      ))}

      <g transform={`translate(${funder.x} ${funder.y}) rotate(-14)`}>
        <path d="M-96 0 C -52 -70, 52 -70, 96 0 C 52 70, -52 70, -96 0 Z" fill="none" stroke="#231f20" strokeWidth="13" strokeLinejoin="round" />
        <circle r="24" fill="#231f20" />
        <circle r="7" cx="-7" cy="-7" fill="#f3efec" />
      </g>
    </svg>
  );
}

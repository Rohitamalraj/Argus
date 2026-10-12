/** The warm glow behind the hero. The picture itself is the interactive graph (hero-graph.tsx). */
export function HeroArt() {
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

    </svg>
  );
}

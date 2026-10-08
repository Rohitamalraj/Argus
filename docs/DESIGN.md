# Argus design direction

The Argus site and dashboard follow the visual language of the Tracebit design capture from Inspo
(https://inspomcp.dev/sites/tracebit-com, MIT-licensed extraction). We adapt the style, not the brand:
Argus uses its own name, copy, mark and free fonts.

## What we take

- **Macrostructure:** Marquee Hero. Dark announcement bar, sticky pill nav, very large tight headline,
  monospace body copy, dark pill CTA, thin geometric line art over a soft warm gradient, a scrolling
  wordmark strip.
- **Mood:** clinical Swiss precision, burnt orange accents on a pale limestone ground. Ample white space.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f3efec` | page (off-white limestone) |
| `--ink` | `#231f20` | text, dark buttons, announcement bar |
| `--ink-2` | `#000000bf` | secondary text |
| `--line` | `#00000014` | borders, hairlines |
| `--surface` | `#00000005` / `#ffffff` | cards |
| `--brand` | `#ea6f53` | accent, links |
| `--brand-deep` | `#e14b1e` | strong accent (Linked) |
| `--peach` | `#f7cfc3` | gradient glow, raised surface |
| `--rust` | `#75270f` | deep accent |
| `--warm-grey` | `#807574` | muted text |
| `--success` | `#027a48` on `#ecfdf3` | Independent |
| `--error` | `#b42318` on `#fef3f2` | errors |

Tier colours: Linked uses `--brand-deep`, Independent uses `--success`, Unclear uses `--warm-grey`,
Verified uses `--ink`.

## Type

The source uses TWK Lausanne Pan (commercial). We use free equivalents:

| Role | Family | Size | Weight | Line-height | Tracking |
| --- | --- | --- | --- | --- | --- |
| h1 | Inter Tight | 92px (clamp down on small screens) | 600 | 0.96 | -0.03em |
| h2 | Inter Tight | 56px | 600 | 1.02 | -0.03em |
| h3 | Inter Tight | 28px | 600 | 1.2 | -0.02em |
| body | JetBrains Mono | 15px | 400 | 1.6 | 0 |
| button / nav | Inter Tight | 14px | 500 | 1.5 | 0 |

## Spacing and shape

Base step 4px; section rhythm 46px and 124px. Radii 8 / 10 / 12px; pills fully rounded.
Container max width 1440px with 80px side gutters on desktop, 16px on phones.

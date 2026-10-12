import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Serif, Sora } from 'next/font/google';
import './globals.css';

const sora = Sora({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-sora' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono' });
// Used for the landing-page hero headline only.
const instrument = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument' });

export const metadata: Metadata = {
  title: 'Argus — one promo per customer, not per wallet',
  description:
    'Argus spots when many wallets paying an x402 seller belong to one operator, so promos go to real customers. Built on Monad.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${plexMono.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}

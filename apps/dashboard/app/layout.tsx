import type { Metadata } from 'next';
import { Inter_Tight, JetBrains_Mono, Playfair_Display } from 'next/font/google';
import './globals.css';

const interTight = Inter_Tight({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inter-tight' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains' });

// Display serif for the hero accent (bold italic). Swap the family here to change the look.
const display = Playfair_Display({ subsets: ['latin'], weight: ['700', '800'], style: ['italic'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'Argus — one promo per customer, not per wallet',
  description:
    'Argus spots when many wallets paying an x402 seller belong to one operator, so promos go to real customers. Built on Monad.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrains.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}

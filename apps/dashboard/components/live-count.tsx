'use client';

import { useEffect, useState } from 'react';
import { getOverview, type Overview } from '@/lib/api';

/** "13 → 4": paying wallets resolved into customers, live from the analyzer when it is reachable. */
export function LiveCount() {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    getOverview('testnet').then(setO).catch(() => setO(null));
  }, []);
  const live = o && o.counts.rawWallets > 0;
  const wallets = live ? o.counts.rawWallets : 13;
  const customers = live ? o.counts.customers : 4;
  return (
    <div className="bignum">
      <div className="n">
        {wallets}
        <span className="label">paying wallets</span>
      </div>
      <div className="arrow">→</div>
      <div className="n">
        {customers}
        <span className="label">real customers{live ? '' : ' (demo scenario: 1 operator with 10 wallets + 3 independents)'}</span>
      </div>
    </div>
  );
}

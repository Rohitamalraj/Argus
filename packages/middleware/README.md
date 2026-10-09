# argus-x402-middleware

Give each paying customer one promo, not each wallet. An Express middleware on top of `@x402/express` that quotes a per-payer price: the promo to a new customer, the standard price to the fifth wallet of the same operator.

```bash
npm install argus-x402-middleware express
```

```ts
import { argus } from 'argus-x402-middleware';

app.use(
  argus({
    network: 'mainnet',
    payTo: SELLER,
    price: { standard: '$0.01', promo: '$0.005' },
    routes: ['GET /api/premium'],
    policy: { promoCalls: 20 },
    attestors: [ARGUS_ATTESTOR],            // whose verdicts you trust
    analyzerUrl: process.env.ANALYZER_URL,  // optional: fresh verdicts for new wallets
  }),
);

app.get('/api/premium', (req, res) => res.json({ tier: req.argus?.tierName, promoLeft: req.argus?.promoLeft }));
```

Buyers send `X-Payer-Address` on the unpaid request. The middleware looks up a verdict (local cache, then the on-chain registry for your trusted attestors, then the analyzer within 300 ms), answers 402 at the promo or standard price, checks the **signed** payer on the paid retry, and counts promos per operator **only after a payment settles**.

- A Linked fleet shares one promo allowance; Independent wallets get their own; Unclear pays the standard price.
- A wallet with no verdict yet gets one promo call while it is assessed in the background.
- If the analyzer or the registry is down, everyone pays the standard price. It never blocks a paying request.
- `req.argus` carries the tier, reasons, price and promo left.

Part of [Argus](https://github.com/Rohitamalraj/Argus). MIT.

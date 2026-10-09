# argus-x402-scoring

The decision rule behind Argus: are these wallets one operator or many? Pure functions over public chain evidence. No network, no provider code, deterministic: the same evidence gives the same verdict, so anyone can re-run it.

```ts
import { assembleInput, decide, makeConfig } from 'argus-x402-scoring';

const cfg = makeConfig({ knownHubs: [EXCHANGE, FAUCET] });
const verdict = decide(assembleInput(chainId, wallet, usdcTransfers, cfg), salt, cfg);
// { tierName: 'Linked', confidence: 'high', groupSize: 10, reasons: [...] }
```

## The rule

- **S1** the wallet's first funder is not a hub and funded at least 3 wallets
- **S2** identical instalments (within 1%) to at least 3 of them within 24 hours
- **S3** at least 70% of them first acted on the same UTC day
- **S4** at least 90% of their outflows go back to the funder or one shared address
- **S5** (context) the funder first funded at least half of a context set, such as one ERC-8004 agent's reviewers

**Linked** = S1 plus at least one of S2 to S5. **Independent** = funding traced and S1 false. **Unclear** = everything else, including S1 alone. A shared funder alone never links wallets, hubs never link anyone, and wallet age is never an input.

"Linked" means shared funding, not wrongdoing.

Part of [Argus](https://github.com/Rohitamalraj/Argus). MIT.

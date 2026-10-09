# argus-x402-sdk

Check whether wallets are independent operators, and how much ERC-8004 reputation is real. Everything is recomputed locally from public Monad chain data: **verify, don't trust**. No wallet address is sent to an Argus server.

```bash
npm install argus-x402-sdk
export ENVIO_API_TOKEN=...   # free HyperSync token: https://envio.dev/app/api-tokens
```

```ts
import { createArgus } from 'argus-x402-sdk';

const argus = createArgus({ network: 'mainnet', hypersyncToken: process.env.ENVIO_API_TOKEN });

// 1. Is this payer one of a fleet?  (recomputed locally)
const v = await argus.checkWallet('0x971E94Fed75A8f527566206E68D85e52F050C6D1');
v.tierName; // 'Linked'
v.reasons;  // ['First USDC funder also seeded 9 other wallets', ...]

// 2. Does a published on-chain verdict agree with the chain?
const check = await argus.verify('0x971E94Fed75A8f527566206E68D85e52F050C6D1');
check.matches; // true

// 3. ERC-8004: how many operators are behind an agent's reviews?
const rep = await argus.agentReputation(182);
rep.raw.distinctClients;   // 7665 reviewers
rep.independent.operators; // 1
rep.clientAllowlist;       // one reviewer per operator: pass to getSummary(agentId, clientAddresses, '', '')
```

## Command line

```bash
npx -p argus-x402-sdk argus-x402 reputation 182          # ERC-8004 reputation, deduplicated by operator
npx -p argus-x402-sdk argus-x402 reputation 182 --sample 800
npx -p argus-x402-sdk argus-x402 check 0x...             # operator-independence verdict
npx -p argus-x402-sdk argus-x402 verify 0x...            # published verdict vs local recomputation
```

## What it reads

| Need | Source |
| --- | --- |
| Funding history | Envio HyperSync (USDC transfers for x402 payers, native MON for ERC-8004 reviewers) |
| Published verdicts | The `PayerAttestations` registry on Monad (any attestor; you choose whom to trust) |
| ERC-8004 feedback | The Reputation registry on Monad (`NewFeedback`, `FeedbackRevoked`) |

Funding is traced through **direct transfers**; a wallet funded through a contract shows no inbound transfer and counts as independent. Verdicts say "shares a funder", never "fraud".

Part of [Argus](https://github.com/Rohitamalraj/Argus). MIT.

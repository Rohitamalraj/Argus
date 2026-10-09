# Architecture

Argus answers one question: are these wallets one operator or many? It answers from public chain data, deterministically, so any party can recompute the answer instead of trusting it.

```text
                public Monad chain data
        (USDC transfers, MON transfers, ERC-8004 events)
                          │
                 Envio HyperSync  ◄── Nansen (mainnet deep check, cross-source)
                          │
                ┌─────────┴──────────┐
                │ argus-x402-scoring │   pure rule: S1..S5, hub rule, tiers
                └─────────┬──────────┘
        ┌─────────────────┼───────────────────────┐
        │                 │                       │
  argus-x402-sdk    analyzer service        argus-x402-mcp
  (local verify,    (batching, Nansen,      (tools for AI agents,
   ERC-8004 by       publisher, API)         read-only)
   operator, CLI)         │
        │                 ▼
        │       PayerAttestations registry  ◄── any attestor can publish
        │         (Monad, per wallet+attestor, 7-day expiry)
        │                 │
        ▼                 ▼
  argus-x402-middleware, ArgusGate (on-chain), Envio HyperIndex (events → GraphQL → dashboard)
```

## Components

| Component | Responsibility | Where |
| --- | --- | --- |
| Scoring | The decision rule over funding evidence: S1 shared funder, S2 identical instalments, S3 synchronized activity, S4 value closure, S5 context concentration; hub rule; tiers; operator ids; evidence bundle and hash. No network, no provider code | `packages/scoring` |
| SDK | HyperSync client (USDC, native MON, raw logs), chain providers, registry reader, local verification, ERC-8004 reputation by operator, `argus-x402` CLI | `packages/sdk` |
| Middleware | Per-payer x402 pricing on `@x402/express`, verdict lookup (cache, registry, analyzer), per-operator promo counters, fail-open | `packages/middleware` |
| MCP server | Four read-only tools for AI agents over stdio | `packages/mcp` |
| Registry | `PayerAttestations`: verdicts by `(wallet, attestor)` with expiry; `ArgusGate.onlyTiers(attestor, mask)` | `contracts` |
| Analyzer | The hosted attestor: batches wallets into few HyperSync queries, pre-computes verdicts for a whole fleet, Nansen deep check on mainnet promo claims, publishes only wallets that paid, serves the dashboard | `services/analyzer` |
| Indexer | Envio HyperIndex over the registry, USDC payments to the demo sellers, and ERC-8004 feedback | `indexer` |
| Dashboard | Demo and docs front end | `apps/dashboard` |

## Three flows

**x402 request.** The buyer sends `X-Payer-Address`. The middleware finds a verdict (cache, registry for trusted attestors, then the analyzer), quotes promo or standard, and on the paid retry checks the signed payer. After the facilitator settles, it counts the promo against the operator and tells the analyzer the wallet paid; the analyzer publishes that wallet's verdict to the registry, and on mainnet promo claims also asks Nansen.

**ERC-8004 reputation.** The SDK reads `NewFeedback` and `FeedbackRevoked` for the agent, traces each reviewer's first native funder, groups reviewers by funder, and applies the same rule (with S5 context concentration, so a hub-sized funder that dominates an agent still links). It returns raw versus per-operator counts and a one-reviewer-per-operator allowlist for `getSummary`.

**Verification.** `verify(wallet)` reads the published verdict and recomputes it locally from public data; the answer is "match" or the reason it differs. Nothing is sent to an Argus server.

## Trust model

- **Evidence is public and verdicts are deterministic**, so trust is replaced by recomputation.
- **No attestor is special.** The registry is permissionless; consumers choose attestors. The hosted analyzer is one of many possible.
- **Privacy.** The registry never lists a group's members. `operatorId` is `keccak256(chainId, funder, attestorSalt)`, so operator ids cannot be correlated across attestors. Verdicts cover only wallets that paid a seller. Local verification sends no address anywhere.
- **Soft policy.** Linked means shared funding, not wrongdoing; Linked wallets are still served.
- **Two sources.** On mainnet, Nansen independently reports each wallet's first funder; agreement raises confidence, disagreement makes the verdict Unclear.

## Network constants

| | Mainnet (143) | Testnet (10143) |
| --- | --- | --- |
| Argus registry | `0x151e488618FC0F79F7f91447351174Fb8D98cE98` | `0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE` |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| x402 facilitator | `https://x402-facilitator.molandak.org` (both) | |

## Known limits

- Funding is traced through **direct transfers**. A wallet funded through a contract shows no inbound transfer and counts as independent.
- Evasion by funding every wallet from a different source is possible; Argus raises the cost and does not claim proof of personhood.
- Nansen has no Monad testnet, so deep checks run on mainnet only.
- ERC-8004 is a draft standard, and the Validation registry is not yet deployed on Monad mainnet.
- Small self-made test sets show that the method works, not how it performs in the wild; see [EVAL.md](EVAL.md).

## Tests

Contracts 19 (Foundry), scoring 49, SDK 10, analyzer 31, middleware 8, MCP 7, indexer 8 (Vitest; the indexer ones need WSL). The MCP tests connect a real client over an in-memory transport; the indexer tests include runs against real Monad testnet blocks.

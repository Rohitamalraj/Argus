# Argus

Argus spots when many wallets paying an x402 seller belong to one operator, so promos go to real customers.

It finds who first funded each paying wallet, groups wallets seeded by the same non-hub funder, and lets the seller apply one promo per operator instead of one per wallet. Verdicts use only public chain evidence, so every seller gets the same answer, and they are published to an on-chain registry on Monad.

> Status: in development for the Monad Metropolis hackathon (Track 04). See [docs/PRD.md](docs/PRD.md) for the full spec.

## Tiers

| Tier | Meaning | Default policy |
| --- | --- | --- |
| 0 Unclear | No verdict, expired, no funding trace, or a shared funder with no second signal | Standard price |
| 1 Linked | Seeded by the same non-hub funder as 2+ other wallets, plus one more fleet signal | One promo shared by the operator |
| 2 Independent | Funding traced, no shared non-hub funder. Wallet age does not matter | Its own promo |
| 3 Verified | Valid agent credential (planned) | Full promo |

Contracts check an explicit set of allowed tiers (`onlyTiers(attestor, mask)`), never "tier at least N".

## Repository

```text
contracts/            PayerAttestations.sol (registry), ArgusGate.sol, Foundry tests
packages/scoring/     signals S1-S4, hub rule, decision rule, operatorId, evidence hash (pure, no provider code)
scripts/farm-sim/     creates and funds the demo wallets, writes ground-truth labels
fixtures/             public ground-truth labels and recorded provider responses
docs/                 PRD, Day-0 checks
```

Coming next: analyzer service (Envio HyperSync + Nansen providers), x402 middleware, seller demo, Envio indexer, dashboard.

## Development

Requirements: Node 20+, Foundry.

```bash
npm install
npm test                                   # scoring (Vitest) + contracts (Foundry)
cp .env.example .env                       # fill in keys
npm run create -w @argus/farm-sim -- --network testnet
npm run status -w @argus/farm-sim -- --network testnet
```

## Data attribution

Deep checks on Monad mainnet use the Nansen API. Powered by Nansen API.

## AI tool disclosure

This project is built with the help of AI coding tools (Claude Code). All code is written for this hackathon; there is no pre-existing code.

## License

MIT

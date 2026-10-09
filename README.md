# Argus

**Argus tells you whether the wallets in front of you are one operator or many**, so promos go to real customers and reputation counts real reviewers. It is a small primitive for x402 sellers, ERC-8004 agents and the AI agents that use them, built on Monad.

Verdicts use only public chain data, are deterministic, and can be recomputed by anyone: **verify, don't trust**.

## Why

Wallets are free. One operator can run a hundred of them, and anything that counts wallets (a per-wallet promo, a feedback score, a campaign) counts the operator a hundred times. ERC-8004 says as much: unfiltered feedback is open to Sybil attacks, and it expects third parties to supply the reviewer filter.

On Monad mainnet today, ERC-8004 agent #182 has **7,665 feedback entries from 7,665 wallets. One funder first funded every one of them**, and 5,555 received an identical 11 MON within 24 hours. That is one operator. Reproduce it with `npm run argus -w @argus/sdk -- reputation 182`; see [docs/ERC8004.md](docs/ERC8004.md).

## Four ways to use it

| You are | Use | What you get |
| --- | --- | --- |
| An **x402 seller** | [`argus-x402-middleware`](packages/middleware) | Per-payer promo pricing: one promo per operator, not per wallet. Ten lines on your Express route |
| An **AI agent** (Claude Code, any MCP client) | [`argus-x402-mcp`](packages/mcp) | Tools to check a wallet, compare two, verify an attestation, and de-duplicate an ERC-8004 agent's reviews |
| A **developer** | [`argus-x402-sdk`](packages/sdk) + the `argus-x402` CLI | Local verification, ERC-8004 reputation by operator, a reviewer allowlist for `getSummary` |
| A **smart contract** | [`ArgusGate`](contracts/src/ArgusGate.sol) + the registry | `onlyTiers(attestor, mask)`: gate a function by an explicit set of tiers |

Under all of them: [`argus-x402-scoring`](packages/scoring), the pure decision rule.

```ts
// seller: one promo per operator
app.use(argus({ network: 'mainnet', payTo, price: { standard: '$0.01', promo: '$0.005' }, routes: ['GET /api/premium'], attestors: [ARGUS] }));

// developer: how many operators are behind an agent's reviews?
const rep = await createArgus({ network: 'mainnet', hypersyncToken }).agentReputation(182);
rep.raw.distinctClients;   // 7665
rep.independent.operators; // 1
```

```bash
# agent: add the tools to Claude Code (from this repo; see packages/mcp for the npm form)
claude mcp add argus -e ENVIO_API_TOKEN=<token> -- node --import tsx packages/mcp/src/main.ts
```

> **Package status.** The four packages build to plain JavaScript with type declarations (`npm run release:build`) and have been installed and run from a clean folder. Publishing them to npm is the one step left; until then, install from this repo. Step-by-step guides: [docs/INTEGRATE.md](docs/INTEGRATE.md). A free HyperSync token comes from https://envio.dev/app/api-tokens.

## How trust works

- **Public evidence only.** A verdict is built from who first funded a wallet and who else that funder funded. No seller data, no labels, no private lists. Every seller gets the same answer.
- **Deterministic.** The same evidence gives the same verdict ([`packages/scoring`](packages/scoring)). Anyone can re-run it with their own data source.
- **Local verification.** `argus.verify(wallet)` recomputes a published verdict and compares. Nothing is sent to an Argus server, and no wallet address leaves your machine.
- **No single attestor.** The registry stores verdicts per attestor; anyone can attest and each consumer names whom it trusts. The hosted analyzer is one attestor, a convenience and not a dependency.
- **Soft by design.** Linked means shared funding, not wrongdoing. A Linked wallet is still served, at the standard price.

## The rule

A wallet is **Linked** when its first funder is not a hub and funded at least three wallets (S1), plus one more fleet signal: identical instalments (S2), same-day activity (S3), money flowing back to the funder (S4), or the funder dominating a context set such as one agent's reviewers (S5). It is **Independent** when funding is traced and S1 is false, and **Unclear** otherwise. A shared funder alone never links wallets; exchanges, bridges and faucets (hubs) never link anyone; wallet age is never an input.

| Tier | Default policy |
| --- | --- |
| 0 Unclear | Standard price |
| 1 Linked | One promo for the whole operator |
| 2 Independent | Its own promo |
| 3 Verified | Reserved for agent credentials |

## Live on Monad

| | Mainnet (143) | Testnet (10143) |
| --- | --- | --- |
| `PayerAttestations` registry | [`0x151e…cE98`](https://monadvision.com/address/0x151e488618FC0F79F7f91447351174Fb8D98cE98) | [`0xd60E…B8dE`](https://testnet.monadvision.com/address/0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE) |
| Demo | 13 wallets resolve to 4 customers (Nansen cross-checked) | Same, with a one-click simulation |

The website in `apps/dashboard` is the demo and documentation front end: a dashboard of customers versus wallets, and an Agents page that runs the ERC-8004 analysis.

## Repository

```text
contracts/            PayerAttestations registry, ArgusGate (Foundry)
packages/scoring/     the decision rule: pure functions, no network
packages/sdk/         chain providers, local verification, ERC-8004 reputation, CLI
packages/middleware/  x402 Express middleware
packages/mcp/         MCP server for AI agents
services/analyzer/    the hosted attestor: batching, Nansen deep check, publisher, API
indexer/              Envio HyperIndex: verdicts, seller payments, ERC-8004 feedback
apps/dashboard/       demo and docs site (Next.js)
apps/seller-demo/     a demo x402 seller
scripts/              demo wallets, release build, deployment
docs/                 ARCHITECTURE, INTEGRATE, ERC8004, NANSEN, DAY0, PRD
```

## Develop

Node 20+ and Foundry. Envio's indexer needs Linux or WSL 2.

```bash
npm install
npm test                                  # scoring, sdk, analyzer, middleware, mcp (Vitest) + contracts (Foundry)
npm run release:build                     # build the four npm packages into release/ (publishes nothing)
cp .env.example .env                      # fill in keys
npm run argus -w @argus/sdk -- reputation 182
```

## Sponsors and data

- **Envio**: HyperSync reads every funding graph; HyperIndex indexes verdicts, seller payments and ERC-8004 feedback ([indexer/](indexer)).
- **Nansen**: deep checks on Monad mainnet promo claims, cross-checking the first funder. See [docs/NANSEN.md](docs/NANSEN.md). Powered by Nansen API.
- **Dynamic**: planned signer for registry writes.
- **Monad**: settlement, the registry, x402 through the Monad facilitator, and the ERC-8004 registries.

## AI tool disclosure

Built with the help of AI coding tools (Claude Code). All code was written for this hackathon; there is no pre-existing code.

## License

MIT

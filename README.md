# Argus — Sybil protection for AI agent payments, promos and reviews on Monad

> Argus spots one person hiding behind many wallets, so each customer gets one promo and each review counts once.

---

## The Problem in One Sentence

Wallets are free, so anything that counts wallets (a per-wallet promo, a feedback score, a settlement count) counts one operator a hundred times — and on Base **84.98% of x402 settlements are operator-internal**, while on Monad ERC-8004 agent #182's **7,665 reviewers trace to one funder**.

---

## Why This Matters — Market Context

| Metric | Value | Source |
|---|---|---|
| Base x402 settlements, 17 Sep 2025 – 23 Jun 2026 | **136,708,672** worth **$44.1M** | [Ling et al., arXiv 2607.12575](https://arxiv.org/pdf/2607.12575) |
| Provably fictitious (self-payment or closed loop) | **21.20%** of settlements, **54.08%** of value | same |
| Internal to a funding-linked cluster | **63.78%** of settlements | same |
| Operator-internal in total | **84.98%** (72.38% under the most generous grading) | same |
| Payers as wallets vs as operators | **112 wallets** reach half of settlements; only **3 operators** do | same |
| Cost to fake the whole count | about **$355,583** in gas, paid by facilitators | same |
| Reported vs on-chain vs wash-filtered volume (30 days) | **$24M** vs about **$3M** vs **$1.6M** | [a16z crypto, 11 Mar 2026](https://a16zcrypto.com/posts/article/ai-agent-payments-honest-number) |
| Honest size of agent commerce, Aug 2026 | about **2.2 million** payments a month; the median Base seller earned **$2.50** | [Bitquery, 6 Sep 2026](https://bitquery.io/investigations/x402-ai-agent-payments-audit) |
| ERC-8004 on Monad mainnet, agent #182 | **7,665** feedback entries from **7,665** wallets → **1 operator** | measured by Argus, [reproduce below](#end-to-end-test-flow) |

**The gap is structural.** The researchers conclude that settlement count measures how cheap it is to manufacture activity, not adoption. Facilitators pay the gas, so one more settlement costs an operator almost nothing. And ERC-8004 says as much about reputation: unfiltered feedback is open to Sybil and spam attacks, and the spec expects third parties to supply the reviewer filter.

**The real-world cost:** at $0.01 a call, a half-price promo is worth about $0.50 per wallet, so one seller loses little. What a seller cannot do is know how many real customers it has, which prices work, or who churned. Public x402 indices rank services by transaction count, so the count is also what gets rewarded.

---

## Three Layers of the Problem

### 1. Promos Are Per Wallet, Wallets Are Free
A free tier, a first-calls discount or a rate limit is only as strong as the cost of a new wallet. An x402 payer needs no gas token, because the Monad facilitator pays it, so a new wallet costs almost nothing:
- Ten wallets from one operator claim ten promos
- Per-wallet rate limits are multiplied the same way
- The seller's customer count is inflated by the same factor

### 2. Reputation Counts Reviewers, Not Operators
ERC-8004 gives agents an on-chain reputation registry. Every review is one wallet:
- One operator funds 7,665 wallets, each leaves one review
- The summary reads "7,665 reviewers" — it is one
- An agent's own owner can fund its own reviewers, so the praise is self-dealing

### 3. The Tools That Exist Don't Fit the Moment
Identity schemes (World AgentKit, Visa TAP, Skyfire) need the agent to register first, and cover only the agents that opt in. Analytics (Ling et al., Artemis, Bitquery) measure the ecosystem after the fact. A seller deciding on a first paid request needs an answer **now, about an anonymous wallet, with no opt-in**.

---

## The Solution — Argus on Monad

Argus reads who **first funded** a wallet and who else that funder funded, applies one deterministic rule, and returns a verdict anyone can recompute.

```
Without Argus (today):
  10 wallets, one operator   → 10 promos handed out
  7,665 reviewers            → "7,665 reviewers" on the agent's score
  → the count measures how cheap wallets are

With Argus:
  first funder + sibling wallets + 4 fleet signals (public chain data)
  → Tier: Linked        one promo for the whole operator
  → Tier: Independent   its own promo
  → agent #182: 7,665 reviewers = 1 operator, 100% funded by the agent's own owner
  → anyone can re-run it:  argus.verify(wallet)  →  MATCH
```

The verdict is **soft by design**: Linked means shared funding, not wrongdoing, and a Linked wallet is still served at the standard price. **Verify, don't trust**: nothing is sent to an Argus server, and a published verdict can be recomputed locally against the chain.

---

## What Makes Argus Unique

| Approach | Needs opt-in? | Per-request, seller-side | Anonymous wallets | Shared across sellers | ERC-8004 reviewers |
|---|---|---|---|---|---|
| World AgentKit | ✅ verify in World App | ✅ | ❌ unregistered = ordinary | ✅ | ❌ |
| Visa TAP / Skyfire KYAPay | ✅ registry or issuer | ✅ | ❌ | ❌ | ❌ |
| Analytics (Ling et al., Artemis, Bitquery) | ❌ | ❌ after the fact | ✅ | n/a | ❌ |
| Per-wallet rate limits / WAF | ❌ | ✅ | ✅ | ❌ trivially multiplied | ❌ |
| Wallet intelligence (Nansen) | ❌ | via API | ✅ | ❌ raw data, labels can't be redistributed | ❌ |
| **Argus** | **❌ none** | **✅** | **✅** | **✅ same verdict for every seller** | **✅** |

**Three capabilities no other tool combines:**
1. **No opt-in, no registry** — works on anyone who pays, from public funding evidence alone
2. **Verifiable by anyone** — the rule is a pure function; `verify(wallet)` recomputes any published verdict, and the registry stores verdicts per attestor so no single party is trusted
3. **One rule across x402 and ERC-8004** — the same operator test protects a seller's promo and an agent's reputation, and flags an owner funding its own reviewers

Argus is the complement of identity credentials, not a replacement: it does not beat proof-of-personhood where that applies, and a patient attacker who funds every wallet from a different source passes — at a higher cost.

---

## Live Demo

| | |
|---|---|
| **Website** | <https://argus-mu-one.vercel.app> |
| **Demo store** | <https://argus-mu-one.vercel.app/store> — a real x402 seller running the middleware: get a live quote for any wallet, buy with your own wallet, and watch real promo claims settle on Monad testnet |
| **Agents page** | <https://argus-mu-one.vercel.app/agents?agent=182&network=mainnet> — 7,665 reviewers collapse to 1 operator |
| **Dashboard** | <https://argus-mu-one.vercel.app/dashboard> — press *Run simulation*: 13 wallets make real x402 payments on Monad testnet and resolve to 4 customers (about 30 s) |
| **Analyzer API** | <https://argus-analyzer.onrender.com/health> (free host: the first request after idle takes about a minute) |

No wallet, keys or funds are needed to try it. Testnet verdicts shown on the dashboard are published on-chain by a **Dynamic MPC wallet**.

---

## Technical Architecture

### System Overview

```
┌──────────────────────── Who uses it ─────────────────────────────┐
│  x402 seller          AI agent (MCP)        Developer / contract │
│  Express/Hono/Next    Claude Code, etc.     SDK, CLI, ArgusGate  │
└───────┬───────────────────┬──────────────────────┬───────────────┘
        │                   │                      │
        ▼                   ▼                      ▼
┌──────────────────── Argus packages (npm) ────────────────────────┐
│  argus-x402-middleware   per-payer promo pricing, 3 frameworks   │
│  argus-x402-mcp          4 read-only tools for agents (stdio)    │
│  argus-x402-sdk          local verify, ERC-8004 reputation, CLI  │
│  argus-x402-scoring      the decision rule (pure, no network)    │
└───────┬──────────────────────────────────────────┬───────────────┘
        │ funding evidence                          │ verdicts
        ▼                                           ▼
┌── Envio HyperSync ──┐   ┌── Monad mainnet / testnet ────────────┐
│ USDC + native MON   │   │ PayerAttestations registry            │
│ transfers, raw logs │   │  (wallet, attestor) → tier, expiry    │
│ ERC-8004 feedback   │   │ ERC-8004 Identity + Reputation        │
└─────────▲───────────┘   │ x402 facilitator settles payments     │
          │               └───────────────▲───────────────────────┘
┌── Envio HyperIndex ──┐                  │ attestBatch
│ verdicts, payments,  │   ┌── Analyzer (one attestor) ────────────┴─┐
│ ERC-8004 feedback    │   │ batches wallets, pre-computes fleets,   │
└──────────────────────┘   │ Nansen deep check, publishes verdicts   │
                           │ signs with a Dynamic MPC wallet         │
                           └─────────────────────────────────────────┘
```

The analyzer is **one attestor, a convenience and not a dependency**: a seller can run fully local (`localResolver`) and read the registry from any attestor it chooses to trust.

---

## How Each Building Block Is Used

### 1. The Decision Rule (`argus-x402-scoring`)

A wallet is **Linked** when its first funder is not a hub and funded at least three wallets (S1), plus at least one more fleet signal:

| Signal | Meaning |
|---|---|
| **S1** shared first funder | Funder is not a hub and first funded ≥ 3 wallets |
| **S2** identical instalments | Same amount (within 1%) to several wallets within 24 h |
| **S3** same-day activity | The wallets first acted on the same UTC day |
| **S4** value closure | Money flows back to the funder or between the wallets |
| **S5** context concentration | The funder first funded ≥ 50% (and ≥ 10) of one context set, e.g. one agent's reviewers — even if hub-sized |

A shared funder alone never links wallets. Hubs (exchanges, bridges, faucets) never link anyone: a known list, or more than 200 recipients of at least 0.10 USDC. **Wallet age is never an input**, so a genuine new customer is Independent on day one.

| Tier | Default policy |
|---|---|
| 0 Unclear | Standard price |
| 1 Linked | One promo for the whole operator |
| 2 Independent | Its own promo |
| 3 Verified | Reserved for agent credentials |

### 2. x402 on Monad — `argus-x402-middleware`

Ten lines on an Express route (Hono: `/hono`, Next.js App Router: `/next`). The middleware quotes each payer the promo or the standard price, enforces it against the **signed** payer on the paid retry, and counts the promo against the operator only after the payment settles.

```ts
app.use(argus({
  network: 'mainnet', payTo,
  price: { standard: '$0.01', promo: '$0.005' },
  routes: ['GET /api/premium'],
  attestors: [ARGUS],               // or: resolver: localResolver(createArgus({...})) — no Argus server at all
}));
```

Fail-open by design: a lookup never makes a request wait, and promo counters survive restarts (`FilePromoStore`).

### 3. ERC-8004 Reputation — `argus-x402-sdk`

```ts
const rep = await createArgus({ network: 'mainnet', hypersyncToken }).agentReputation(182);
rep.raw.distinctClients;   // 7665 reviewers
rep.independent.operators; // 1
rep.ownerLinked;           // { operators: 1, clients: 7665, share: 1 } — the owner funded its own reviewers
rep.clientAllowlist;       // one reviewer per operator → getSummary(agentId, clientAddresses, '', '')
```

- Reviewers first funded by the same non-hub funder are one operator; **contract reviewers are grouped by deployer**
- Reviewers funded by (or equal to) the agent's own **owner** are flagged `ownerLinked` and left out of the allowlist
- The allowlist plugs straight into the registry's own `getSummary`, which was built to take a reviewer filter

### 4. On-Chain Gate — `ArgusGate`

```solidity
contract Rewards is ArgusGate {
    constructor(PayerAttestations r) ArgusGate(r) {}
    // allow Independent (2) and Verified (3): bitmask, never relies on tier order
    function claim() external onlyTiers(ARGUS_ATTESTOR, (1 << 2) | (1 << 3)) { /* ... */ }
}
```

`PayerAttestations` stores verdicts per `(wallet, attestor)` with a 7-day expiry; each consumer names whom it trusts.

### 5. Agents — `argus-x402-mcp`

```bash
claude mcp add argus -e ENVIO_API_TOKEN=<token> -- npx -y argus-x402-mcp
```

Four read-only tools: `argus_check_wallet`, `argus_same_operator`, `argus_agent_reputation`, `argus_verify_attestation`.

### 6. Envio — HyperSync + HyperIndex

- **HyperSync** reads every funding graph: USDC transfers for x402 payers, native MON for ERC-8004 reviewers, raw `NewFeedback` logs. Early-stop queries, batching and 429 backoff keep a 7,665-reviewer agent to 49 queries.
- **HyperIndex** ([`indexer/`](indexer)) indexes verdicts, seller payments and ERC-8004 feedback into `Verdict`, `Operator`, `SellerPayment`, `Payer`, `SellerStats`, `Agent` and `AgentClient`. The Agents page reads it; its totals match the SDK's (agent #182: 7,665 reviewers).

### 7. Nansen — second source for the first funder

On Monad mainnet promo claims, the analyzer cross-checks the first funder with Nansen's Profiler endpoints (API key first, optional x402 pay-per-call, daily budget and circuit breaker, token matched by contract address, not symbol). On the 13-wallet mainnet set, **Nansen agreed on 13 of 13 first funders**. Details: [docs/NANSEN.md](docs/NANSEN.md).

### 8. Dynamic — the attestor key lives in an MPC wallet

The analyzer can sign `attestBatch` through a **Dynamic server (MPC) wallet**, so the host holds no raw private key. Verified live on Monad testnet: a verdict signed by the Dynamic wallet and published to the registry ([`0x7eeb2d70…bb19`](https://testnet.monadvision.com/tx/0x7eeb2d70a7ce6854ac497fceb6a4507edeea9e65a1195e39f69b535e969cbb19)). Setup: [docs/DEPLOY.md](docs/DEPLOY.md).

---

## Full Flow — Sequence Diagrams

### x402 Request With a Promo

```mermaid
sequenceDiagram
    actor Buyer
    participant Seller as Seller (argus middleware)
    participant Reg as PayerAttestations (Monad)
    participant Az as Analyzer / localResolver
    participant HS as Envio HyperSync
    participant Fac as x402 Facilitator

    Buyer->>Seller: GET /api/premium  (X-Payer-Address)
    Seller->>Seller: verdict cache?
    Seller->>Reg: tierOf(wallet, trusted attestor)
    alt no published verdict
        Seller->>Az: assess(wallet)  (background, never blocks)
        Az->>HS: first funder + sibling wallets + fleet signals
        HS-->>Az: transfers
        Az-->>Seller: Linked / Independent + reasons
    end
    Seller-->>Buyer: 402 + price (promo or standard) per operator
    Buyer->>Seller: retry with signed payment
    Seller->>Seller: signed payer must equal claimed payer
    Seller->>Fac: verify + settle
    Fac-->>Seller: settled (gas paid by facilitator)
    Seller->>Seller: count the promo against the operator
    Seller-->>Buyer: 200 + resource
```

### ERC-8004 Reputation by Operator

```mermaid
sequenceDiagram
    actor Dev as Developer / AI agent
    participant SDK as argus-x402-sdk
    participant HS as Envio HyperSync
    participant Id as ERC-8004 Identity registry
    participant Rep as ERC-8004 Reputation registry

    Dev->>SDK: agentReputation(182)
    SDK->>HS: NewFeedback / FeedbackRevoked logs
    SDK->>Id: ownerOf, getAgentWallet, tokenURI
    SDK->>HS: first MON funder of every reviewer
    SDK->>HS: contract reviewers → deployer
    SDK->>SDK: group by funder / deployer, apply the rule (S1–S5)
    SDK->>SDK: flag operators funded by the agent's owner
    SDK-->>Dev: operators, ownerLinked share, clientAllowlist
    Dev->>Rep: getSummary(agentId, clientAllowlist, "", "")
    Rep-->>Dev: reputation over independent reviewers
```

### Verify, Don't Trust

```mermaid
sequenceDiagram
    actor Anyone
    participant SDK as argus.verify(wallet)
    participant Reg as PayerAttestations
    participant HS as Envio HyperSync

    Anyone->>SDK: verify(wallet, attestor)
    SDK->>Reg: published tier + expiry
    SDK->>HS: public funding history
    SDK->>SDK: recompute the verdict locally (pure rule)
    SDK-->>Anyone: MATCH — or exactly what differs
    note over SDK: Nothing is sent to an Argus server
```

---

## Results — Measured on Monad

All numbers are from runs on Monad testnet and mainnet during the hackathon, reproducible with the commands in [docs/EVAL.md](docs/EVAL.md). The sets are small and partly self-made; the limits are listed in [Honest Limits](#honest-limits).

| Set | Result |
|---|---|
| Controlled 10-wallet farm, testnet and mainnet | **10 of 10 Linked**, one operator, high confidence |
| New independents (faucet, bridge payout, DEX purchases) | **6 of 6 Independent** (wallet age never matters) |
| The 13-wallet demo | **13 wallets → 4 customers**, 13 of 13 correct, 3–5 s |
| Nansen second source, mainnet | **13 of 13** first funders agree with HyperSync |
| Hub fixtures: 250 recipients; 30 faucet wallets; dust-sprayed funder | **0 merged**; farm still Linked under dust |
| **Mainnet end-to-end run** | 12 funded wallets made **36 real x402 payments**; the 10 farm wallets resolved to one operator and the independents to Independent, verdicts published on-chain; `verify` MATCH on a farm wallet and an independent |
| ERC-8004 agent #182 | 7,665 reviewers → **1 operator**, 100% funded by the agent's own owner |
| ERC-8004 agents #158, #154, #157 | 4 contract reviewers each → **1 operator** (one deployer) |

---

## Deployed — Monad

| | Mainnet (143) | Testnet (10143) |
|---|---|---|
| `PayerAttestations` registry | [`0x151e488618FC0F79F7f91447351174Fb8D98cE98`](https://monadvision.com/address/0x151e488618FC0F79F7f91447351174Fb8D98cE98) | [`0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE`](https://testnet.monadvision.com/address/0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE) |
| Analyzer attestor | `0xF9E8A2cc9600499AA009357a8Fa63F15079A4238` | `0x6E7A4132c27248F56B4aEeE2513d6655370a323b` |
| Dynamic MPC attestor wallet | — | `0xe5Dc8e2eF8963C9cE8248E761D88419C4A7B51a9` |
| ERC-8004 Identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |

**Envio HyperIndex (GraphQL):** `https://indexer.dev.hyperindex.xyz/6cd5bf1/v1/graphql`
**x402 facilitator:** `https://x402-facilitator.molandak.org`

### On npm

| Package | Version |
|---|---|
| [`argus-x402-scoring`](https://www.npmjs.com/package/argus-x402-scoring) | 0.1.1 |
| [`argus-x402-sdk`](https://www.npmjs.com/package/argus-x402-sdk) | 0.2.0 |
| [`argus-x402-middleware`](https://www.npmjs.com/package/argus-x402-middleware) | 0.2.0 |
| [`argus-x402-mcp`](https://www.npmjs.com/package/argus-x402-mcp) | 0.1.2 |

Installed from the registry in a clean folder and run against live Monad. Step-by-step guides: [docs/INTEGRATE.md](docs/INTEGRATE.md).

---

## Repository Structure

```
Argus/
├── contracts/                  # Foundry — registry + gate
│   ├── src/PayerAttestations.sol    # verdicts by (wallet, attestor), 7-day expiry
│   ├── src/ArgusGate.sol            # onlyTiers(attestor, mask) for consumers
│   └── script/Deploy.s.sol
│
├── packages/
│   ├── scoring/                # the decision rule: pure functions, no network
│   ├── sdk/                    # HyperSync providers, local verify, ERC-8004 reputation, CLI
│   │   └── src/{reputation,identity,argus,local-resolver,cli}.ts
│   ├── middleware/             # x402 pricing: Express, /hono, /next on a shared core
│   └── mcp/                    # MCP server for AI agents (stdio)
│
├── services/analyzer/          # the hosted attestor
│   └── src/                    # batching, Nansen deep check, publisher, Dynamic signer, API
│
├── indexer/                    # Envio HyperIndex
│   ├── config.yaml             # registry, USDC, ERC-8004 reputation
│   ├── schema.graphql          # Verdict, Operator, SellerPayment, Agent, AgentClient, ...
│   └── src/handlers/
│
├── apps/
│   ├── dashboard/              # demo + docs site (Next.js): customers vs wallets, Agents page
│   └── seller-demo/            # a demo x402 seller
│
├── scripts/                    # demo wallets, release build, deployment, mainnet run
├── docs/                       # ARCHITECTURE, INTEGRATE, ERC8004, EVAL, NANSEN, DEPLOY, DESIGN
└── .github/workflows/ci.yml    # typecheck, tests, release build, forge test
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity 0.8.24, Foundry |
| Chain data | Envio HyperSync (USDC, native MON, raw logs), HyperIndex |
| Payments | x402 v2 (`@x402/core`, `/evm`, `/express`, `/hono`, `/next`), Monad facilitator |
| Agents | `@modelcontextprotocol/sdk`, ERC-8004 Identity + Reputation |
| Wallet intelligence | Nansen API (Profiler), x402 pay-per-call |
| Signing | Dynamic Node SDK (MPC server wallet) |
| Language / tooling | TypeScript, viem, tsup, Vitest, zod |
| Dashboard | Next.js 16, React 19 |
| Network | Monad mainnet (143) and testnet (10143) |

---

## Local Setup

### Prerequisites

- Node.js 20+ and [Foundry](https://book.getfoundry.sh/) (for the contracts)
- A free HyperSync token: <https://envio.dev/app/api-tokens>
- The Envio indexer and Dynamic's native MPC library need Linux or WSL 2

### Install and test

```bash
npm install
npm test            # scoring 51, sdk 28, middleware 22, analyzer 32, mcp 7, contracts 19
```

### Try it with no setup beyond a token

```bash
export ENVIO_API_TOKEN=...
npx -p argus-x402-sdk argus-x402 reputation 182     # 7,665 reviewers → 1 operator (add --sample 800 for speed)
npx -p argus-x402-sdk argus-x402 check 0x971E94Fed75A8f527566206E68D85e52F050C6D1   # a Linked wallet
npx -p argus-x402-sdk argus-x402 verify 0x971E94Fed75A8f527566206E68D85e52F050C6D1  # published vs recomputed: MATCH
```

### Environment

Copy `.env.example` to `.env` and fill it in. The ones that matter:

```env
ENVIO_API_TOKEN=          # HyperSync
NANSEN_API_KEY=           # optional deep check (mainnet)
DYNAMIC_ENVIRONMENT_ID=   # optional: sign attestations through Dynamic
DYNAMIC_API_TOKEN=
PUBLISH_MAINNET=false     # mainnet publishing spends real MON; off unless switched on
```

> Never commit `.env` or `wallets.*.json` (both are gitignored). Mainnet keys never go on a host: see [docs/DEPLOY.md](docs/DEPLOY.md).

### Run the demo locally

```bash
npm run dev -w @argus/analyzer           # attestor + API on :8787
npm start  -w @argus/seller-demo         # demo x402 seller on :4021
npm run dev -w @argus/dashboard          # website on :3000
```

---

## End-to-End Test Flow

1. **Agent reputation** — `argus-x402 reputation 182`: 7,665 reviewers collapse to **1 operator**, and the owner-funded line shows the owner funded 100% of the sampled reviewers
2. **A Linked wallet** — `argus-x402 check 0x971E…C6D1`: first funder also seeded 9 other wallets, identical 0.20 USDC amounts within 13 s
3. **An Independent wallet** — `argus-x402 check 0x429D…6436`: first funder is a known hub (the Uniswap pool), so it never links anyone
4. **Verify, don't trust** — `argus-x402 verify` on both: the published on-chain verdict is recomputed locally from public data and returns **MATCH**
5. **Seller flow** — run the demo seller, then `npm run pay -w @argus/farm-sim -- --network testnet`: 13 wallets pay, the 10 farm wallets share one promo allowance, the independents get their own
6. **Agent flow** — add the MCP server to Claude Code and ask *"Is agent 182's reputation real?"*; it calls `argus_agent_reputation` and answers from chain data

---

## Honest Limits

- **No labelled data from the wild.** Precision on real operators is unknown: the farm is ours, and the only independents are wallets we also created (their funders are public hubs). The negative control (12 random active mainnet accounts, all Independent) is in [docs/EVAL.md](docs/EVAL.md).
- **A determined evader wins.** Funding every wallet from a different source defeats a funding-graph rule. Argus raises the cost; it is not proof of personhood.
- **Direct transfers only.** A wallet funded through a contract has no inbound transfer to trace. HyperSync returns no internal-transfer traces for Monad, so those wallets count as independent; contract *reviewers* are grouped by deployer instead.
- **A shared funder is a clue, not proof.** Legitimate platforms fund many agent wallets from one treasury, which is why the policy is soft and a Linked wallet is still served.
- **S5 is a judgement call.** The 50% and 10-wallet thresholds are defaults to tune, not findings.
- **Agent #182 may be benign.** Its tags (`eve`, `spawn`, `plague`) suggest a game or simulation. Shared funding is not wrongdoing; it does mean the reviewers are one operator.

---

## Repository Notes

- Verdicts use **public chain data only**; every seller gets the same answer for the same wallet
- The hosted analyzer holds a **testnet** signer (or a Dynamic wallet); mainnet publishing is off unless `PUBLISH_MAINNET=true`
- The Docker, Render and Vercel files (`Dockerfile`, `render.yaml`, [docs/DEPLOY.md](docs/DEPLOY.md)) are written but not yet exercised on a real host
- Built with the help of AI coding tools (Claude Code). All code was written for this hackathon; there is no pre-existing code

---

## Acknowledgements

- [Monad](https://monad.xyz) — settlement, the x402 facilitator, the ERC-8004 registries
- [Envio](https://envio.dev) — HyperSync and HyperIndex
- [Nansen](https://nansen.ai) — wallet intelligence (powered by Nansen API)
- [Dynamic](https://dynamic.xyz) — MPC server wallets
- [Ling et al., *How Agentic Is Agentic Commerce?*](https://arxiv.org/pdf/2607.12575) — the measurements and the clustering method this builds on
- [x402](https://x402.org), [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004), [Model Context Protocol](https://modelcontextprotocol.io)

---

## License

MIT

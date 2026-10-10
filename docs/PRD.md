# Argus PRD v2.0 (final)

> **Historical design record (v2.0, 8 Oct 2026).** This is the plan the build started from. The project has since been repositioned as a primitive other builders and agents call, and several parts below are out of date:
>
> - Argus now ships as four npm packages (`argus-x402-scoring`, `-sdk`, `-middleware`, `-mcp`), an MCP server for agents, an x402 middleware, a registry contract and an optional analyzer. The dashboard is a demo of these, not the product.
> - ERC-8004 reputation analysis (reviewers grouped by operator, owner self-dealing flagged) is part of the product; this PRD predates it.
> - Verdicts can be recomputed locally from public chain data, with no Argus server (`localResolver`).
> - The signal set gained S5 (context concentration), and the Verified tier and investigator flow described here are not built.
>
> Current sources of truth: [README](../README.md), [ARCHITECTURE](ARCHITECTURE.md), [ERC8004](ERC8004.md), [INTEGRATE](INTEGRATE.md), [EVAL](EVAL.md).


Oct 8, 2026 · @Rohit

## Summary

Argus tells an x402 seller on Monad whether a paying wallet is its own customer or one of an operator's fleet, so the seller gives one promo per operator and reports an honest customer count. It is a middleware, an analyzer and a Monad registry that other developers build on.

**One line:** know your customer's wallets without knowing your customer.

**Where it competes:** Monad Metropolis Track 04 (Trust, Identity and AI Infrastructure), the Nansen "Best use of Nansen" bounty, and the Envio and Dynamic bounties where they improve the product. Everything closes on 14 Oct 2026, 09:29 IST (13 Oct, 11:59 PM ET). We submit on the evening of 13 Oct.

**This version is final.** It replaces PRD v1.0 and the build plan in the earlier Dev and Pitch Brief. The Brief stays the source for the pitch script and judge Q&A, updated by the changes below. Requirements carry IDs such as `MW-1`; **P0** must ship, **P1** should ship, **P2** could ship.

### What changed from v1.0, and why

v1.0 had six design clashes that would have broken the demo or the product. Each is fixed below, and the rest of this PRD is written to the fixed design.

| # | Clash in v1.0 | What would have gone wrong | Fix in v2.0 |
| --- | --- | --- | --- |
| 1 | **The 7-day rule.** A wallet counted as Independent only after 7 days of activity | Demo wallets made on 8 Oct are 5 days old at submission, so the 3 real customers would show as Unclear. Worse, a genuine new customer is never 7 days old, so no new customer could ever get the promo | Rule removed. A wallet with no shared funder and a traceable funding source is Independent on day one. Age is no longer a condition |
| 2 | **Tier numbers out of order.** 0 Unclear, 1 Independent, 2 Linked, 3 Verified | A contract check of "tier at least 1" would let Linked wallets through | Renumbered to 0 Unclear, 1 Linked, 2 Independent, 3 Verified. The contract gate also takes an explicit list of allowed tiers, so it never relies on number order |
| 3 | **Verdicts depended on one seller's view.** "Linked" meant "shares a funder with other wallets paying this seller" | A fleet that mostly pays Seller B looks independent at Seller A, and that wrong verdict is then shared with B | The published verdict uses only public chain evidence about the wallet and its funder, so it is the same for every seller. Seller-only signals (call timing, payee share) stay private hints and never change the tier |
| 4 | **Farm wallets each got a free first call.** Every new wallet got one promo call before its verdict existed | Already budgeted, but avoidable | When the analyzer finds a fleet, it pre-computes verdicts for every wallet that funder seeded. Later fleet wallets are recognised on their first call. Expected leak: 1 call instead of 10 |
| 5 | **Only promo claimers were checked.** v1.0 assessed a wallet only when it claimed a promo | The dashboard's honest customer count would miss every wallet that never claimed one | Two levels of check: a free chain-data check for every paying wallet (feeds the count), and the paid Nansen check only on promo claims |
| 6 | **The judge "Run simulation" button created and funded new wallets** | The testnet USDC faucet gives 1 USDC per 2 hours, so the button would run dry after one or two judges | The button replays a pre-built testnet scenario: pre-funded wallets send real calls at 0.001 USDC each and the analysis runs live. The seller wallet recycles the funds |

Smaller fixes: the custodial (large funder) test uses a recorded fixture of 250 recipients plus real faucet-funded wallets, instead of funding 200+ wallets by hand. Every unverified fact now has a fallback in the Day-0 checklist, so none of them can block the build. The registry is deployed on both networks, so mainnet evidence is never published on testnet. The two dropped Nansen endpoints (`first-funder`, `current-balance`) are not needed by any signal.

### Decision log

| # | Decision | Choice | Why |
| --- | --- | --- | --- |
| 1 | Track | Track 04, as a primitive (registry, middleware, SDK) | Track 04 asks for infrastructure others build on |
| 2 | Core idea | Group paying wallets into operators; one promo per operator | A specific user, a specific moment, sourced evidence of the problem |
| 3 | What a verdict is based on | Public chain evidence only, the same for every seller | A shared verdict must not depend on who asked |
| 4 | Wallet age | Not a condition for any tier | New customers are exactly who promos are for |
| 5 | Policy | Soft: Linked wallets share one promo and are always served | A shared funder is a clue, not proof |
| 6 | Tier order | 0 Unclear, 1 Linked, 2 Independent, 3 Verified; gates use explicit tier lists | No check can let a Linked wallet through by number order |
| 7 | Evidence sources | Envio HyperSync (free, both networks) for funding groups; Nansen (mainnet, paid) for the promo decision and cross-checks | The judge demo needs a free path, and Nansen stays in the decision |
| 8 | Trust model | No attestor allowlist; each seller picks whom to trust | Avoids recentralizing the problem |
| 9 | Networks | Nansen and its payments on mainnet; everything else on testnet; registry on both | Free judge demo; mainnet verdicts stay on mainnet |
| 10 | Nansen data | Only endpoints that allow redistribution; no labels or smart-money data | Nansen's guidelines also cover derived data |
| 11 | Positioning | Complement to World AgentKit and KYA, not a replacement | Their guarantee is stronger for agents that opt in |
| 12 | Sponsors | Nansen (core), Envio (core), Dynamic (gated on a Day-0 test), Chainlink CRE (cut), Aurora (skip), Mera (cut) | Each integration must make the product better |
| 13 | Budget | About $11 of real funds, $20 ceiling, most of it recoverable | See costs |

## Problem and evidence

Most x402 activity comes from wallets controlled by a few operators, and the per-wallet rules sellers use (promos, free tiers, limits) cost almost nothing to multiply.

### Problem statements

- **P1. Customers are invisible.** A seller sees wallet addresses, not customers, and cannot tell an independent buyer from one operator's fleet.
- **P2. Per-wallet rules are cheap to defeat.** An x402 payer needs no gas token because the Monad facilitator pays it, so a new wallet costs almost nothing.
- **P3. Headline metrics can be manufactured.** Settlement count is cheap to inflate, and public indices and some tokens reward it.
- **P4. Identity tools cover only opt-in agents.** World AgentKit or KYA credentials work when an agent registers. Most paying wallets have not.

### Evidence

| Finding | Figure | Source |
| --- | --- | --- |
| Base x402 settlements, 17 Sep 2025 to 23 Jun 2026 | 136,708,672 worth $44,121,383.81 | [Ling et al., arXiv 2607.12575](https://arxiv.org/pdf/2607.12575) |
| Provably fictitious (self-payment or closed loop) | 21.20% of settlements, 54.08% of value | same |
| Internal to a funding-linked cluster | 63.78% of settlements | same |
| Operator-internal in total | 84.98%; 72.38% under the most generous grading | same |
| Value not provably manufactured | at most $20.26M (45.92%); only $187,861 reaches a nameable catalog service | same |
| Wallets vs operators | 112 wallets reach half of settlements; 3 operators do | same |
| Advertised supply | 25,163 Base listings resolve to 811 recipients; 249 ever earned $10 or more | same |
| Cost to reproduce the whole count | about $355,583 in gas, paid by facilitators | same |
| Volume reported vs onchain vs wash-filtered (30 days) | $24M vs about $3M vs $1.6M | [a16z crypto, 11 Mar 2026](https://a16zcrypto.com/posts/article/ai-agent-payments-honest-number) |
| August 2026 settlements on five EVM chains | 18.3M payments, $2.6B; 88% of the money is one bridge contract | [Bitquery, 6 Sep 2026](https://bitquery.io/investigations/x402-ai-agent-payments-audit) |
| Agent payments, August 2026 | about $57,000 moved by agents on Base and Polygon | same |
| Honest size of agent commerce | about 2.2 million payments a month; the median Base seller earned $2.50 | same |
| Funding fingerprints | one fleet seeded in identical 50 or 40 USDC amounts; 20 relay wallets funded in identical instalments | Ling et al.; Bitquery |

The paper's authors conclude that settlement count measures how cheap manufacturing is, not adoption.

### What the research says about detection

- **Signals that work:** a shared bespoke funder, identical funding amounts, synchronized activation, value flowing back to a hub, and a flat hour-of-day clock.
- **Signals that mislead:** automation, periodicity and dust-sized payments, because genuine agents show all three.
- **Funding is not proof.** Custodial agent-wallet platforms fund many wallets from one treasury, so a shared funder is necessary evidence, not sufficient.
- **Hubs must be held out.** Exchanges, bridges and relayers fund many unrelated wallets and must never merge them.

### Cost of the problem for one seller

At $0.01 a call, a half-price promo on 20 calls is worth $0.10 per wallet, so the direct loss is small. The real cost is decision-grade data: the seller cannot tell how many real customers it has, which prices work, or who churned. Rankings and reward programs that count wallets are a second cost.

### Evidence quality

Ling et al. is an arXiv preprint, Bitquery sells chain data, and the a16z figures quote Artemis and Allium. Cite all of them as strong directional evidence, not settled fact.

## Users, goals and success metrics

The primary user is a developer selling a paid API or agent service per call over x402 on Monad who wants fair promos and honest customer numbers.

### Personas

| Persona | Who | Need | Priority |
| --- | --- | --- | --- |
| Seller | A solo developer or small team selling an API at cents per call. Illustrative name: Priya | Give new wallets a promo without losing it to wallet fleets. Know real customer numbers | Primary |
| Legitimate operator | A company running many agent wallets from one treasury | Not be treated as fraud; get one fair shared allowance | Affected user |
| Genuine new customer | A first-time wallet, possibly created today | Get the promo on day one | Affected user |
| Catalog or program owner | A directory, ranking or reward program | Counts not inflated by self-payment; one reward per operator | Secondary, to validate |
| Judge | Runs the demo and reads the repo | Understand it in minutes, reproduce it with no keys or funds | Required |

### Use cases

| ID | Use case | Main flow | Outcome |
| --- | --- | --- | --- |
| UC-1 | Promo claim by a new wallet | Cached verdict, or one optimistic promo call while the analyzer runs | One promo per operator; a genuine new wallet keeps its promo |
| UC-2 | Honest customer count | Free chain-data check of every paying wallet; dashboard groups them | Wallets, operators and independents the seller can report |
| UC-3 | Legitimate fleet | Wallets share a funder and a second signal, so they are one Linked operator | One shared allowance, never blocked |
| UC-4 | Shared verdict | A second seller reads the registry | Same verdict, zero new cost |
| UC-5 | Judge evaluation | One click replays the testnet scenario with a live analysis | Reproducible collapse of the farm, no keys |
| UC-6 | Verified credential (P2, cut for now) | A valid World AgentKit proof sets tier Verified | Strongest tier for opt-in agents |

### Goals

- **G1.** Limit a promo to one per operator in real time, without denying genuine new wallets.
- **G2.** Give the seller an honest count: raw wallets, operators and independent customers.
- **G3.** Share each verdict on Monad so a second seller pays nothing to reuse it, and get the same answer.
- **G4.** Run end to end on testnet for judges, and record the Nansen-powered run on mainnet.
- **G5.** Use Nansen in the core decision, Envio for chain data and indexing, and a Dynamic wallet for capped signing.
- **G6.** Integration in 10 lines or fewer, a typed SDK and readable reasons.

### Non-goals

Proof of personhood or identity checks; blocking any wallet; holding user funds; cards or fiat; a production attestor network; chains other than Monad; publishing real third-party wallets as fraudulent; using Nansen labels or smart-money data; multi-hop funding analysis (funder of the funder).

### Success metrics

These are our own targets for the hackathon build. Report the measured numbers with the size of each test set.

| Metric | Target | How measured |
| --- | --- | --- |
| Farm detection | 10 of 10 farm wallets Linked, as 1 operator | Controlled farm: 10 wallets from one funder, identical amounts, same hour |
| New customers keep the promo | 3 of 3 new independent wallets Independent on their first assessment, whatever their age | Wallets created the same day, funded from 3 unrelated sources |
| Large-funder control | 0 of 250 merged | Recorded fixture of a funder with 250 recipients, plus faucet-funded testnet wallets |
| Negative controls | 0 of 20 unrelated wallets Linked | 20 unrelated active Monad wallets, analysed offline, never published |
| Promo exposure | Farm of 10 gets at most 30 promo calls (expected 21), against 200 without Argus | Seller logs: 20-call promo, sequential traffic |
| Same verdict for every seller | Seller A and Seller B read identical tier and operatorId for all 13 wallets | Second seller instance |
| Cost per wallet | $0 on chain data; at most $0.03 light and $0.08 deep on Nansen | Analyzer cost meter |
| Batch time | 13 wallets in 90 s or less on the Nansen path | Timed run |
| Middleware overhead | 20 ms or less on a cache hit | Benchmark |
| Judge run | Finishes in 2 minutes or less, no keys or funds | Fresh browser test |
| Developer experience | Integration in 10 lines or fewer, from the README alone | A teammate follows it cold |
| Traction (stretch) | 1 external seller tries it | Feedback logged with permission |

## Solution

Argus finds who first funded each paying wallet, groups wallets seeded by the same non-hub funder, and lets the seller apply one promo per group instead of one per wallet. The verdict depends only on public chain evidence, so every seller gets the same answer.

### How each problem is answered

| Problem | Answer |
| --- | --- |
| P1. Customers are invisible | Wallets are grouped into operators; the dashboard shows wallets, operators and independents |
| P2. Per-wallet rules are cheap to defeat | The promo attaches to the operator, so extra wallets add nothing |
| P3. Metrics can be manufactured | The seller reports independent customers, not wallet counts |
| P4. Identity tools cover only opt-in agents | Works on any wallet that pays; a valid credential becomes the top tier later |

### Key terms

- **First funder (F):** the sender of the earliest inbound USDC transfer to the wallet. USDC, not MON, because x402 payers never need gas.
- **Funded group G(F):** every wallet whose first funder is F. Found from public transfers, not from any seller's customer list.
- **Hub:** a funder that serves many unrelated wallets: on the known-hub list (exchanges, bridges, the x402 facilitator, the Circle faucet, the USDC mint), or more than 200 distinct recipients of at least 0.10 USDC each. A hub never links anyone.

### Tiers

Numbers now rise with how sure we are that the wallet is a separate customer. Contracts still check an explicit list of allowed tiers, never "at least N".

| Tier | Meaning | Default seller policy |
| --- | --- | --- |
| 0 Unclear | No verdict yet, verdict expired, no funding trace found, data error, or a shared funder with no second signal | Normal paid service, no promo |
| 1 Linked | Seeded by the same non-hub funder as at least 2 other wallets, plus one more fleet signal | One promo shared by the whole operator; always served |
| 2 Independent | Funding traced, and no shared non-hub funder. **Wallet age does not matter** | Its own full promo |
| 3 Verified (P2, cut) | Valid World AgentKit or KYA credential | Full promo, clustering skipped |

### Decision rule

- **S1 Shared bespoke funder:** F is not a hub and G(F) has at least 3 wallets.
- **S2 Identical instalments:** F sent equal amounts (within 1%) to at least 3 wallets in G(F) within 24 hours.
- **S3 Synchronized activation:** at least 70% of G(F) first became active on the same UTC day.
- **S4 Value closure:** at least 90% of G(F)'s outflows go back to F or to one shared address.
- **Linked** = S1 and at least one of S2, S3, S4.
- **Independent** = funding traced, and S1 is false.
- **Unclear** = everything else (including S1 alone).
- **Confidence:** Linked is High with two or more of S2 to S4, Medium with one. Independent is High when F is a known hub or both data sources agree, Medium otherwise. Unclear is Low.

Two signals the paper also uses depend on one seller's own logs: a flat hour-of-day clock and paying only one payee. They are shown to that seller as **private hints** and never change the published tier, which keeps the verdict the same for everyone.

### Request flow

1. **Quote.** The client puts its wallet in an `X-Payer-Address` header on the unpaid request. The middleware looks for a verdict in this order: local cache, registry (trusted attestors, not expired), then a quick analyzer lookup (300 ms limit) that also returns pre-computed fleet verdicts. It returns a 402 at the promo or standard price. The header is a claim, not proof. No header means standard price.
2. **Optimistic first call.** If no verdict exists anywhere, the first call gets the promo and a background assessment starts. Exposure: one promo call per unknown wallet.
3. **Pay.** The client signs the x402 payment; the Monad facilitator verifies, settles and pays gas.
4. **Enforce.** On the paid retry the middleware decodes the signed payer (`authorization.from`). If it differs from the claim, or the wallet is no longer eligible, it answers with a new 402 at the standard price.
5. **Assess.** Every new paying wallet gets a free chain-data check (Envio HyperSync). A promo claim on mainnet also gets the Nansen check. When a fleet is found, verdicts for all of G(F) are pre-computed and cached off-chain, so the next fleet wallet is recognised on its first call.
6. **Publish.** Verdicts are written to the registry only for wallets that actually paid a seller, with a 7-day expiry. Other group members stay off-chain.
7. **Re-check when a group grows.** If a new wallet joins a group that was below 3, the analyzer re-assesses the group and re-publishes any changed verdicts.
8. **Report.** The dashboard shows raw wallets, operators and independents, with reasons, private hints and cost.

### Seller policy options

| Setting | Default | Meaning |
| --- | --- | --- |
| `promoCalls` | 20 | Promo calls per allowance |
| `promoPerOperator` | true | One allowance shared by all wallets of a Linked operator |
| `unclear` | `standard-price` | Unclear wallets pay the standard price. `shared-promo` instead treats a shared-funder group as one operator |
| `maxAgeDays` | 7 | Oldest verdict accepted |
| `deepCheckOn` | `promo-claim` | When the paid Nansen check runs; `promo-claim` or a spend threshold |
| `attestors` | `[ANALYZER_ADDRESS]` | Trusted attestors, in priority order. The first one with a fresh verdict is used, so promo counters stay on one operatorId |

### Design rules

- **Soft policy, never an accusation.** A Linked wallet still pays and is served.
- **Two signals, not one.** A shared funder alone never makes a wallet Linked.
- **Hubs never merge.** Known hubs and large funders cannot link wallets.
- **New is not suspicious.** Wallet age never lowers a tier.
- **Same answer for every seller.** Published verdicts use public chain evidence only.
- **Evidence you can read.** Every verdict carries reasons and an evidence hash.
- **Privacy.** Public wallet addresses only. The registry never lists a group's wallets.

## Why it is better than existing tools

Argus wins one narrow job: a real-time, no-opt-in decision about anonymous paying wallets, shared across sellers. Where identity credentials apply they are stronger, so Argus is their complement.

| Existing tool | What it answers | What the agent must do first | At the seller's moment of decision | Covers anonymous wallets | Limit for this job |
| --- | --- | --- | --- | --- | --- |
| [World AgentKit with x402](https://exa.ai/docs/reference/x402-agentkit-free-trial.md) | Is a unique human behind this wallet? | Verify in World App, register in AgentBook | Yes | No | Strongest guarantee, but opt-in and biometric |
| [Visa TAP, Skyfire KYAPay, Mastercard Agentic Tokens](https://eco.com/support/en/articles/14846277-know-your-agent-kya-identity-for-agent-payments) | Is this a registered operator? | Register with a directory or issuer | Yes | No | Vetted operators only; central directory |
| Fraud platforms (HUMAN, Forter, Riskified) | Behavioral score on agent traffic | Usually consume the identity claims above | Yes | Partly | Session scoring, not onchain funding |
| Analytics (Artemis, Allium, x402scan, Bitquery, Ling et al.) | How much ecosystem volume is real? | Nothing | No, after the fact | Yes | Research, not a per-request decision |
| Rate limits and WAFs | Is this client over its limit? | Nothing | Yes | Yes | Wallets are free, so limits multiply |
| [Nansen](https://docs.nansen.ai/guides/redistribution-guide) wallet data | What has this wallet done? | Nothing | Through the API | Yes | Raw data, not a policy or shared verdict |
| **Argus** | Is this wallet its own customer, or one of a fleet? | Nothing | Yes, on its first call | Yes | Probabilistic; a patient farmer can pass at higher cost |

**Where Argus is better:** no opt-in or biometrics; treats companies as operators, not fraud; measures real demand, not just a gate; one shared verdict on Monad that every seller reads the same way; every verdict explains itself.

**Where it is worse, plainly:**

- AgentKit gives a stronger guarantee for agents that opt in.
- A farmer who funds each wallet from a separate exchange withdrawal, or through a fresh relay wallet per wallet, passes. Argus looks one funding hop back only. The goal is to raise the cost of farming.
- A farmer could make a funder look like a hub by spraying it to 200+ addresses. Counting only recipients of at least 0.10 USDC raises that to over $20 locked up, and the known-hub list is checked first.
- Cross-chain intent funding can hide a wallet's origin. Its settlement addresses are hubs, so such wallets read as Independent or Unclear, never merged.
- A legitimate small team funding several agent wallets in identical amounts on one day reads as Linked. They still pay and are served; they just share one promo.

**Positioning:** "Know your customer's wallets without knowing your customer." Use AgentKit or KYA when an agent offers them, and Argus for everyone else.

## Functional requirements

Every requirement has an ID, a priority and a check a teammate can run. Requirements changed from v1.0 are marked "(changed)", new ones "(new)".

### Middleware (MW)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| MW-1 | Read the claimed payer from `X-Payer-Address` on the unpaid request, and decode the signed payer (`authorization.from`) from the payment header ourselves on the paid retry (changed) | P0 | Mismatch is re-quoted at standard price. Tests cover match, mismatch and missing header |
| MW-2 | Look up a verdict: local cache, then registry for trusted attestors in priority order, then analyzer `GET /v1/wallet/:address` with a 300 ms limit. Expired reads as Unclear (changed) | P0 | Cache hit adds 20 ms or less. A pre-computed fleet verdict is found on the wallet's first call |
| MW-3 | Apply the policy: per-operator promo counter for Linked, per-wallet for Independent, standard price for Unclear | P0 | Farm of 10 gets 30 promo calls or fewer |
| MW-4 | Optimistic first call when no verdict exists anywhere, and a background assessment request | P0 | No request waits on the analyzer. The next call uses the verdict |
| MW-5 | Issue the 402 with a per-payer price, either through `@x402/express` dynamic pricing or our own 402 handler calling the facilitator's verify and settle (new) | P0 | A promo-priced and a standard-priced payment both settle on testnet |
| MW-6 | Expose `req.argus` with tier, tierName, operatorId, confidence, reasons, hints and promoLeft | P1 | Type exported and documented |
| MW-7 | Fail open: analyzer or registry down means Unclear and standard price | P1 | A simulated outage never blocks a paying request |
| MW-8 | Accept a World AgentKit proof and set tier Verified | P2, cut | Valid proof returns tier 3 |

### Analyzer (AN)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| AN-1 | `POST /v1/assess` for one or many wallets, with `depth` `light` (chain data only) or `deep` (adds Nansen) (changed) | P0 | Returns tier, operatorId, groupSize, confidence, reasons, evidenceHash, expiresAt and cost |
| AN-2 | Light check for every new paying wallet; deep check only on a promo claim on mainnet (new) | P0 | Every paying wallet in the demo has a verdict; Nansen is called only for promo claims |
| AN-3 | When a group is Linked, pre-compute and cache verdicts for every wallet in G(F), off-chain (new) | P0 | Farm wallets 2 to 10 hit a verdict on their first call when traffic is sequential |
| AN-4 | Re-assess a group when a new member joins, and re-publish changed verdicts for wallets that paid (new) | P1 | A group that grows from 2 to 3 flips its paid members from Independent to Linked |
| AN-5 | Queue batches and respect Nansen's 60 requests a minute | P0 | 13 wallets in 90 s, no rate-limit errors |
| AN-6 | Store an evidence bundle, serve it at `GET /v1/evidence/:hash` | P0 | Hash on-chain matches the bundle; no Nansen labels inside |
| AN-7 | Publish verdicts only for wallets that paid a seller, through the signer abstraction, on the registry of the evidence's network (changed) | P0 | Tx hash returned; `verdictOf` returns the verdict; no unpaid wallet is published |
| AN-8 | Budget: daily USD cap, per-wallet call cap, circuit breaker; at the cap, fall back to light | P0 | At the cap no Nansen call is made |
| AN-9 | Pay Nansen per call over x402 and account for the cost | P1 | Reported cost matches payments within one cent |
| AN-10 | `GET /v1/wallet/:address`, `GET /v1/operator/:operatorId`, `POST /v1/explain` | P1 | Return latest verdict, members the seller has seen, and the investigator report |
| AN-11 | Cache verdicts 7 days, raw provider data 24 hours | P1 | A second assessment within 7 days makes no provider calls |
| AN-12 | `POST /v1/sim/run` replays the testnet judge scenario, with a fresh seller namespace and a 1-run-a-minute limit (new) | P0 | Two judges clicking at once both get a clean result |

### Data providers (PV)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| PV-1 | One `WalletIntel` interface used by scoring; no provider code in scoring | P0 | Grep shows no provider names in the scoring package |
| PV-2 | `ChainDataProvider`: first USDC funder, G(F), funder recipient counts and outflows from USDC `Transfer` logs through Envio HyperSync, with Monad RPC as fallback, on both networks (changed) | P0 | Reproduces the fixture verdicts on testnet and mainnet |
| PV-3 | `NansenProvider`: related-wallets and transactions for the wallet (light), counterparties (deep), chain `monad`, no volume filter (changed) | P0 | Recorded fixtures per endpoint; no labels endpoint called; sub-cent payments kept |
| PV-4 | When both providers have data, agreement raises confidence and disagreement sets Unclear with a reason | P1 | Reasons name the sources that agreed |
| PV-5 | Use each endpoint's field names exactly (`wallet_address` for related-wallets, `address` for the others) | P0 | Contract tests pass on recorded responses |
| PV-6 | Known-hub list per network: facilitator, Circle faucet, USDC mint, major exchanges and bridges seen on Monad (new) | P0 | Faucet-funded wallets never merge |

### Scoring (SC)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| SC-1 | S1 to S4 as pure functions over chain evidence (changed) | P0 | Unit tests on fixtures: farm, independents, large funder, mixed, pair, S1 only |
| SC-2 | Hub rule: known-hub list, or more than 200 recipients of at least 0.10 USDC (changed) | P0 | The 250-recipient fixture merges nothing; a dust-sprayed funder is not a hub |
| SC-3 | Decision rule as in Solution; no wallet-age condition (changed) | P0 | Truth-table test of every combination; a wallet funded today can be Independent |
| SC-4 | Confidence as in Solution | P0 | Tested per tier |
| SC-5 | Seller hints (flat clock, one payee) computed from the seller's logs, never stored in the published verdict (changed) | P1 | Hints change no tier in any test |
| SC-6 | All thresholds configurable with documented defaults | P1 | Changing one changes a test verdict |
| SC-7 | Deterministic: same evidence gives the same tier and operatorId | P0 | Re-run and second-seller tests match |

### Registry (RG)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| RG-1 | `PayerAttestations` with `attest`, `attestBatch`, `verdictOf`, `tierOf`, `sameOperator` and an `Attested` event | P0 | Foundry tests cover every function and event |
| RG-2 | Tiers 0 Unclear, 1 Linked, 2 Independent, 3 Verified; a tier above 3 reverts (changed) | P0 | Test |
| RG-3 | Expired verdicts read as Unclear | P0 | Time-travel test |
| RG-4 | Verdicts keyed by wallet and attestor; no attestor can overwrite another | P0 | Two attestors hold different verdicts for one wallet |
| RG-5 | `ArgusGate` with `onlyTiers(attestor, allowedMask)`, a bit per tier (changed) | P1 | A Linked wallet fails a gate that allows Independent and Verified |
| RG-6 | Batch of 13 in one transaction | P1 | Gas reported |
| RG-7 | Deploy to Monad testnet (10143) and mainnet (143) with verified source (changed) | P0 | Both addresses in the README and on the explorer |

### Envio indexer (EN)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| EN-1 | HyperIndex indexer with `config.yaml`, `schema.graphql` and handlers, deployed to Envio Cloud | P0 | Public repo shows all three; the endpoint answers |
| EN-2 | Index the registry's `Attested` events and USDC transfers to the demo seller wallets only (changed) | P0 | Initial sync completes in minutes |
| EN-3 | Entities `Verdict`, `Operator` (derived), `SellerPayment`, `Payer`, `SellerStats` (changed) | P0 | GraphQL returns correct values for the demo |
| EN-4 | Mainnet and testnet in one indexer | P0 | Both networks in `config.yaml` |
| EN-5 | Analyzer uses HyperSync for wallet and funder history | P0 | A wallet's first funder returns in seconds |
| EN-6 | Demo video shows an event, the indexed entity and the dashboard | P0 | In the video |

### Dashboard (DB)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| DB-1 | Raw wallets, operators, independents, Linked and Unclear counts | P0 | Demo shows 13 wallets as 4 customers |
| DB-2 | Group graph (funder to wallets) colored by tier; reasons, hints and evidence hash on selection | P0 | Selecting a group lists every reason |
| DB-3 | Cost meter and a visible "Powered by Nansen API" credit next to any Nansen-derived data | P0 | Credit on every such screen |
| DB-4 | "Run simulation" button calling `POST /v1/sim/run` on testnet (changed) | P0 | Works with no keys or funds, in 2 minutes or less |
| DB-5 | Counts and history read from the Envio GraphQL API | P1 | No direct chain queries for these views |
| DB-6 | Investigator explanation for a group | P1 | Appears within 15 s |

### Investigator (IV)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| IV-1 | An LLM agent explains each group in plain language. With a Nansen API key it uses Nansen's hosted MCP server (`https://mcp.nansen.ai/ra/mcp`); without one it uses the evidence bundle only (changed) | P1 | Report cites evidence items, shows no labels |
| IV-2 | Never says "fraud"; says "linked" and "shares a funder" | P1 | Prompt tests pass |

### Farm simulator (FS)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| FS-1 | Create a funder, 10 farm wallets and 3 independent wallets, and save ground-truth labels | P0 | Labels file produced |
| FS-2 | Fund the farm in identical amounts within one hour; fund independents from 3 unrelated sources (testnet: straight from the Circle faucet) (changed) | P0 | Funding visible on the explorer |
| FS-3 | Send x402 calls from every wallet, sequentially, at 0.001 USDC on testnet (changed) | P0 | Calls in the seller log |
| FS-4 | Recycle: the seller wallet returns funds to the funder after a run (new) | P1 | The judge scenario survives 50 runs on one faucet top-up |
| FS-5 | Same scenario on mainnet with small amounts for the Nansen recording | P0 | Wallets visible on the explorer |
| FS-6 | Emit `EVAL.md`: precision, recall, time and cost per set | P1 | File exists |

### Signer (SG)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| SG-1 | `Signer` abstraction with `LocalKeySigner` and `DynamicServerWalletSigner` | P0 | Analyzer runs with either |
| SG-2 | Dynamic server wallet signs registry writes and Nansen x402 payments | P1 | No raw key in the final demo |
| SG-3 | Dynamic policies: per-transaction value limit and allowlist of the Nansen payee and both registries | P1 | An over-limit attempt is refused on camera |
| SG-4 | Day-0 test: do Dynamic policies apply to typed-data (EIP-3009) signing on Monad? | P0 | Written result in the repo; if no, drop SG-2 and SG-3 and the Dynamic bounty |

### Seller demo (SD)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| SD-1 | Express x402 route on the Monad facilitator with a 20-call half-price promo; testnet and mainnet | P0 | Both networks settle |
| SD-2 | `@x402/evm` 2.22.0 or newer, custom money parser for testnet USDC | P0 | Paid call settles on testnet |
| SD-3 | Second seller instance reading the same registry | P0 | Same tiers, no analyzer call |

### Developer experience (DX)

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| DX-1 | README quickstart: integration in 10 lines or fewer, one-command testnet demo | P0 | A teammate succeeds cold |
| DX-2 | `ARCHITECTURE.md`, `NANSEN.md`, `EVAL.md` | P0 | All exist and are linked |
| DX-3 | Typed SDK for analyzer and registry reads | P1 | Examples in the repo |
| DX-4 | MIT license, attribution, AI-tool disclosure, commit history across the build | P0 | Checked against the submission list |

## Architecture and specifications

A paid request hits the middleware; on a miss, the analyzer builds the funding group from Envio HyperSync (any network) and, for mainnet promo claims, Nansen; the signer publishes the verdict to the registry on the same network; Envio indexes it for the dashboard and every seller reads it the same way.

&#91;embedded content: Argus architecture · 8 parts\]

Nansen is called only for mainnet promo claims; HyperSync builds every funding group for free on both networks.

### Components

| Component | Responsibility | Stack | Network |
| --- | --- | --- | --- |
| Seller demo (x2) | x402 route with a 20-call promo; second instance proves the shared verdict | Node 20, Express, `@x402/express`, `@x402/evm` 2.22.0+ | Both |
| Middleware | Quote, enforce, policy, fail-open, per-payer 402 | TypeScript package | Both |
| Analyzer | Providers, grouping, scoring, signing, budget, sim runner, API | Node 20, Fastify, SQLite on a persistent volume, viem | Both |
| `ChainDataProvider` | First funder, groups, recipient counts, outflows | Envio HyperSync client, viem RPC fallback | Both |
| `NansenProvider` | Deep evidence and cross-check | x402 or API key | Mainnet |
| Registry | Signed verdicts with expiry | Solidity, Foundry | Both |
| Envio indexer | Registry events and seller payments; GraphQL | HyperIndex on Envio Cloud | Both |
| Signer | Capped signer and Nansen payer | Dynamic Node SDK, or local key in dev | Both |
| Dashboard | Counts, group graph, reasons, cost, sim button | Next.js on Vercel | Reads both |
| Investigator | Plain-language explanation | LLM with an MCP client | Mainnet data |
| Farm simulator | Wallets, funding, traffic, recycling, ground truth | TypeScript scripts | Both |

### Configuration defaults

Starting values to tune on the test set, not research findings.

| Parameter | Default |
| --- | --- |
| `minFundingUsd` (smallest inbound that counts as funding; ignores dust) | 0.01 USDC |
| `minGroupSize` (S1) | 3 wallets |
| `hubRecipientThreshold`, `hubMinTransferUsd` | 200 recipients, 0.10 USDC each |
| `instalmentWallets`, `instalmentWindowHours`, `instalmentTolerance` | 3, 24 h, 1% |
| `syncActivationShare` | 0.70 |
| `closureShare` | 0.90 |
| `hintFlatClockAmplitude`, `hintFlatClockMinRequests` | 0.15, 50 |
| `hintConcentrationShare` | 0.90 |
| `verdictTtlDays` | 7 |
| `rawCacheHours` | 24 |
| `lookupTimeoutMs` | 300 |

### Identifiers

- **operatorId**, Linked: `keccak256(abi.encode(chainId, F, attestorSalt))`. Independent: `keccak256(abi.encode(chainId, wallet, attestorSalt))`. Unclear: zero.
- **evidenceHash:** `keccak256` of the canonical evidence bundle JSON.

### Evidence bundle (off-chain; hash on-chain)

```json
{
  "version": 2,
  "network": "mainnet",
  "wallet": "0x...",
  "generatedAt": 1760000000,
  "providers": [
    { "name": "envio-hypersync", "calls": 3, "usd": 0 },
    { "name": "nansen", "calls": 3, "usd": 0.03 }
  ],
  "funding": { "firstFunder": "0x...", "funderIsHub": false, "groupSize": 10 },
  "signals": { "S1": true, "S2": true, "S3": true, "S4": false },
  "agreement": "both-sources",
  "decision": { "tier": 1, "tierName": "Linked", "confidence": "high", "operatorId": "0x..." },
  "attribution": "Powered by Nansen API"
}
```

Summaries and hashes only: no raw Nansen responses, no labels, no seller hints, no list of group members.

### Registry contract

```solidity
uint8 constant UNCLEAR = 0; uint8 constant LINKED = 1;
uint8 constant INDEPENDENT = 2; uint8 constant VERIFIED = 3;

struct Verdict {
  bytes32 operatorId;
  uint8   tier;
  uint16  groupSize;
  uint64  issuedAt;
  uint64  expiresAt;
  bytes32 evidenceHash;
}

event Attested(address indexed wallet, address indexed attestor, bytes32 indexed operatorId, uint8 tier, uint64 expiresAt);

function attest(address wallet, Verdict calldata v) external;          // msg.sender is the attestor; tier > 3 reverts
function attestBatch(address[] calldata wallets, Verdict[] calldata v) external;
function verdictOf(address wallet, address attestor) external view returns (Verdict memory);
function tierOf(address wallet, address attestor) external view returns (uint8); // expired returns UNCLEAR
function sameOperator(address a, address b, address attestor) external view returns (bool); // false if either is Unclear

// ArgusGate
modifier onlyTiers(address attestor, uint8 allowedMask); // bit i allows tier i, e.g. (1 << 2) | (1 << 3)
```

No attestor allowlist; each consumer names whom it trusts. The `AssessmentRequested` event from v1.0 is dropped with the CRE stretch.

### Analyzer API

| Call | Purpose |
| --- | --- |
| `POST /v1/assess` `{ network, wallets[], depth, seller? }` | Verdicts plus cost; `seller` only attaches private hints to the reply |
| `GET /v1/wallet/:address?network=` | Latest verdict, including pre-computed ones (used by MW-2) |
| `GET /v1/operator/:operatorId` | Members the asking seller has seen pay |
| `GET /v1/evidence/:hash` | Evidence bundle |
| `POST /v1/explain` `{ operatorId }` | Investigator report |
| `POST /v1/sim/run` | Replays the testnet judge scenario |

Example result:

```json
{
  "wallet": "0xaaa...", "tier": 1, "tierName": "Linked", "operatorId": "0x...",
  "groupSize": 10, "confidence": "high",
  "reasons": ["First USDC funder also seeded 9 other wallets", "Funded in identical 0.20 USDC amounts within 6 minutes", "9 of 10 became active on the same day"],
  "hints": [],
  "evidenceHash": "0x...", "expiresAt": 1760604800, "attestationTx": "0x..."
}
```

### Middleware configuration

```ts
app.use('/api/premium', argus({
  network: 'testnet',
  attestors: [ANALYZER_ADDRESS],
  price: { standard: '$0.01', promo: '$0.005' },
  policy: { promoCalls: 20, promoPerOperator: true, unclear: 'standard-price', deepCheckOn: 'promo-claim' },
  analyzerUrl: process.env.ANALYZER_URL,
}));
// req.argus = { tier, tierName, operatorId, confidence, reasons, hints, promoLeft }
```

### Nansen requests (mainnet, chain `monad`)

| Endpoint | Body | Used for | Check |
| --- | --- | --- | --- |
| `/api/v1/profiler/address/related-wallets` | `{ wallet_address, chain, pagination: { page: 1, per_page: 20 } }` | First Funder and other relations, cross-check of F | light |
| `/api/v1/profiler/address/transactions` | `{ address, chain, date: { from, to }, filters: { source_type: "transfer" } }`, no volume minimum | Inbound USDC, timing, first seen | light |
| `/api/v1/profiler/address/counterparties` | `{ address, chain, date, group_by: "wallet", source_input: "Combined" }` | Value closure (S4) | deep |

Auth: `apikey` header, or x402 payment with no key. A valid key takes precedence over payment, so the x402 path must send no key.

### Envio schema

```graphql
type Verdict { id: ID!  chainId: Int!  wallet: String!  attestor: String!  operatorId: String!  tier: Int!  groupSize: Int!  issuedAt: Int!  expiresAt: Int!  evidenceHash: String! }
type Operator { id: ID!  chainId: Int!  attestor: String!  walletCount: Int!  linkedCount: Int!  lastAttestedAt: Int! }
type SellerPayment { id: ID!  chainId: Int!  seller: String!  payer: String!  amount: BigInt!  ts: Int!  txHash: String! }
type Payer { id: ID!  seller: String!  wallet: String!  payments: Int!  firstPaidAt: Int! }
type SellerStats { id: ID!  chainId: Int!  paymentCount: Int!  distinctPayers: Int! }
```

Funding edges and funder counts are not indexed; the analyzer gets them from HyperSync queries. This settles v1.0's open question Q5.

### Analyzer database

| Table | Key fields |
| --- | --- |
| `wallets` | address, network, firstFunder, firstFundedAt |
| `funders` | address, network, recipientCount, isHub, groupSize |
| `observations` | wallet, source, endpoint, payloadHash, summaryJson, fetchedAt |
| `verdicts` | wallet, network, tier, operatorId, confidence, reasonsJson, evidenceHash, issuedAt, expiresAt, published, attestationTx |
| `costs` | provider, endpoint, calls, usd, ts |
| `requests` | seller, wallet, ts, price (feeds hints) |
| `promo_counters` | seller, operatorId or wallet, used |

## Demo, environments and costs

The demo uses only wallets we own: a farm of 10 wallets seeded by one funder, and 3 genuine-looking customers funded from unrelated sources. It runs twice: free on testnet for judges, and once on mainnet with real funds so Nansen can see it.

### The demo wallets

| Wallet | Count | How it is funded | Expected verdict |
| --- | --- | --- | --- |
| Funder F | 1 | Testnet: Circle faucet plus MON faucet. Mainnet: an exchange withdrawal | Not assessed (it never pays) |
| Farm wallets | 10 | F sends each the same amount (testnet 0.05 USDC, mainnet 0.20 USDC) within one hour | Linked, 1 operator, High confidence |
| Independent wallets | 3 | Testnet: each straight from the Circle faucet. Mainnet: one exchange withdrawal, one bridge, one teammate's own wallet | Independent on day one |
| Seller payTo | 2 (one per network) | Receives payments; recycles funds to F | Not assessed |

Result on the dashboard: 13 paying wallets, 4 customers (1 operator + 3 independents). The independents are new wallets, which proves new customers keep their promo.

### Judge "Run simulation" (testnet)

1. We build the testnet scenario once, before Gate 2. The wallets stay funded.
2. A click calls `POST /v1/sim/run`. It creates a fresh seller namespace, so promo counters start at zero.
3. The 13 wallets send calls one after another at 0.001 USDC, three calls per farm wallet, through the real middleware and facilitator.
4. The analyzer runs a fresh light check (Envio HyperSync, free) and publishes to the testnet registry.
5. The dashboard shows the farm collapse, the promo calls each wallet got, and the second seller reading the same verdicts.
6. After the run the seller wallet returns funds to F. One faucet top-up covers about 50 runs.

Judges need no keys and no funds. Runs are limited to one a minute.

### Network matrix

| Part | Network | Why |
| --- | --- | --- |
| Nansen API, MCP, CLI and payments | Mainnet | Nansen has no Monad testnet |
| 13 demo wallets for the Nansen recording | Mainnet | Nansen must see them |
| Same 13-wallet scenario for judges | Testnet | Free and repeatable |
| Seller demo, middleware, analyzer | Both | Facilitator supports both |
| Registry | Both | Mainnet evidence is published on mainnet |
| Envio indexer and HyperSync | Both | HyperRPC lists 143 and 10143 |
| Dynamic server wallet | Mainnet for Nansen, both for the registry | Holds a few dollars |

### Network constants

| Item | Mainnet | Testnet |
| --- | --- | --- |
| Chain ID | 143 | 10143 |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| x402 facilitator | `https://x402-facilitator.molandak.org` | same |
| Envio HyperRPC | `https://monad.rpc.hypersync.xyz` | `https://monad-testnet.rpc.hypersync.xyz` |
| Envio HyperSync | Confirm on Day 0 (V4) | `https://monad-testnet.hypersync.xyz` |
| Faucets | n/a | MON at `faucet.monad.xyz`; USDC at `faucet.circle.com` (1 USDC per request, one request per 2 hours) |

Sources: [Monad x402 guide](https://docs.monad.xyz/guides/x402) and Envio's Monad pages.

### Real-money costs (mainnet)

Estimates from Nansen's price list, not quotes. Testnet work is free.

| Item | Low | Likely | High |
| --- | --- | --- | --- |
| Fund 13 demo wallets (0.20 USDC each) | $2.60 | $2.60 | $2.60 |
| Nansen, final run (13 wallets, light + deep) | $0.50 | $0.95 | $1.10 |
| Nansen, development and testing | $2 | $4 | $8 |
| MON gas (funder transfers, registry writes) | $0.20 | $0.50 | $1 |
| Getting USDC and MON onto Monad | $1 | $3 | $5 |
| **Total** | **about $6** | **about $11** | **about $18** |

Hold $20 as the ceiling. Most of the wallet funding comes back as payments to our own seller wallet, so the real loss is about $3 to $10. Unpriced: hosting free tiers, Envio and Dynamic plan limits, investigator LLM usage (check on Day 0).

### Cost controls

1. Develop on the free chain-data path; use Nansen on mainnet for tests and the final recording only.
2. Nansen runs only on promo claims; verdicts cached 7 days; a funder's history fetched once per group.
3. Analyzer wallet capped at $5 a day and holding only a few dollars.
4. Send one unpaid request to a Nansen endpoint first: the free 402 reply shows the expected network and price.

## Sponsor integrations and deliverables

An integration stays only if removing it would make Argus worse: Nansen and Envio are core, Dynamic depends on a Day-0 test, and CRE, Aurora and Mera are out.

| Sponsor | Prize | Decision | Real use in Argus |
| --- | --- | --- | --- |
| Nansen | $5,000 pool (1st $2,000, 2nd $1,500, 3rd $1,000, HM $500) | **Core** | Deep evidence for every mainnet promo decision; cross-check of the funder; investigator over MCP if we have a key; paid per call over x402 |
| Envio | $1,000 | **Core** | HyperSync builds every funding group on both networks; HyperIndex indexes registry and seller payments for the dashboard, multichain with derived entities |
| Dynamic | $5,000 | **Gated (SG-4)** | Capped server wallet that signs registry writes and Nansen payments, with value-limit and allowlist policies |
| Chainlink CRE | about $3,000 | **Cut** | Revisit only if Gate 2 passes by midday 11 Oct |
| Aurora Intents | $5,000 | **Skip** | No real use; intent settlement addresses are treated as hubs |
| Mera | $2,500 x2 | **Cut** | Passkey proof of wallet control; roadmap item |

### What each bounty asks for

| Sponsor | Deliverables | Video |
| --- | --- | --- |
| Nansen | Working demo using at least one endpoint, MCP tool or the CLI in a core feature; written explanation of endpoints, data, MCP tools and CLI; public repo | Optional, 2 min |
| Envio | Deployed indexer; public `config.yaml`, `schema.graphql`, handlers or HyperSync code; a frontend that uses the data; a description. Depth scores higher | Optional, 2 min |
| Dynamic | Deployed app using the SDK for wallets or signing, in a Monad track; a description | Optional, 2 min |

### Rules

- Create the project on the Metropolis dashboard first, then choose Track 04 and the bounties. One project, one track, any number of bounties (confirm stacking on the dashboard; the Envio page says it stacks).
- Required videos: technical demo (3 min) and pitch (2 min). Cut the Nansen, Envio and Dynamic shorts from one recorded end-to-end run.

### Notes per sponsor

**Nansen.** Use only endpoints that allow redistribution, show "Powered by Nansen API", publish only derived tiers and hashes, never labels or smart-money data. The MCP investigator and the CLI quickstart need an API key; if we have none (V5), the bounty rests on the API and x402, which the bounty accepts.

**Envio.** HyperSync does the analyzer's funding work; HyperIndex covers the registry and seller payments only. When Envio and Nansen agree on a funder, confidence rises.

**Dynamic.** Server wallets are Node SDK MPC wallets; `signTypedData` signs EIP-3009 authorizations. If policies do not apply to typed-data signing on Monad, use a small local key, document why, and do not enter the bounty.

## Quality, security and testing

The build is done when it meets these targets and the evaluation numbers are measured and reported honestly.

### Non-functional requirements

| ID | Area | Target |
| --- | --- | --- |
| NF-1 | Middleware overhead on a cache hit | 20 ms or less |
| NF-2 | Analyzer lookup on a miss | 300 ms limit, then optimistic |
| NF-3 | One wallet, light check | 5 s or less at p95 |
| NF-4 | One wallet, deep check on Nansen | 10 s or less at p95 (Nansen latency unmeasured) |
| NF-5 | Batch of 13 on Nansen | 90 s or less, within 60 requests a minute |
| NF-6 | Availability | Fail open: Unclear and standard price; no paying request blocked |
| NF-7 | Cost per wallet | $0 light on chain data; Nansen at most $0.03 light, $0.08 deep |
| NF-8 | Determinism | Same evidence, same tier and operatorId, for every seller |
| NF-9 | Judge demo | No keys or funds; 2 minutes or less |
| NF-10 | Observability | Every assessment logs wallet, network, providers, calls, cost and tier |

### Security

- **Never trust the header for eligibility.** Eligibility uses the signed payer on the paid retry.
- **No raw keys in the final demo** if SG-4 passes; otherwise small dedicated wallets.
- **Spending caps** in code, in Dynamic policy where available, and by keeping balances small.
- **Sign only what was quoted:** the exact amount in Nansen's current 402.
- **Attestor isolation:** verdicts are keyed by attestor; consumers list whom they trust.
- **Dust resistance:** inbound transfers under 0.01 USDC never count as funding, so nobody can become a wallet's first funder with dust.
- **Sim endpoint abuse:** one run a minute, fixed wallets, no user input reaches the chain.
- **Secrets** in environment variables only; `.env` git-ignored; secrets scan before the final push.

### Privacy

- Public wallet addresses only; no names, IPs, emails or documents.
- The registry holds a tier, an operator hash and an evidence hash. It never lists group members, and unpaid group members are never published.
- The dashboard shows only wallets that paid that seller.
- Negative controls on real wallets are analysed offline and reported only as totals.

### Nansen compliance

- Only redistributable endpoints: transactions, counterparties and related-wallets, with attribution.
- Never call or show labels, premium labels or smart-money data, and never put them in a bundle.
- "Powered by Nansen API" near Nansen-derived data in the app and README.
- Raw responses private and kept 24 hours at most; confirm against Nansen's terms (V9).
- Re-read the guidelines before submission (last updated 18 Nov 2025).

### Test plan

| Layer | What is tested | Tool |
| --- | --- | --- |
| Unit | S1 to S4, hub rule (list, threshold, dust spray), decision truth table, confidence, operatorId, hints never change tier, promo counters | Vitest |
| Contract | `attest`, `attestBatch`, tier bounds, expiry, attestor isolation, `onlyTiers` rejects Linked, gas of 13 | Foundry |
| Provider | Each Nansen endpoint and HyperSync query against recorded responses, including field names | Fixtures |
| Integration | Middleware with a mock analyzer: quote, enforce, optimistic call, pre-computed fleet hit, mismatch, outage | Supertest |
| End to end | Sim run on testnet: seller, middleware, analyzer, registry, Envio, dashboard, second seller | Scripted |
| Mainnet | Same scenario with Nansen, recorded once | Manual |

### Evaluation protocol

1. **Controlled farm:** 10 wallets, one funder, identical amounts within an hour. Target 10 of 10 Linked.
2. **New independents:** 3 wallets created the same day, unrelated sources. Target 3 of 3 Independent.
3. **Large funder:** fixture with 250 recipients, plus faucet-funded wallets. Target 0 merged.
4. **Negative controls:** 20 unrelated active Monad wallets, offline. Target 0 Linked.
5. **Same answer:** two sellers read identical verdicts for all 13.
6. **Report** precision, recall, time and cost per wallet in `EVAL.md` with set sizes, and state the limit: small self-made sets show the method works, not how it performs in the wild.

## Day-0 checks, delivery plan and risks

Every fact we could not verify has a check and a fallback, so none of them can stop the build. Development starts on 8 Oct and submission is the evening of 13 Oct.

### Day-0 verification checklist

| ID | Check | Fallback if it fails | By |
| --- | --- | --- | --- |
| V1 | Can `@x402/express` set a different price per payer? | Our own 402 handler calls the facilitator's verify and settle (MW-5) | 9 Oct |
| V2 | Can HyperIndex filter USDC transfers to the seller wallets only? | Dashboard reads seller payments from a HyperSync query | 9 Oct |
| V3 | How long does Nansen take to see a new Monad wallet? | Record the Nansen run later on 11 Oct; the live demo never depends on Nansen | 9 Oct |
| V4 | HyperSync mainnet URL, and is an API token free? | Monad RPC with viem for mainnet history | 8 Oct |
| V5 | Do we have a Nansen API key (needed for MCP and CLI)? | x402-only API use; investigator reads the evidence bundle | 8 Oct |
| V6 | Do Dynamic policies apply to EIP-3009 typed-data signing on Monad (SG-4)? | Local capped key; skip the Dynamic bounty | 8 Oct |
| V7 | Cheapest route to get USDC and MON onto Monad mainnet | Ask in the Monad Discord; budget up to $5 for fees | 8 Oct |
| V8 | Circle faucet limit: per address or per person? | Fund the 3 testnet independents over 6 hours | 8 Oct |
| V9 | May raw Nansen responses be cached, and for how long? | Keep summaries only, no raw cache | 10 Oct |
| V10 | Free hosting for the analyzer with a persistent disk | Run it on a small VPS | 10 Oct |
| V11 | Do all bounties stack with Track 04? | Keep only those confirmed | 10 Oct |
| V12 | Enough unrelated active Monad wallets for negative controls? | Use active USDC holders found through HyperSync | 10 Oct |

### Scope

| Tier | Requirements |
| --- | --- |
| Must ship (P0) | MW-1 to MW-5; AN-1 to AN-3, AN-5 to AN-8, AN-12; PV-1 to PV-3, PV-5, PV-6; SC-1 to SC-4, SC-7; RG-1 to RG-4, RG-7; EN-1 to EN-6; DB-1 to DB-4; FS-1 to FS-3, FS-5; SG-1, SG-4; SD-1 to SD-3; DX-1, DX-2, DX-4 |
| Should ship (P1), in order | AN-9; SG-2, SG-3; AN-4; IV-1, IV-2; PV-4; MW-6, MW-7; RG-5, RG-6; FS-4, FS-6; DB-5, DB-6; SC-5, SC-6; AN-10, AN-11; DX-3 |
| Cut | MW-8 Verified tier, Chainlink CRE, Mera passkeys, Aurora |

### Gates

- **Gate 1, 9 Oct, end of day:** HyperSync returns the testnet farm's funder; one Nansen x402 call settles on mainnet; SG-4 has a written answer. Fallbacks as in the checklist.
- **Gate 2, 11 Oct, midday:** the judge sim runs end to end on testnet and the dashboard shows 13 wallets as 4 customers. If it slips, cut the investigator and the group graph before the registry.
- **Freeze, 12 Oct:** no new features; only bugs, evaluation, recordings and docs.
- **Submit, 13 Oct evening IST;** 14 Oct morning held for fixes before the 09:29 IST close.

### Day by day

| Day | Focus | Done when |
| --- | --- | --- |
| 8 Oct | Final PRD. Scaffold the monorepo. Registry and Foundry tests. Scoring engine on fixtures. Day-0 checks V4 to V8. Create and fund testnet wallets. **You:** buy mainnet USDC and MON, create and fund the 13 mainnet wallets | Registry tests pass; testnet scenario funded; mainnet wallets exist |
| 9 Oct | Gate 1. `ChainDataProvider`, analyzer API, `NansenProvider` with fixtures. Envio indexer scaffold | HyperSync and Nansen both return the farm's funder |
| 10 Oct | Middleware and both seller instances. Registry on testnet and mainnet. Envio deployed. Dynamic if SG-4 passed | A promo and a standard payment settle through the middleware |
| 11 Oct | Gate 2. Dashboard and sim button. Record the Nansen mainnet run | Judge sim works in a fresh browser |
| 12 Oct | Freeze. `EVAL.md`, README, ARCHITECTURE, NANSEN. Videos | All videos recorded |
| 13 Oct | Secrets scan, final checks, submit | Submission confirmed |

### Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R1 | False positives on legitimate fleets | Hub list and threshold, two-signal rule, soft policy, readable reasons, large-funder test |
| R2 | Evasion through separate funding sources or relay wallets | State it; Argus raises the cost; AgentKit is the stronger tier for opt-in agents |
| R3 | Fake hub by dust spraying | Count only recipients of 0.10 USDC or more; known-hub list first |
| R4 | Race: fleet wallets calling in parallel before the first verdict lands | Each gets one optimistic call at most; target allows 10, expected 1 when sequential |
| R5 | Nansen slow to index new wallets | Live demo never needs Nansen; record later |
| R6 | Nansen redistribution rules | Allowed endpoints, attribution, hashes only |
| R7 | x402 SDK drift (v2 only; upto-scheme proxy bug) | Pin `@x402/evm` 2.22.0+; our own 402 handler as fallback |
| R8 | Dynamic beta and gated policies | Day-0 test; drop if it fails |
| R9 | Faucet limits | Recycling; one top-up covers about 50 runs |
| R10 | Schedule: five and a half days | P0 first, P1 after Gate 2, cuts already made |
| R11 | Overlap with World AgentKit | Position as the complement for anonymous wallets |
| R12 | Ethics | Own wallets only; totals for real wallets; never say fraud |

### Assumptions

The Monad facilitator works as its guide describes; Nansen's x402 works for Monad from a funded mainnet wallet; the track accepts a testnet live link; one or two builders work full time until 13 Oct; sellers accept a soft policy.

### What not to claim

- "Proof of personhood" or "stops fraud". Argus estimates operators and limits promos.
- "The first" or "nothing like it exists".
- Any use of Nansen labels or smart-money data.
- Vendor and press numbers as settled fact.

## Appendix

### Submission checklist

Submit on the Metropolis dashboard before 14 Oct 2026, 09:29 IST. Create the project first, then choose Track 04 and the bounties.

- [ ] Logo (JPG, PNG or WEBP, 3 MB or less)
- [ ] Public GitHub repo, accessible to `metropolis@hackathon.monad.xyz`
- [ ] Full source, README with setup, MIT license, attribution, commit history across the build
- [ ] README discloses AI coding tools and any pre-existing code
- [ ] README explains the Monad integration and lists both registry addresses and sample tx hashes
- [ ] Docs: description, architecture, stack, setup, deployment
- [ ] Technical demo video, 3 minutes or less
- [ ] Pitch video, 2 minutes or less
- [ ] Live testnet link with access instructions (no credentials needed)
- [ ] Nansen: integration description, optional 2-minute video
- [ ] Envio: deployed indexer, `config.yaml`, `schema.graphql`, handlers, description
- [ ] Dynamic (only if SG-4 passed): description and video
- [ ] "Powered by Nansen API" in the app and README
- [ ] Secrets scan clean

### Repository layout

```text
argus/
  contracts/             PayerAttestations.sol, ArgusGate.sol, test/ (Foundry)
  packages/middleware/   argus() Express middleware, 402 handler, types
  packages/sdk/          analyzer and registry client
  packages/scoring/      signals, hub rule, decision rule (no provider code)
  services/analyzer/     providers/{chain,nansen}.ts, groups.ts, signer.ts, budget.ts, sim.ts, api.ts
  services/investigator/ prompts and MCP client
  indexer/               Envio config.yaml, schema.graphql, handlers
  apps/seller-demo/      two seller instances
  apps/dashboard/        Next.js dashboard
  scripts/farm-sim/      create, fund, send, recycle, labels
  fixtures/              recorded provider responses, 250-recipient funder
  docs/                  ARCHITECTURE.md, NANSEN.md, EVAL.md, DAY0.md
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NETWORK` | `testnet` or `mainnet` |
| `MONAD_RPC_URL_MAINNET`, `MONAD_RPC_URL_TESTNET` | RPC endpoints |
| `FACILITATOR_URL` | `https://x402-facilitator.molandak.org` |
| `SELLER_PAY_TO` | Seller wallet per network |
| `REGISTRY_ADDRESS_MAINNET`, `REGISTRY_ADDRESS_TESTNET` | Deployed registries |
| `ENVIO_API_TOKEN` | HyperSync access |
| `NANSEN_API_KEY` | Optional; leave unset on the x402 path |
| `DYNAMIC_ENVIRONMENT_ID`, `DYNAMIC_API_TOKEN` | Dynamic server wallet |
| `ANALYZER_PAYER_KEY`, `ATTESTOR_KEY` | Development only; small dedicated wallets; never committed |
| `ATTESTOR_SALT` | Salt for operatorId |
| `LLM_API_KEY` | Investigator |
| `ANALYZER_URL` | Where the middleware calls the analyzer |

### Glossary

| Term | Meaning |
| --- | --- |
| x402 | Paying for an HTTP request using the 402 Payment Required status |
| Facilitator | Service that verifies and settles x402 payments and pays gas |
| Operator | The party controlling a group of wallets |
| First funder | Sender of a wallet's earliest USDC of at least 0.01 |
| Funded group | All wallets sharing one first funder |
| Hub | A funder serving many unrelated wallets: exchange, bridge, faucet |
| Verdict | A signed tier for a wallet, with reasons and an expiry |
| Attestor | An address that signs verdicts; sellers choose whom to trust |
| Promo | A discounted allowance for a new customer |

### Sources

| Source | Used for |
| --- | --- |
| [Ling et al., How Agentic Is Agentic Commerce? (arXiv 2607.12575)](https://arxiv.org/pdf/2607.12575) | Measurements, clustering method, signals |
| [Bitquery x402 audit (6 Sep 2026)](https://bitquery.io/investigations/x402-ai-agent-payments-audit) | August 2026 volume, seller earnings |
| [a16z crypto (11 Mar 2026)](https://a16zcrypto.com/posts/article/ai-agent-payments-honest-number) | $24M, $3M, $1.6M |
| [Nansen x402 payments](https://docs.nansen.ai/getting-started/agentic-payments/x402-payments.md) | Prices, limits |
| [Nansen redistribution guidelines](https://docs.nansen.ai/guides/redistribution-guide) | What may be shown or stored |
| [Nansen supported chains](https://docs.nansen.ai/reference/chains) | Monad mainnet only |
| [Nansen related wallets at scale](https://docs.nansen.ai/guides/templates/complex-use-cases/use-case-3-identifying-related-wallets-at-scale) | Request shapes |
| [Monad x402 guide](https://docs.monad.xyz/guides/x402) | Facilitator, chain IDs, USDC |
| [Exa: World AgentKit with x402](https://exa.ai/docs/reference/x402-agentkit-free-trial.md) | AgentKit free trials |
| [Eco: Know Your Agent](https://eco.com/support/en/articles/14846277-know-your-agent-kya-identity-for-agent-payments) | KYA landscape |
| [Envio HyperRPC networks](https://docs.envio.dev/docs/HyperRPC/hyperrpc-supported-networks) | Monad endpoints (verify, V4) |
| [Dynamic policies](https://www.dynamic.xyz/docs/overview/wallets/embedded-wallets/mpc/policies/overview) | Signer policies (verify, V6) |

Carried over from PRD v1.0 and the Dev and Pitch Brief; not re-opened for this version.

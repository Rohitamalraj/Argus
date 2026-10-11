# Evaluation

How well does the rule separate operators from independent customers? All numbers are from runs on Monad testnet and mainnet during the hackathon (9 to 11 Oct 2026), reproducible with the commands shown. **The sets are small and partly self-made: they show the method works, not how it performs in the wild.**

## Results

| Set | Size | Result | Command |
| --- | --- | --- | --- |
| Controlled farm, testnet: one funder, identical 0.05 USDC to each, within 16 s | 10 wallets | **10 of 10 Linked, high confidence, one operator** | `npm run assess -w @argus/analyzer -- --network testnet --labels` |
| Controlled farm, mainnet: identical 0.20 USDC within 13 s | 10 wallets | **10 of 10 Linked, high confidence, one operator** | same, `--network mainnet` |
| Mainnet end-to-end run (10 Oct 2026): the demo seller on mainnet at $0.01 / $0.005, analyzer publishing to the mainnet registry | 12 funded wallets, 36 real x402 payments | **10 farm wallets resolved to one operator, the independents to Independent; verdicts published on-chain; `verify` MATCH** on a farm wallet and an independent. One demo wallet (indie-1) held no USDC, never paid and was not published | `npm run mainnet:run -- analyzer`, `seller`, `pay 3` |
| New independents, testnet (faucet) and mainnet (a bridge payout, two DEX purchases), created the same day as the farm | 3 + 3 | **6 of 6 Independent** (wallet age never matters) | same |
| The whole demo | 13 + 13 wallets | **13 wallets resolve to 4 customers, on both networks, 13 of 13 correct** in 3 to 5 s and 6 HyperSync queries | same |
| Second source, mainnet: Nansen reports each wallet's first funder | 13 wallets | **13 of 13 agree** with HyperSync; Nansen also sees the funder paying 10 wallets. 14 calls, $0.18, 82 s | `npm run assess-deep -w @argus/analyzer` |
| Large funder fixture: one funder, 250 recipients, same day | 250 wallets | **0 merged** (hub rule) | `packages/scoring` tests |
| Faucet-funded wallets, one day | 30 wallets | **0 merged** | `packages/scoring` tests |
| Dust-sprayed funder: 300 recipients of 0.001 USDC to look like a hub | 10 farm + 300 | **farm still Linked**; dust does not count toward the hub rule | `packages/scoring` tests |
| Two wallets sharing a funder; one shared funder with nothing else | 2; 3 | **Independent** (below the group minimum); **Unclear** (S1 alone never links) | `packages/scoring` tests |
| Same answer for every seller: a second seller instance reads the first one's verdicts | 3 wallets | **identical tiers, no analyzer call** | end-to-end run on testnet |
| Negative control: recently active mainnet accounts with no tie to us (precision check) | 12 wallets, spread evenly over the 106 externally owned accounts that sent USDC on mainnet in the previous ~28 hours (the plan was 20; each lookup is slow on the free tier) | **12 of 12 Independent, 0 Linked.** 146 HyperSync queries, about 10 minutes | the script is not in the repo; the sample is recent senders from `HyperSyncClient.transfers`, filtered to accounts with no contract code |

### ERC-8004 (Monad mainnet)

| Agent | Feedback | Reviewers | Operators | Notes |
| --- | --- | --- | --- | --- |
| #182 | 7,665 | 7,665 | **1** | Exact, full run (about 3 minutes, 49 queries): one funder first funded all of them; 5,555 got an identical 11 MON within 24 h. A sample of 800 reaches the same result in 35 s |
| #10182 | 78 | 16 | 9 | One fleet of 8 (identical 0.01 MON within 29 s, same-day activity); 7 reviewers have no visible funding and count as independent |
| #9, #8317 | 518, 78 | 1, 1 | 1, 1 | A single reviewer: nothing to merge |
| #158, #154, #157 | 9, 13, 10 | 4 each | 1 (#157: 2) | The 4 reviewers are contracts all deployed by one account. Before deployer grouping they were 4 unattributed reviewers each |

Owner check on #182: the agent's owner (`0x97cD…0996`) is the first funder of every reviewer in a 400-reviewer sample, so 100% of the traced reviewers are owner-funded and no operator is unrelated to the owner. The fleet funder of #10182 is not its owner.

On-chain check: `getSummary` on agent #10182 accepts the allowlist as `clientAddresses` (count 66, mean 88 for nine representatives; 78 and 89 unfiltered). The allowlist de-duplicates reviewers, not entries.

## What the numbers do not show

- **No labelled data from the wild.** Precision on real operators is unknown: the farm is ours, and the only independents are three wallets we also created (their funders are public hubs).
- **Hub list entries were added after the fact.** The faucet senders, the bridge payout and the Uniswap pool were added to the known-hub list after we saw them. The generic rule (more than 200 recipients of 0.10 USDC or more) classified them as hubs on its own before they were listed, so the list saves queries more than it changes verdicts.
- **A determined evader wins.** Funding every wallet from a different source defeats a funding-graph rule. Argus raises the cost; it is not proof of personhood.
- **Direct transfers only.** A wallet funded through a contract shows no inbound transfer and is counted as independent. HyperSync returns no internal-transfer traces for Monad (checked 10 Oct 2026), so this cannot be closed with the current data source. On agent #10182, 7 of 16 reviewers are in that bucket. Reviewers that are *contracts* are handled separately: they are grouped by the account that deployed them (agents #158, #154, #157), but contracts made through a factory have no deployment transaction of their own and stay unattributed.
- **S5 is a judgement call.** A funder that first funded half of an agent's reviewers is treated as one operator even when it is hub-sized; a known hub never is. The 50% and 10-wallet thresholds are defaults to tune, not findings.
- **Agent #182 may be benign.** Its tags (`eve`, `spawn`, `plague`) suggest a game or simulation. Shared funding is not wrongdoing; it does mean the reviewers are one operator.

## Reproduce

```bash
npm test                                             # 51 scoring, 28 sdk, 32 analyzer, 22 middleware, 7 mcp, 19 contract tests (the 8 indexer tests run under WSL)
npm run argus -w @argus/sdk -- reputation 182        # ERC-8004, full run (add --sample 800 for speed)
npm run assess -w @argus/analyzer -- --network mainnet --labels
```

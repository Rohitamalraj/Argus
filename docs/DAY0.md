# Day-0 checks

Results of the verification checklist in the PRD. Each check has a fallback, so none can stop the build.

| ID | Check | Result | Date |
| --- | --- | --- | --- |
| V1 | Can `@x402/express` set a different price per payer? | **Pass.** `PaymentOption.price` accepts a function of the request context (headers and the payment header), re-evaluated on the paid retry; `x402ResourceServer.onAfterSettle` gives the signed payload for promo counting. The Monad facilitator lists `exact` on eip155:143 and eip155:10143 | 2026-10-09 |
| V2 | Can HyperIndex filter USDC transfers to the seller wallets only? | **Pass.** HyperIndex V3 `where: ({ chain }) => ({ params: [{ to: sellers }] })` topic-filters `Transfer` by recipient per chain; tested against real testnet blocks. Envio needs WSL 2 on Windows | 2026-10-09 |
| V3 | How long does Nansen take to see a new Monad wallet? | Open. A wallet bridged in on 2026-10-08 19:57 UTC already had its First Funder in `related-wallets` on 2026-10-09 | 2026-10-09 |
| V4 | HyperSync mainnet URL, and is an API token needed? | **Pass.** `https://monad.hypersync.xyz` (mainnet) and `https://monad-testnet.hypersync.xyz` both answer; queries need a bearer token (bad token returns 401), free from envio.dev. Free tier is 15,000 cost units per 60 s at about 1,000 per query, so the provider batches all wallets (6 queries for the 13-wallet demo) | 2026-10-09 |
| V5 | Nansen API key (for MCP and CLI)? | **Pass.** Free plan: 100 credits plus 10 per day; profiler calls cost 1 credit. `related-wallets --chain monad` works on mainnet | 2026-10-09 |
| V6 | Do Dynamic policies apply to EIP-3009 typed-data signing on Monad (SG-4)? | **Docs say no.** Policies are enforced by simulating transactions; the policy-violation webhook lists only `evmTransaction`, `evmUserOperation`, `svmTransaction` and `svmMessage`, with no EVM typed-data operation. Plan: Dynamic signs registry writes (transactions, where an allowlist and value cap apply); Nansen x402 payments use a small dedicated key. An on-chain test of a blocked transaction is still to do | 2026-10-09 |
| V7 | Cheapest route to get USDC and MON onto Monad mainnet | **Done.** USDC bridged from Ethereum over Circle CCTP; Ethereum gas (paid in USDC through MetaMask Gas Station) cost about $1.4 per transaction. An exchange withdrawal on the Monad network is cheaper | 2026-10-09 |
| V8 | Circle faucet limit | **Pass.** A claim gave 20 USDC on Monad Testnet, sent from `0x984a5543ea0863f0df3e443bf8e26c242eef633e` (added to the known-hub list) | 2026-10-09 |
| V9 | May raw Nansen responses be cached, and for how long? | Open | |
| V10 | Free hosting for the analyzer with a persistent disk | Open | |
| V11 | Do all bounties stack with Track 04? | Open | |
| V12 | Enough unrelated active Monad wallets for negative controls? | Open | |

## Gate 1 (9 Oct)

- **HyperSync returns the testnet farm's funder: pass.** `npm run assess -w @argus/analyzer -- --network testnet --labels` gives 10 farm wallets Linked (high, one operator, funder `0xa341…96e4`), 3 faucet-funded wallets Independent (high), 13 wallets to 4 customers, 13/13 against ground truth, in 6 HyperSync queries and about 3 s.
- Registry on Monad testnet: `0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE` (source verified on Sourcify).
- **One Nansen x402 call on mainnet: pass.** `npm run nansen-x402 -w @argus/analyzer` paid 0.01 USDC on Monad mainnet (`eip155:143`) from the analyzer wallet, tx `0x06f762f1df16191108aaeae21841489a8a30e3aa1dc41f78c7437490104bc302`; HTTP 200 with the First Funder relation. No API key sent.
- SG-4 (Dynamic typed-data policies): answered from the docs, policies do not cover EVM typed data (see V6).
- Nansen accepts x402 payment in USDC on Monad mainnet (`eip155:143`), 0.01 USDC per call.

## Mainnet setup (9 Oct)

- Registry on Monad mainnet: `0x151e488618FC0F79F7f91447351174Fb8D98cE98` (source submitted to Sourcify).
- Mainnet farm funded: F sent an identical 0.20 USDC to 10 wallets within 13 seconds. The light check gives all 10 Linked, high confidence, one operator.
- Mainnet independent 1 is the team wallet; its first USDC came from a bridge payout address with 2,606 recipients (a hub), so it is Independent.
- Mainnet independents 2 and 3 get their first USDC by swapping their own MON on Uniswap v3 (WMON/USDC 0.3% pool), so the first USDC sender is a public pool.
- Finding: Nansen's `related-wallets` "First Funder" for the team wallet differs from the first USDC sender found by HyperSync; it appears to track the first native-token funder. The Nansen provider must take the first USDC funder from `transactions`, or the agreement check would report a false disagreement.

## Gate 2 (reached 9 Oct)

- **Judge simulation runs end to end on testnet: pass.** `POST /v1/sim/run` sent 39 real x402 payments (13 wallets x 3 calls) through the seller, the Argus middleware and the Monad facilitator in 54 s, in a fresh promo namespace. The farm of 10 received exactly 20 promo calls in total (one shared allowance); each independent received its own promo.
- **Dashboard shows 13 wallets as 4 customers: pass.** `GET /v1/overview?network=testnet` returns 13 paying wallets, 4 customers (1 operator of 10, 3 independents); verdicts published to the testnet registry.

## Envio (9 Oct)

- Indexer deployed on Envio Cloud (`rohitamalraj/argus`, root `indexer`, branch `main`, HyperIndex 3.14.0): both chains (143, 10143) synced 100% in under a minute.
- Live GraphQL (testnet): 75 payments from 13 distinct payers to the demo seller, 4 on-chain operators (1 Linked with 10 wallets, 3 Independent).
- The dashboard's "On-chain activity" panel reads these numbers from the Envio GraphQL API (DB-5).

# Day-0 checks

Results of the verification checklist in the PRD. Each check has a fallback, so none can stop the build.

| ID | Check | Result | Date |
| --- | --- | --- | --- |
| V1 | Can `@x402/express` set a different price per payer? | Open | |
| V2 | Can HyperIndex filter USDC transfers to the seller wallets only? | Open | |
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
- One Nansen x402 call on mainnet: open.
- SG-4 (Dynamic typed-data policies): answered from the docs, policies do not cover EVM typed data (see V6).
- Nansen accepts x402 payment in USDC on Monad mainnet (`eip155:143`), 0.01 USDC per call.

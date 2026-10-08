# Day-0 checks

Results of the verification checklist in the PRD. Each check has a fallback, so none can stop the build.

| ID | Check | Result | Date |
| --- | --- | --- | --- |
| V1 | Can `@x402/express` set a different price per payer? | Open | |
| V2 | Can HyperIndex filter USDC transfers to the seller wallets only? | Open | |
| V3 | How long does Nansen take to see a new Monad wallet? | Open. A wallet bridged in on 2026-10-08 19:57 UTC already had its First Funder in `related-wallets` on 2026-10-09 | 2026-10-09 |
| V4 | HyperSync mainnet URL, and is an API token needed? | **Pass.** `https://monad.hypersync.xyz` (mainnet) and `https://monad-testnet.hypersync.xyz` both answer; queries need a bearer token (bad token returns 401), free from envio.dev | 2026-10-09 |
| V5 | Nansen API key (for MCP and CLI)? | **Pass.** Free plan: 100 credits plus 10 per day; profiler calls cost 1 credit. `related-wallets --chain monad` works on mainnet | 2026-10-09 |
| V6 | Do Dynamic policies apply to EIP-3009 typed-data signing on Monad (SG-4)? | Open. Environment and API token valid; Monad Mainnet (143) and Testnet (10143) enabled | |
| V7 | Cheapest route to get USDC and MON onto Monad mainnet | **Done.** USDC bridged from Ethereum over Circle CCTP; Ethereum gas (paid in USDC through MetaMask Gas Station) cost about $1.4 per transaction. An exchange withdrawal on the Monad network is cheaper | 2026-10-09 |
| V8 | Circle faucet limit | **Pass.** A claim gave 20 USDC on Monad Testnet, sent from `0x984a5543ea0863f0df3e443bf8e26c242eef633e` (added to the known-hub list) | 2026-10-09 |
| V9 | May raw Nansen responses be cached, and for how long? | Open | |
| V10 | Free hosting for the analyzer with a persistent disk | Open | |
| V11 | Do all bounties stack with Track 04? | Open | |
| V12 | Enough unrelated active Monad wallets for negative controls? | Open | |

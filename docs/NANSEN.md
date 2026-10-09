# How Argus uses Nansen

> Powered by Nansen API.

Argus decides whether many wallets paying an x402 seller belong to one operator. The free chain-data check (Envio HyperSync) finds each wallet's first USDC funder and every other wallet that funder seeded. On **Monad mainnet**, when a wallet claims a promo, Argus asks **Nansen** the same questions independently. Two sources that agree raise confidence; two that disagree make the verdict Unclear. Nansen has no Monad testnet, so the deep check runs on mainnet only.

## What we call

Only redistributable Profiler endpoints, chain `monad`:

| Endpoint | Used for | Credits |
| --- | --- | --- |
| `POST /api/v1/profiler/address/transactions` | The wallet's earliest inbound transfer of the **real USDC contract**: Nansen's view of the first funder | 1 per wallet |
| `POST /api/v1/profiler/address/counterparties` | How many wallets the funder sent real USDC to: a cross-check of the group size | 5, once per funder |

We never call or show labels, premium labels or smart-money data, and no evidence bundle contains any. Raw responses are not stored; the bundle keeps summaries and hashes only. "Powered by Nansen API" appears in the evidence bundle, the dashboard cost panel and the README.

## When it runs

| Event | Check |
| --- | --- |
| Any wallet that pays a seller | Free light check (HyperSync) |
| A **settled promo claim on mainnet** | Deep check: light + Nansen |
| Testnet | Never |

The middleware tells the analyzer when a settled payment was at the promo price (`promo: true` on `POST /v1/paid`). The analyzer then runs `assess` at depth `deep` for that wallet, which upgrades a cached light verdict.

## Cost control (AN-8, AN-9)

- **Daily cap**: `NANSEN_DAILY_CAP_USD` (default $0.60, 1 credit = $0.01). At the cap the analyzer falls back to the light check.
- **Per-wallet cap**: at most 3 paid calls per wallet or funder per day.
- **Circuit breaker**: three failures in a row pause Nansen for a minute. A Nansen outage never blocks a verdict.
- **Rate limit**: calls are spaced 1.1 s apart (Nansen allows 5 a second and 60 a minute).
- **Charged credits** are read from the `X-Nansen-Credits-Used` response header, so reported cost matches what Nansen charges.
- **Two ways to pay**: the API key first (free plan: 100 credits + 10 a day). If the key is out of credits (HTTP 402/403/429) and `NANSEN_PAY_X402=true`, Argus pays per call in USDC on Monad (`eip155:143`) from the analyzer wallet, **sending no key** (a valid key would take precedence over payment). Pay-per-call is off by default because it spends real USDC.

One deep check of the 13-wallet mainnet demo costs 14 calls, $0.18: 13 `transactions` + 1 `counterparties` (one funder).

## What we learned about Nansen on Monad

1. **Match the token by address, never by symbol.** Nansen's transaction history for a demo wallet contains a fake `UṢDC` token (a dot under the S) sent from a lookalike of our funder address: address poisoning, seen live on mainnet. Argus compares `token_address` with the real USDC contract (`0x7547…b603`), so the lookalike is ignored. A unit test pins this with the recorded response (`fixtures/nansen/transactions-farm01.json`).
2. **`related-wallets` "First Funder" tracks the first native-token (MON) funder.** x402 payers never need MON, so for USDC-only wallets it returns nothing. Argus takes the first funder from `transactions` instead.
3. **`transactions` can be ordered oldest-first** (`order_by: [{ field: "block_timestamp", direction: "ASC" }]`), so the first funding transfer is on page 1. The REST body is `{ pagination, data: [...] }`.
4. **Nansen indexes new Monad wallets quickly.** A wallet bridged in at 19:57 UTC on 8 Oct and a farm funded at 21:07 UTC were both visible when we checked the next morning; we did not measure the exact lag.
5. **`counterparties` is 5 credits**, so it runs once per funder, not per wallet.

## Result on the mainnet demo

`npm run assess-deep -w @argus/analyzer` (HyperSync + Nansen, nothing published on-chain):

- 10 farm wallets: **Linked, high confidence**, one operator; sources agree on the funder; Nansen sees the funder paying 10 wallets.
- 3 independents (a bridge-funded wallet and two that bought USDC on a DEX): **Independent, high confidence**; sources agree.
- **13 wallets resolve to 4 customers, 13/13 correct**, in 82 s, 14 Nansen calls, $0.18.

## Nansen MCP and CLI

The Nansen CLI (`nansen`) is installed and used during development. The investigator (explains a group in plain language) is designed to use Nansen's hosted MCP server at `https://mcp.nansen.ai/ra/mcp` when a key is present, and the evidence bundle otherwise.

# Argus indexer (Envio HyperIndex)

Indexes Argus data on **Monad mainnet (143)** and **Monad testnet (10143)** in one indexer:

| Source | Event | Entities |
| --- | --- | --- |
| `PayerAttestations` registry | `Attested(wallet, attestor, operatorId, tier, expiresAt)` | `Verdict`, `Operator` (wallet and Linked counts per operator) |
| USDC, filtered to the demo sellers' payTo wallets only | `Transfer(from, to, value)` | `SellerPayment`, `Payer`, `SellerStats` |

The USDC handler uses a topic filter on `to`, so only payments to the demo sellers are synced, not every USDC transfer.
Funding edges are not indexed here: the analyzer queries them from HyperSync on demand.

## Run

Envio needs Linux or WSL 2.

```bash
pnpm install
pnpm codegen
pnpm test     # handler unit tests + a run against real Monad testnet blocks
pnpm dev      # local indexer + GraphQL (needs Docker)
```

## Deploy (Envio Cloud)

Connect the GitHub repo in https://envio.dev/app, set **root directory** to `indexer` and the config file to `config.yaml`, then push to the deployment branch.

## Example query

```graphql
query {
  SellerStats(where: { chainId: { _eq: 10143 } }) { seller paymentCount distinctPayers totalReceived }
  Operator(where: { chainId: { _eq: 10143 }, walletCount: { _gt: 0 } }) { operatorId tierName walletCount linkedCount }
}
```

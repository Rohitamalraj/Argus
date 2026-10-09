# Deploy the live demo

Judges need one link, no keys and no funds. Three pieces:

| Piece | Host | Why |
| --- | --- | --- |
| Dashboard and docs site (`apps/dashboard`) | Vercel | Static-ish Next.js, free |
| Analyzer + demo seller (`Dockerfile`) | Render (or any Docker host) | Needs a long-running Node process; runs the one-click testnet simulation |
| Indexer | Envio Cloud | Already deployed from `indexer/` |

## 1. Analyzer and demo seller on Render

`render.yaml` describes the service. In Render: **New, Blueprint, pick this repo**. Then set the secrets it asks for:

| Variable | Value |
| --- | --- |
| `ENVIO_API_TOKEN` | your HyperSync token |
| `NANSEN_API_KEY` | your Nansen key (optional; without it the deep check is off) |
| `ATTESTOR_SALT` | the `ATTESTOR_SALT` value from your local `.env`, so operator ids stay consistent |
| `WALLETS_TESTNET_B64` | the testnet demo wallets, base64 (below) |

```bash
node -e "process.stdout.write(require('fs').readFileSync('wallets.testnet.json').toString('base64'))"
```

`WALLETS_TESTNET_B64` holds **testnet keys only** (the 13 demo wallets, the seller and the attestor). Never put mainnet keys on the host: `PUBLISH_MAINNET` stays `false`, so the hosted analyzer never spends mainnet MON.

When it is live, `https://<service>.onrender.com/health` returns `{"ok":true}` and `POST /v1/sim/run` runs the 13-wallet simulation (about a minute).

The free plan sleeps after 15 minutes without traffic and takes about a minute to wake. Open the link yourself shortly before submitting, or use the Starter plan for the judging window.

## 2. Dashboard on Vercel

Import the repo and set **Root Directory** to `apps/dashboard`. Environment variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_ANALYZER_URL` | the Render URL from step 1 |
| `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` | the Envio production GraphQL URL (step 3) |

## 3. Envio

Each push to `main` makes a new deployment (3 allowed). In the Envio dashboard, delete old deployments, then **Promote** the one you want: promotion gives a stable production endpoint that does not change on redeploys. Use that URL above.

## 4. Access instructions for judges

> Open the site. **Agents**: type any ERC-8004 agent id (try 182) and see its reviewers collapse into operators. **Dashboard**: press *Run simulation* to send 39 real x402 payments from 13 pre-funded Monad testnet wallets; 13 wallets resolve to 4 customers. No wallet, keys or funds needed. Registries: mainnet `0x151e488618FC0F79F7f91447351174Fb8D98cE98`, testnet `0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE`.

## Checklist before submitting

- [ ] Render `/health` answers; the simulation runs from the dashboard in a fresh browser
- [ ] `/agents?agent=182` shows 7,665 → 1
- [ ] Envio endpoint promoted; the dashboard's "On-chain activity" panel shows payments
- [ ] Testnet demo wallets still hold USDC (`npm run status -w @argus/farm-sim -- --network testnet`); the simulation tops them up from the seller after each run
- [ ] Secrets scan: `git grep -nE "nsn_|dyn_|privateKey"` finds nothing

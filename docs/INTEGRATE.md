# Integrate Argus

Five ways in, from smallest to most involved. Everything reads public Monad chain data. You need a free Envio HyperSync token for anything that reads funding history: https://envio.dev/app/api-tokens

> All four packages are on npm (`argus-x402-sdk`, `argus-x402-mcp`, `argus-x402-middleware`, `argus-x402-scoring`). The command line tool is `argus-x402`, inside `argus-x402-sdk`: run it with `npx -p argus-x402-sdk argus-x402 <command>`.

## 1. x402 seller: one promo per operator

```bash
npm install argus-x402-middleware express
```

```ts
import { argus } from 'argus-x402-middleware';

app.use(
  argus({
    network: 'mainnet',
    payTo: SELLER_WALLET,
    price: { standard: '$0.01', promo: '$0.005' },
    routes: ['GET /api/premium'],
    policy: { promoCalls: 20 },
    attestors: ['0xF9E8A2cc9600499AA009357a8Fa63F15079A4238'], // whose verdicts you trust
    analyzerUrl: process.env.ANALYZER_URL, // optional: verdicts for brand-new wallets
  }),
);
```

How it behaves:

- A buyer sends `X-Payer-Address` on the unpaid request; the middleware answers 402 at the promo or the standard price. The header is a claim, so on the paid retry the **signed** payer is decoded and checked; a mismatch is re-quoted at the standard price.
- Verdict lookup order: local cache, the on-chain registry for your trusted attestors, then the analyzer within 300 ms. Anything missing or expired reads as Unclear (standard price).
- A Linked fleet shares one promo allowance; Independent wallets get their own. Counters move only after a payment settles.
- A wallet with no verdict anywhere gets one promo call while it is assessed in the background.
- If the registry or analyzer is down, everyone pays the standard price. It never blocks a paying request.
- `req.argus` exposes `tierName`, `reasons`, `price` and `promoLeft` to your handler.

A working seller is in [`apps/seller-demo`](../apps/seller-demo); `npm run pay -w @argus/farm-sim` sends real x402 payments to it.

## 2. Developer: verify a verdict, or de-duplicate reputation

```bash
npm install argus-x402-sdk
```

```ts
import { createArgus } from 'argus-x402-sdk';

const argus = createArgus({ network: 'mainnet', hypersyncToken: process.env.ENVIO_API_TOKEN });

await argus.checkWallet(wallet);   // verdict recomputed locally from public chain data
await argus.verify(wallet);        // does the published on-chain verdict match?
await argus.verdictOf(wallet);     // just read the on-chain verdict (no token needed)
```

The same from a terminal: `npx -p argus-x402-sdk argus-x402 check <wallet>`, `... verify <wallet>`, `... reputation <agentId>` (after `npm install argus-x402-sdk` the command is simply `argus-x402`).

## 3. ERC-8004: reputation counted by operator

```ts
const rep = await argus.agentReputation(182, { maxClients: 800 }); // sample big agents for speed

rep.raw.distinctClients;     // 7665 reviewers
rep.independent.operators;   // operators behind them (in the sample)
rep.independent.meanValue;   // mean feedback value counting each operator once
rep.largestOperatorShare;    // share of reviewers held by the largest operator
rep.operators;               // each operator, with the reasons it was merged
```

To get a registry-side Sybil-filtered summary, pass `rep.clientAllowlist` (one reviewer per operator) to `getSummary`:

```ts
import { NETWORKS, reputationAbi } from 'argus-x402-sdk';

const [count, value, decimals] = await publicClient.readContract({
  address: NETWORKS.mainnet.erc8004.reputation,
  abi: reputationAbi,
  functionName: 'getSummary',
  args: [182n, rep.clientAllowlist, '', ''], // empty tags = no tag filter
});
```

The allowlist de-duplicates **reviewers**, not entries: a reviewer on the list still counts every entry it made. For one operator with many entries, `rep.independent.meanValue` (each operator counted once) is the stronger figure.

Values beyond 1e15 (int128 extremes, seen on mainnet) are left out of every mean and counted in `rep.raw.implausibleValues`. Details and live results: [ERC8004.md](ERC8004.md).

## 4. AI agent: MCP tools

```bash
claude mcp add argus -e ENVIO_API_TOKEN=<token> -- npx -y argus-x402-mcp
```

Tools: `argus_check_wallet`, `argus_same_operator`, `argus_agent_reputation`, `argus_verify_attestation`. All read-only. Ask: *"Agent 182 on Monad has thousands of ERC-8004 reviews. How many independent operators are behind them?"* The server instructions tell the model to say "shares a funder", never "fraud". See [packages/mcp](../packages/mcp).

## 5. Smart contract: gate by tier

```solidity
import {PayerAttestations} from "./PayerAttestations.sol";
import {ArgusGate} from "./ArgusGate.sol";

contract Airdrop is ArgusGate {
    address constant ATTESTOR = 0xF9E8A2cc9600499AA009357a8Fa63F15079A4238;
    uint8 constant ALLOWED = (1 << 2) | (1 << 3); // Independent or Verified

    constructor(PayerAttestations registry) ArgusGate(registry) {}

    function claim() external onlyTiers(ATTESTOR, ALLOWED) { /* ... */ }
}
```

`onlyTiers(attestor, mask)` takes a bit per tier. There is no "at least tier N": a Linked wallet fails a gate that allows Independent and Verified, and a missing or expired verdict reads as Unclear. Registries: mainnet `0x151e488618FC0F79F7f91447351174Fb8D98cE98`, testnet `0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE`.

## Run your own attestor

Nobody has to trust the hosted analyzer. `PayerAttestations` stores verdicts per `(wallet, attestor)`, anyone can call `attest`, and consumers name whom they trust (`attestors` in the middleware, the `attestor` argument in the gate and the SDK). To run one, start [`services/analyzer`](../services/analyzer) with your own key (`ATTESTOR_KEY_<NETWORK>`, `ATTESTOR_SALT`) and publish. Because scoring is deterministic and the evidence is public, a consumer can also skip attestors altogether and call `checkWallet` locally.

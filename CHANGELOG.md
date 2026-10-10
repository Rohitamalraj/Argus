# Changelog

## 0.2.0 / 0.1.x (10 Oct 2026)

- **argus-x402-sdk 0.2.0**: ERC-8004 reputation flags reviewers funded by (or equal to) the agent's own owner (`ownerLinked`, `unrelatedToOwner`) and reads the agent's name; contract reviewers are grouped by deployer; separate native-MON hub list; `checkWallets` batching and `localResolver`.
- **argus-x402-middleware 0.2.0**: Hono (`/hono`) and Next.js (`/next`) adapters on a shared core (`createCore`); verify payers with no Argus server (`resolver`); promo counters survive restarts (`FilePromoStore`).
- **argus-x402-mcp 0.1.2**: `argus_agent_reputation` reports owner-funded reviewers and the agent's name.
- **argus-x402-scoring 0.1.1**: `KNOWN_NATIVE_HUBS`, `knownNativeHubsFor`.

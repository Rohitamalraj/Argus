# @argus/mcp

An MCP server that lets AI agents ask: **are these wallets really independent, and how much of this reputation is real?**

It recomputes answers from public Monad chain data. No wallet address is sent to an Argus server.

## Tools

| Tool | What an agent asks |
| --- | --- |
| `argus_check_wallet` | Is this wallet a Linked fleet member or an Independent customer? Why? |
| `argus_same_operator` | Are these two wallets (or agents) run by the same operator? |
| `argus_agent_reputation` | This ERC-8004 agent has N reviewers. How many independent operators are behind them? Returns a one-reviewer-per-operator allowlist for the registry's `getSummary` |
| `argus_verify_attestation` | An attestor published a verdict on-chain for this wallet. Does it match a local recomputation? |

All four are read-only. Results carry their reasons, and the server instructions tell the model to say "shares a funder", never "fraud".

## Use it

You need a free Envio HyperSync token: https://envio.dev/app/api-tokens

```bash
# Claude Code (from the repo root)
claude mcp add argus -e ENVIO_API_TOKEN=<token> -- node --import tsx packages/mcp/src/main.ts
```

```jsonc
// Claude Desktop / any MCP client: claude_desktop_config.json
{
  "mcpServers": {
    "argus": {
      "command": "node",
      "args": ["--import", "tsx", "D:/path/to/Argus/packages/mcp/src/main.ts"],
      "env": { "ENVIO_API_TOKEN": "<token>" }
    }
  }
}
```

Then ask: *"Agent 182 on Monad has thousands of ERC-8004 reviews. How many independent operators are behind them?"*

## Develop

```bash
npm test -w @argus/mcp
```

The tests connect a real MCP client to the server over an in-memory transport.

import { indexer, type Operator } from "envio";

const TIER_NAMES = ["Unclear", "Linked", "Independent", "Verified"];

/** Demo seller payTo wallets per chain: only USDC transfers to these are indexed (EN-2). */
export const SELLERS: Record<number, `0x${string}`[]> = {
  143: ["0x038e145fa0d1432b4cf16cf3257d8cc1d64682fd"],
  10143: ["0x4287d6fde3b7ea6d769648f030a27178f490c075"],
};

const ZERO_OPERATOR = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** EN-3: latest verdict per (wallet, attestor), and per-operator wallet counts derived from it. */
indexer.onEvent(
  { contract: "PayerAttestations", event: "Attested", fields: { transaction: ["hash"], block: ["timestamp"] } },
  async ({ event, context }) => {
    const { wallet, attestor, operatorId, tier, expiresAt } = event.params;
    const chainId = event.chainId;
    const ts = event.block.timestamp;
    const id = `${chainId}-${wallet}-${attestor}`;
    const tierNum = Number(tier);
    const opKey = (op: string) => `${chainId}-${attestor}-${op}`;

    const prev = await context.Verdict.get(id);
    const prevOp = prev && prev.operatorId !== ZERO_OPERATOR ? await context.Operator.get(opKey(prev.operatorId)) : undefined;
    const nextOp = operatorId !== ZERO_OPERATOR ? await context.Operator.get(opKey(operatorId)) : undefined;

    context.Verdict.set({
      id,
      chainId,
      wallet,
      attestor,
      operatorId,
      tier: tierNum,
      tierName: TIER_NAMES[tierNum] ?? "Unknown",
      expiresAt,
      attestedAt: ts,
      txHash: event.transaction.hash,
      updates: (prev?.updates ?? 0) + 1,
    });

    const sameOperator = prev?.operatorId === operatorId;
    // Leaving the previous operator (re-assessment moved the wallet).
    if (prevOp && !sameOperator) {
      context.Operator.set({
        ...prevOp,
        walletCount: prevOp.walletCount - 1,
        linkedCount: prevOp.linkedCount - (prev!.tier === 1 ? 1 : 0),
      });
    }
    if (operatorId === ZERO_OPERATOR) return;

    const base: Operator = nextOp ?? {
      id: opKey(operatorId),
      chainId,
      attestor,
      operatorId,
      tierName: TIER_NAMES[tierNum] ?? "Unknown",
      walletCount: 0,
      linkedCount: 0,
      lastAttestedAt: ts,
    };
    const joining = !sameOperator;
    const linkedDelta = (tierNum === 1 ? 1 : 0) - (sameOperator && prev!.tier === 1 ? 1 : 0);
    context.Operator.set({
      ...base,
      tierName: TIER_NAMES[tierNum] ?? base.tierName,
      walletCount: base.walletCount + (joining ? 1 : 0),
      linkedCount: base.linkedCount + (joining ? (tierNum === 1 ? 1 : 0) : linkedDelta),
      lastAttestedAt: ts,
    });
  },
);

/** EN-2: USDC payments to the demo sellers only (topic filter on `to`), so sync stays small. */
indexer.onEvent(
  {
    contract: "USDC",
    event: "Transfer",
    where: ({ chain }) => ({ params: [{ to: SELLERS[chain.id] ?? [] }] }),
    fields: { transaction: ["hash"], block: ["timestamp"] },
  },
  async ({ event, context }) => {
    const { from, to, value } = event.params;
    const chainId = event.chainId;
    const ts = event.block.timestamp;
    const payerId = `${chainId}-${to}-${from}`;
    const statsId = `${chainId}-${to}`;
    const [payer, stats] = await Promise.all([context.Payer.get(payerId), context.SellerStats.get(statsId)]);

    context.SellerPayment.set({
      id: `${chainId}-${event.block.number}-${event.logIndex}`,
      chainId,
      seller: to,
      payer: from,
      amount: value,
      ts,
      txHash: event.transaction.hash,
    });
    context.Payer.set({
      id: payerId,
      chainId,
      seller: to,
      wallet: from,
      payments: (payer?.payments ?? 0) + 1,
      totalPaid: (payer?.totalPaid ?? 0n) + value,
      firstPaidAt: payer?.firstPaidAt ?? ts,
      lastPaidAt: ts,
    });
    context.SellerStats.set({
      id: statsId,
      chainId,
      seller: to,
      paymentCount: (stats?.paymentCount ?? 0) + 1,
      distinctPayers: (stats?.distinctPayers ?? 0) + (payer ? 0 : 1),
      totalReceived: (stats?.totalReceived ?? 0n) + value,
    });
  },
);

/** ERC-8004 feedback: how many entries, and from how many distinct reviewers, each agent has. */
indexer.onEvent(
  { contract: "ReputationRegistry", event: "NewFeedback", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const { agentId, clientAddress } = event.params;
    const chainId = event.chainId;
    const ts = event.block.timestamp;
    const agentKey = agentId.toString();
    const id = `${chainId}-${agentKey}`;
    const clientId = `${id}-${clientAddress}`;
    const [agent, client] = await Promise.all([context.Agent.get(id), context.AgentClient.get(clientId)]);

    context.AgentClient.set({
      id: clientId,
      chainId,
      agentId: agentKey,
      client: clientAddress,
      liveFeedback: (client?.liveFeedback ?? 0) + 1,
      firstAt: client?.firstAt ?? ts,
    });
    context.Agent.set({
      id,
      chainId,
      agentId: agentKey,
      feedbackCount: (agent?.feedbackCount ?? 0) + 1,
      // a reviewer counts again only when it comes back from zero live entries
      distinctClients: (agent?.distinctClients ?? 0) + (client && client.liveFeedback > 0 ? 0 : 1),
      revokedCount: agent?.revokedCount ?? 0,
      firstFeedbackAt: agent?.firstFeedbackAt ?? ts,
      lastFeedbackAt: ts,
    });
  },
);

indexer.onEvent(
  { contract: "ReputationRegistry", event: "FeedbackRevoked" },
  async ({ event, context }) => {
    const { agentId, clientAddress } = event.params;
    const chainId = event.chainId;
    const id = `${chainId}-${agentId.toString()}`;
    const clientId = `${id}-${clientAddress}`;
    const [agent, client] = await Promise.all([context.Agent.get(id), context.AgentClient.get(clientId)]);
    if (!agent || !client || client.liveFeedback === 0) return;
    context.AgentClient.set({ ...client, liveFeedback: client.liveFeedback - 1 });
    context.Agent.set({
      ...agent,
      feedbackCount: agent.feedbackCount - 1,
      revokedCount: agent.revokedCount + 1,
      distinctClients: agent.distinctClients - (client.liveFeedback === 1 ? 1 : 0),
    });
  },
);

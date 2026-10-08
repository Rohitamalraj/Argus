import { describe, it } from "vitest";
import { TestHelpers, createTestIndexer } from "envio";

const { Addresses } = TestHelpers;
type Hex = `0x${string}`;
const lower = (a: string) => a.toLowerCase() as Hex;
const ATTESTOR: Hex = "0x6e7a4132c27248f56b4aeee2513d6655370a323b";
const SELLER: Hex = "0x4287d6fde3b7ea6d769648f030a27178f490c075";
const OP_A = "0x" + "aa".repeat(32);
const OP_B = "0x" + "bb".repeat(32);
const ZERO = "0x" + "00".repeat(32);

const attested = (wallet: Hex, operatorId: string, tier: bigint) => ({
  contract: "PayerAttestations" as const,
  event: "Attested" as const,
  params: { wallet, attestor: ATTESTOR, operatorId, tier, expiresAt: 1_800_000_000n },
});

describe("verdicts and operators (EN-3)", () => {
  it("counts a fleet of Linked wallets as one operator", async (t) => {
    const indexer = createTestIndexer();
    const [a, b, c, d] = Addresses.mockAddresses.map(lower);
    await indexer.process({
      chains: {
        10143: {
          simulate: [attested(a!, OP_A, 1n), attested(b!, OP_A, 1n), attested(c!, OP_A, 1n), attested(d!, OP_B, 2n)],
        },
      },
    });

    const fleet = await indexer.Operator.getOrThrow(`10143-${ATTESTOR}-${OP_A}`);
    t.expect({ walletCount: fleet.walletCount, linkedCount: fleet.linkedCount, tierName: fleet.tierName }).toEqual({
      walletCount: 3,
      linkedCount: 3,
      tierName: "Linked",
    });
    const indie = await indexer.Operator.getOrThrow(`10143-${ATTESTOR}-${OP_B}`);
    t.expect(indie.walletCount).toBe(1);
    t.expect((await indexer.Verdict.getOrThrow(`10143-${a}-${ATTESTOR}`)).tierName).toBe("Linked");
  });

  it("moves a wallet between operators when it is re-assessed", async (t) => {
    const indexer = createTestIndexer();
    const w = lower(Addresses.mockAddresses[0]!);
    await indexer.process({
      chains: { 10143: { simulate: [attested(w, OP_B, 2n), attested(w, OP_A, 1n), attested(w, OP_A, 1n)] } },
    });
    t.expect((await indexer.Operator.getOrThrow(`10143-${ATTESTOR}-${OP_B}`)).walletCount).toBe(0);
    const a = await indexer.Operator.getOrThrow(`10143-${ATTESTOR}-${OP_A}`);
    t.expect({ walletCount: a.walletCount, linkedCount: a.linkedCount }).toEqual({ walletCount: 1, linkedCount: 1 });
    t.expect((await indexer.Verdict.getOrThrow(`10143-${w}-${ATTESTOR}`)).updates).toBe(3);
  });

  it("an Unclear verdict has no operator", async (t) => {
    const indexer = createTestIndexer();
    const w = lower(Addresses.mockAddresses[1]!);
    await indexer.process({ chains: { 10143: { simulate: [attested(w, ZERO, 0n)] } } });
    t.expect(await indexer.Operator.getAll()).toEqual([]);
    t.expect((await indexer.Verdict.getOrThrow(`10143-${w}-${ATTESTOR}`)).tierName).toBe("Unclear");
  });
});

describe("seller payments (EN-2)", () => {
  it("tracks payments, distinct payers and totals per seller", async (t) => {
    const indexer = createTestIndexer();
    const [p1, p2] = Addresses.mockAddresses.map(lower);
    const pay = (from: Hex, value: bigint) => ({
      contract: "USDC" as const,
      event: "Transfer" as const,
      params: { from, to: SELLER, value },
    });
    await indexer.process({ chains: { 10143: { simulate: [pay(p1!, 1000n), pay(p1!, 2000n), pay(p2!, 1000n)] } } });

    const stats = await indexer.SellerStats.getOrThrow(`10143-${SELLER}`);
    t.expect({ paymentCount: stats.paymentCount, distinctPayers: stats.distinctPayers, totalReceived: stats.totalReceived }).toEqual({
      paymentCount: 3,
      distinctPayers: 2,
      totalReceived: 4000n,
    });
    const payer = await indexer.Payer.getOrThrow(`10143-${SELLER}-${p1}`);
    t.expect({ payments: payer.payments, totalPaid: payer.totalPaid }).toEqual({ payments: 2, totalPaid: 3000n });
  });
});

describe("real testnet data (EN-1)", () => {
  it("indexes the first Argus attestation published on Monad testnet", async (t) => {
    const indexer = createTestIndexer();
    const result = await indexer.process({ chains: { 10143: {} } });
    t.expect(result.changes.length).toBeGreaterThan(0);
    const verdicts = await indexer.Verdict.getAll();
    const payments = await indexer.SellerPayment.getAll();
    t.expect(verdicts.length + payments.length).toBeGreaterThan(0);
    // block timestamps are selected, so they are real values, not missing fields
    for (const v of verdicts) t.expect(v.attestedAt).toBeGreaterThan(1_700_000_000);
    for (const p of payments) t.expect(p.ts).toBeGreaterThan(1_700_000_000);
  });
});

import { AsyncLocalStorage } from 'node:async_hooks';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { claimedPayer, decodePayment, fromPayload } from './payer.ts';
import { DEFAULT_POLICY, MemoryPromoStore, quote, type Quote } from './policy.ts';
import type { Address, ArgusInfo, ArgusNetwork, ArgusOptions, PromoStore } from './types.ts';
import { VerdictSource } from './verdicts.ts';

export const ARGUS_NETWORKS: Record<ArgusNetwork, { caip: `eip155:${number}`; usdc: Address; registry: Address }> = {
  mainnet: { caip: 'eip155:143', usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', registry: '0x151e488618FC0F79F7f91447351174Fb8D98cE98' },
  testnet: { caip: 'eip155:10143', usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3', registry: '0xd60EBFbc9955951322e9410Ec833bA040E9dB8dE' },
};
export const MONAD_FACILITATOR = 'https://x402-facilitator.molandak.org';

/** '$0.005' -> 5000 USDC base units. */
export const usdToUnits = (price: string): bigint => BigInt(Math.round(parseFloat(price.replace('$', '')) * 1_000_000));

export interface ArgusDeps {
  store?: PromoStore;
  verdicts?: Pick<VerdictSource, 'lookup' | 'invalidate'>;
  resourceServer?: x402ResourceServer;
  fetch?: typeof fetch;
}

/** The little of a request Argus needs, so one core serves Express, Hono and Next. */
export interface ArgusRequest {
  method: string;
  path: string;
  header(name: string): string | string[] | undefined | null;
  /** The framework's own request, passed to the `namespace` option. */
  raw?: unknown;
}

/** What `begin` decides for one request. Run the payment middleware inside `core.run(ctx, ...)`. */
export interface ArgusContext {
  info: ArgusInfo;
  quote: Quote;
}

/** The framework-independent part of Argus: verdicts, promo quoting, settlement counting. */
export function createCore(o: ArgusOptions, deps: ArgusDeps = {}) {
  const net = ARGUS_NETWORKS[o.network];
  const policy = { ...DEFAULT_POLICY, ...o.policy };
  const store = deps.store ?? o.store ?? new MemoryPromoStore();
  const doFetch = deps.fetch ?? fetch;
  const log = o.log ?? (() => {});
  const verdicts =
    deps.verdicts ??
    new VerdictSource({
      network: o.network,
      registry: o.registry ?? net.registry,
      attestors: o.attestors ?? [],
      rpcUrl: o.rpcUrl,
      analyzerUrl: o.analyzerUrl,
      ...(o.resolver ? { resolver: o.resolver } : {}),
      lookupTimeoutMs: o.lookupTimeoutMs ?? 300,
    });
  const units = { standard: usdToUnits(o.price.standard), promo: usdToUnits(o.price.promo) };
  const als = new AsyncLocalStorage<ArgusContext>();
  /** Promo keys of paid requests waiting for settlement, by authorization nonce. */
  const pendingPromo = new Map<string, string>();
  /** What was decided for a paid request, by authorization nonce, so the settlement report can say it. */
  const pendingInfo = new Map<string, { tierName: string; operatorId?: string; promoLeft: number; ns: string }>();

  const assetAmount = (amount: bigint) => ({ amount: amount.toString(), asset: net.usdc, extra: { name: 'USDC', version: '2' } });
  const server =
    deps.resourceServer ??
    new x402ResourceServer(new HTTPFacilitatorClient({ url: o.facilitatorUrl ?? MONAD_FACILITATOR })).register(net.caip, new ExactEvmScheme());

  /** Fire-and-forget calls to the analyzer; a failure never affects the request (MW-7). */
  function report(path: string, body: unknown, wallet: Address) {
    if (!o.analyzerUrl) return;
    doFetch(`${o.analyzerUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(() => verdicts.invalidate(wallet))
      .catch(() => {});
  }

  // Promo counters move only after a payment settles at the promo price.
  server.onAfterSettle(async (ctx) => {
    const paid = fromPayload(ctx.paymentPayload.payload);
    if (!paid) return;
    const key = paid.nonce ? pendingPromo.get(paid.nonce) : undefined;
    const decided = paid.nonce ? pendingInfo.get(paid.nonce) : undefined;
    if (paid.nonce) {
      pendingPromo.delete(paid.nonce);
      pendingInfo.delete(paid.nonce);
    }
    if (key && BigInt(ctx.requirements.amount) === units.promo) store.consume(key);
    log(`[argus] settled ${ctx.requirements.amount} from ${paid.from}${key ? ` (promo ${key})` : ''}`);
    report(
      '/v1/paid',
      {
        network: o.network,
        wallet: paid.from,
        seller: o.seller ?? 'seller',
        promo: !!key,
        // What a seller-facing "claims" view needs: the settlement, the price, and why.
        tx: ctx.result.transaction,
        amount: ctx.requirements.amount,
        ...(decided ?? {}),
      },
      paid.from,
    );
  });

  const routes = Object.fromEntries(
    o.routes.map((r) => [
      r,
      {
        accepts: {
          scheme: 'exact',
          network: net.caip,
          payTo: o.payTo,
          price: () => assetAmount(als.getStore()?.quote.price === 'promo' ? units.promo : units.standard),
          maxTimeoutSeconds: 120,
        },
        description: o.description ?? 'Argus-protected resource',
      },
    ]),
  );
  const matchers = o.routes.map(compileRoute);
  const assessing = new Map<string, number>();
  const first = (v: string | string[] | undefined | null) => (Array.isArray(v) ? v[0] : (v ?? undefined));

  return {
    server,
    routes,
    /** Does Argus protect this request? */
    matches: (req: ArgusRequest) => matchers.some((m) => m(req.method, req.path)),
    /** Look up the payer's verdict, quote the price, and remember the promo until it settles. */
    async begin(req: ArgusRequest): Promise<ArgusContext> {
      const claim = claimedPayer(first(req.header('x-payer-address')));
      const signed = decodePayment(first(req.header('payment-signature')) ?? first(req.header('x-payment')));
      const payer = signed?.from ?? claim;
      const mismatch = !!(claim && signed && claim !== signed.from);

      const verdict = payer ? await verdicts.lookup(payer) : undefined;
      if (payer && !verdict && (assessing.get(payer) ?? 0) < Date.now()) {
        assessing.set(payer, Date.now() + 30_000);
        report('/v1/assess', { network: o.network, wallets: [payer] }, payer); // MW-4: background assessment
      }
      const ns = o.namespace?.(req.raw as never) ?? o.seller ?? 'seller';
      const q = quote(payer, verdict, { policy, store, ns, mismatch });
      if (signed?.nonce && q.price === 'promo' && q.key) pendingPromo.set(signed.nonce, q.key);
      if (signed?.nonce) pendingInfo.set(signed.nonce, { tierName: verdict?.tierName ?? 'Unknown', ...(verdict?.operatorId ? { operatorId: verdict.operatorId } : {}), promoLeft: q.price === 'promo' ? Math.max(0, q.promoLeft - 1) : q.promoLeft, ns });

      const info: ArgusInfo = {
        ...(payer ? { payer } : {}),
        tier: verdict?.tier ?? 0,
        tierName: verdict?.tierName ?? 'Unknown',
        ...(verdict?.operatorId ? { operatorId: verdict.operatorId } : {}),
        ...(verdict?.confidence ? { confidence: verdict.confidence } : {}),
        reasons: [...(verdict?.reasons ?? []), q.reason],
        hints: [],
        price: q.price,
        promoLeft: q.promoLeft,
        ...(verdict ? { verdictSource: verdict.source } : {}),
      };
      return { info, quote: q };
    },
    /** Run `fn` so the route's price function sees this request's quote. */
    run: <T>(ctx: ArgusContext, fn: () => T): T => als.run(ctx, fn),
    /** The context of the request being handled, inside `run`. */
    current: () => als.getStore(),
  };
}
export type ArgusCore = ReturnType<typeof createCore>;

/** 'GET /api/premium' or 'GET /api/*' -> matcher. */
function compileRoute(route: string): (method: string, path: string) => boolean {
  const [verb, pattern] = route.includes(' ') ? route.split(/\s+/, 2) : ['*', route];
  const re = new RegExp('^' + pattern!.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return (method, path) => (verb === '*' || verb!.toUpperCase() === method.toUpperCase()) && re.test(path);
}

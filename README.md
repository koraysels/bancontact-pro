# bancontact-pro

Unofficial Node.js SDK for the **Bancontact Pro** (Payconiq) [Merchant Payment API v3](https://docs.bancontactpro.com). Create payments and verify webhook signatures, with full TypeScript types and zero runtime dependencies.

> Not affiliated with or endorsed by Bancontact Payments NV/SA. "Bancontact" is a trademark of its owner.

## Features

- **Payments** — create, fetch by id, and search by reference.
- **Webhook verification** — verify inbound callback signatures (detached JWS, ES256) using only Node's built-in `crypto`.
- **Typed** — every request and response is typed; helpers for the payment status model.
- **Safe defaults** — talks to `preprod` unless you explicitly ask for `prod`.
- **Dual build** — works with both `import` (ESM) and `require` (CommonJS). No runtime dependencies.

Requires **Node 18+** (uses the global `fetch`) and a **Bancontact Pro (Payconiq) merchant account** — the API only works with credentials issued from that account (see [Getting an API key](#getting-an-api-key)).

## Why Bancontact Pro?

[Bancontact](https://www.bancontact.com) is **Belgium's most-used payment method** — the default way people pay online and in shops. If you sell to Belgian customers, you need to accept it.

Bancontact Pro (the Payconiq-operated merchant API) bills a **low flat fee per transaction** rather than a percentage. On the Integrated product that fee is on the order of **~€0.06** per payment (contract-dependent) — far below what a general PSP charges to route Bancontact:

| Provider | Bancontact fee per transaction (indicative, 2026) |
| --- | --- |
| **Bancontact Pro (direct)** | **~€0.06 flat** (depends on your contract/volume) |
| [Stripe](https://stripe.com/pricing/local-payment-methods) | €0.35 flat (+2% on currency conversion) |
| [Mollie](https://www.mollie.com/payments/bancontact) | €0.39 flat |

On a €10 sale that's roughly **0.6% vs 3.5–3.9%** — about 6× cheaper, and the gap widens on smaller tickets. Figures are indicative and current as of 2026; always confirm live pricing with each provider (Bancontact Pro pricing is contract-dependent).

## Install

```sh
npm install bancontact-pro
```

## Getting an API key

1. **Get a Bancontact Pro (Payconiq) merchant account.** Apply via [bancontactpro.com](https://www.bancontactpro.com) or your Bancontact contact. A registered business is required (Belgian merchant); onboarding includes KYC. This account is mandatory — there is no self-serve/test key without it.
2. In the merchant portal, open **Stores** and create a store.
3. In that store, create a **Display** token (the Integrated "Display" product).
4. Copy the **API key** it generates — that's your Bearer key. Pass it to the client as `apiKey`.

The key from the portal is a **live** key, so use `environment: "prod"`:

```ts
const bc = new BancontactPro({
  apiKey: process.env.BANCONTACT_API_KEY!,
  environment: "prod",
});
```

The SDK defaults to `"preprod"` purely as a safety net — you don't pick an environment in the portal. `preprod` is a separate Bancontact sandbox (different credentials), not a toggle on your live key.

Portal labels can change — see the official [Bancontact Pro docs](https://docs.bancontactpro.com) or contact `devsupport@bancontact.com`.

## Quick start

```ts
import { BancontactPro } from "bancontact-pro";

const bc = new BancontactPro({
  apiKey: process.env.BANCONTACT_API_KEY!,
  environment: "prod", // "prod" | "preprod" (default: "preprod")
});

// Create a payment and redirect the payer to the checkout URL.
const payment = await bc.payments.create({
  amountCents: 1250, // €12.50 (integer cents)
  reference: "order-123", // your order id (max 35 chars, sanitized)
  description: "2x Cola",
  returnUrl: "https://shop.example/return?ref=order-123",
  callbackUrl: "https://shop.example/api/bancontact-webhook", // optional
});

const checkoutUrl = payment._links.checkout?.href;
```

When the payer returns, confirm the real outcome server-side — never trust the redirect alone:

```ts
import { isSuccessful } from "bancontact-pro";

const p = await bc.payments.get(payment.paymentId);
if (isSuccessful(p.status)) {
  // SUCCEEDED — funds guaranteed. Fulfil the order.
}
```

Didn't persist the `paymentId`? Look it up by your own reference:

```ts
const p = await bc.payments.findByReference("order-123");
```

### Don't rely on the payer returning

The `returnUrl` redirect is best-effort. A payer can complete the payment and never come back (they close the banking app), so "the browser returned" is not a reliable confirmation. If you only update your records on return, a genuinely paid order can stay `pending` forever. Confirm server-side with one or more of:

- **Poll on return**: on your return page, call `payments.get(paymentId)` until `isSuccessful(status)` or `isFinal(status)`.
- **Webhook**: pass `callbackUrl` to `payments.create`; Bancontact POSTs status changes to it regardless of whether the payer returns. Verify each call with `callbacks.verify` (see [Verifying webhooks](#verifying-webhooks)).
- **Reconcile sweep**: on a schedule, re-check your still-pending orders with `payments.get` / `payments.findByReference` and update them. A cheap backstop that also catches anything a webhook misses.

The goal: your order record converges to the real outcome even if the payer never returns.

## Payment status model

The API reports ten states. Two helpers cover the common questions:

```ts
import { isFinal, isSuccessful } from "bancontact-pro";

isSuccessful("SUCCEEDED"); // true — the ONLY status that guarantees funds
isSuccessful("AUTHORIZED"); // false — intermediary; funds not yet guaranteed
isFinal("CANCELLED"); // true — terminal, will not change
isFinal("PENDING"); // false
```

Per the Bancontact docs, `AUTHORIZED` is **intermediary** — only `SUCCEEDED` guarantees the payment completed and funds were received. Don't ship goods on `AUTHORIZED`.

Final states: `SUCCEEDED`, `AUTHORIZATION_FAILED`, `FAILED`, `CANCELLED`, `EXPIRED`, `VOIDED`.

## Verifying webhooks

Bancontact signs each callback with a detached JWS in the `signature` header. Pass the **raw** request body (not a re-serialized object) so the signature matches:

```ts
import express, { type Request, type Response } from "express";
import { BancontactPro } from "bancontact-pro";

const app = express();
const bc = new BancontactPro({ apiKey: process.env.BANCONTACT_API_KEY!, environment: "prod" });

// Use a raw body parser on this route so the signature matches the exact bytes.
app.post("/api/bancontact-webhook", express.raw({ type: "*/*" }), async (req: Request, res: Response) => {
  try {
    const event = await bc.callbacks.verify({
      rawBody: (req.body as Buffer).toString("utf8"),
      signature: req.header("signature") ?? "",
    });
    // event is the verified JSON payload, e.g. { paymentId, status, reference, ... }
    res.sendStatus(200);
  } catch {
    res.sendStatus(400); // signature invalid — ignore
  }
});
```

`verify()` fetches and caches the signing keys (JWKS) automatically. You can also supply them yourself or override the URL:

```ts
await bc.callbacks.verify({
  rawBody,
  signature,
  jwksUrl: "https://jwks.bancontact.net/.well-known/jwks.json", // override if your account differs
  // or: jwks: { keys: [ /* JWK */ ] }
  maxKeyAgeMs: 3_600_000, // cache TTL (default 1h)
});
```

> The JWKS **host** is documented (`jwks.bancontact.net` / `jwks.preprod.bancontact.net`); the exact path is not, so it defaults to `/.well-known/jwks.json`. If your account serves it elsewhere, pass `jwksUrl`.

## API

### `new BancontactPro(options)`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `apiKey` | `string` | — | **Required.** Bearer API key for your payment profile. |
| `environment` | `"prod" \| "preprod"` | `"preprod"` | Selects the API + JWKS host. |
| `baseUrl` | `string` | — | Override the API base URL. |
| `fetch` | `typeof fetch` | global | Inject a custom fetch (tests, proxy). |
| `timeoutMs` | `number` | `15000` | Per-request timeout. |

### `bc.payments`

- `create(input)` → `Payment` — `POST /v3/payments`.
- `get(paymentId)` → `Payment` — `GET /v3/payments/{id}` (strongly consistent).
- `search(reference)` → `Payment[]` — `POST /v3/payments/search`.
- `findByReference(reference)` → `Payment | undefined` — most recent match.

### `bc.callbacks`

- `verify(input)` → parsed payload — throws `SignatureVerificationError` if invalid.

### Also exported

`sepaSafe(input, maxLength?)`, `isFinal(status)`, `isSuccessful(status)`, `BancontactError`, `SignatureVerificationError`, and all types (`Payment`, `PaymentStatus`, `CreatePaymentInput`, `ClientOptions`, …).

### Errors

Non-2xx responses throw `BancontactError` with `httpStatus`, `apiCode` (when present), and the parsed `body`.

## Scope

This is **v0.1** — Payments + webhook verification. The Refund and Reconciliation APIs require outbound ES256 request signing (a scheme not yet fully documented publicly) and are planned for a later release.

## License

[MIT](./LICENSE) © Koray Sels

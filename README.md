# bancontact-pro

Unofficial Node.js SDK for the **Bancontact Pro** (Payconiq) [Merchant Payment API v3](https://docs.bancontactpro.com). Create payments and verify webhook signatures, with full TypeScript types and zero runtime dependencies.

> Not affiliated with or endorsed by Bancontact Payments NV/SA. "Bancontact" is a trademark of its owner.

## Features

- **Payments** — create, fetch by id, and search by reference.
- **Webhook verification** — verify inbound callback signatures (detached JWS, ES256) using only Node's built-in `crypto`.
- **Typed** — every request and response is typed; helpers for the payment status model.
- **Safe defaults** — talks to `preprod` unless you explicitly ask for `prod`.
- **Dual build** — works with both `import` (ESM) and `require` (CommonJS). No runtime dependencies.

Requires **Node 18+** (uses the global `fetch`).

## Install

```sh
npm install bancontact-pro
```

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
// Example: an Express handler. Use a raw body parser for this route.
app.post("/api/bancontact-webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const event = await bc.callbacks.verify({
      rawBody: req.body.toString("utf8"),
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

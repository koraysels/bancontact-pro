import { Callbacks } from "./callbacks.js";
import { HttpClient } from "./http.js";
import { Payments } from "./payments.js";
import type { ClientOptions } from "./types.js";

/**
 * Unofficial client for the Bancontact Pro (Payconiq) Merchant Payment API v3.
 *
 * @example
 * ```ts
 * const bc = new BancontactPro({ apiKey: process.env.BANCONTACT_API_KEY!, environment: "prod" });
 * const payment = await bc.payments.create({
 *   amountCents: 1250, reference: "order-123", returnUrl: "https://shop.example/return",
 * });
 * // redirect the payer to payment._links.checkout?.href
 * ```
 */
export class BancontactPro {
  /** Payments API (create / get / search). Bearer-authenticated. */
  readonly payments: Payments;
  /** Inbound webhook signature verification (detached JWS, ES256). */
  readonly callbacks: Callbacks;

  constructor(options: ClientOptions) {
    const http = new HttpClient(options);
    this.payments = new Payments(http);
    this.callbacks = new Callbacks(options.environment ?? "preprod", options.fetch ?? globalThis.fetch);
  }
}

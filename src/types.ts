/** The environment a client talks to. Defaults to "preprod" everywhere so a
 *  missing/typo'd value can never accidentally hit the live money rail. */
export type Environment = "prod" | "preprod";

/** The ten payment states the Merchant Payment API can report. */
export type PaymentStatus =
  | "PENDING"
  | "IDENTIFIED"
  | "AUTHORIZED"
  | "AUTHORIZATION_FAILED"
  | "FAILED"
  | "SUCCEEDED"
  | "CANCELLED"
  | "EXPIRED"
  | "PENDING_MERCHANT_ACKNOWLEDGEMENT"
  | "VOIDED";

/** Statuses the API documents as final (they never change again). */
const FINAL: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "SUCCEEDED",
  "AUTHORIZATION_FAILED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "VOIDED",
]);

/** True once the payment has reached a terminal state and will not change. */
export function isFinal(status: PaymentStatus): boolean {
  return FINAL.has(status);
}

/** True only for SUCCEEDED — the one status that guarantees funds were received.
 *  AUTHORIZED is intermediary (docs): funds are not guaranteed until SUCCEEDED. */
export function isSuccessful(status: PaymentStatus): boolean {
  return status === "SUCCEEDED";
}

export interface PaymentLinks {
  self?: { href?: string };
  deeplink?: { href?: string };
  qrcode?: { href?: string };
  checkout?: { href?: string };
  cancel?: { href?: string };
}

/** A payment resource as returned by create/get/search. */
export interface Payment {
  paymentId: string;
  status: PaymentStatus;
  reference?: string;
  amount?: number;
  currency?: string;
  description?: string;
  createdAt?: string;
  _links: PaymentLinks;
  /** Any additional fields the API returns are preserved here. */
  [key: string]: unknown;
}

export interface CreatePaymentInput {
  /** Amount in cents (integer). e.g. 1250 for €12.50. */
  amountCents: number;
  /** Your order reference. Max 35 chars; sanitized to the SEPA-safe charset. */
  reference: string;
  /** ISO 4217 currency. Defaults to "EUR". */
  currency?: string;
  /** Short human description shown to the payer. Sanitized. */
  description?: string;
  /** Where the payer's browser returns after the flow. Must be https. */
  returnUrl: string;
  /** Optional server-to-server status webhook (see callbacks.verify). */
  callbackUrl?: string;
}

export interface ClientOptions {
  /** Bearer API key tied to your payment profile. */
  apiKey: string;
  /** "prod" | "preprod". Defaults to "preprod". */
  environment?: Environment;
  /** Override the API base URL (advanced/testing). */
  baseUrl?: string;
  /** Override global fetch (e.g. for tests or a custom agent). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Defaults to 15000. */
  timeoutMs?: number;
}

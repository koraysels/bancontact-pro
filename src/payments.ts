import type { HttpClient } from "./http.js";
import { sepaSafe } from "./sepa.js";
import type { CreatePaymentInput, Payment } from "./types.js";

/** Payments API (v3). Auth is the Bearer API key configured on the client. */
export class Payments {
  constructor(private readonly http: HttpClient) {}

  /** Create a payment. Returns the resource, including `_links.checkout` to
   *  redirect the payer to. `reference` is sanitized and capped at 35 chars. */
  create(input: CreatePaymentInput): Promise<Payment> {
    const body: Record<string, unknown> = {
      amount: input.amountCents,
      currency: input.currency ?? "EUR",
      reference: sepaSafe(input.reference, 35),
      returnUrl: input.returnUrl,
    };
    if (input.description) body.description = sepaSafe(input.description);
    if (input.callbackUrl) body.callbackUrl = input.callbackUrl;
    return this.http.request<Payment>("POST", "/v3/payments", body);
  }

  /** Fetch a single payment by id. Strongly consistent — reflects the latest
   *  status the instant it changes (unlike the search index). */
  get(paymentId: string): Promise<Payment> {
    return this.http.request<Payment>("GET", `/v3/payments/${encodeURIComponent(paymentId)}`);
  }

  /** Search payments by your reference. Returns matches (most recent first). */
  async search(reference: string): Promise<Payment[]> {
    const res = await this.http.request<{ details?: Payment[] }>(
      "POST",
      "/v3/payments/search",
      { reference },
    );
    return res.details ?? [];
  }

  /** Convenience: the most recent payment for a reference, or undefined. Useful
   *  when you didn't persist the paymentId and only have your own order id. */
  async findByReference(reference: string): Promise<Payment | undefined> {
    return (await this.search(reference))[0];
  }
}

import { describe, expect, it, vi } from "vitest";
import { BancontactPro } from "../src/client.js";
import { BancontactError } from "../src/errors.js";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function client(fetchImpl: typeof fetch) {
  return new BancontactPro({ apiKey: "test-key", environment: "preprod", fetch: fetchImpl });
}

describe("payments.create", () => {
  it("posts amount/currency/reference/returnUrl and returns the payment", async () => {
    const fetchImpl = mockFetch(201, {
      paymentId: "tx1",
      status: "PENDING",
      _links: { checkout: { href: "https://pay.example/tx1" } },
    });
    const bc = client(fetchImpl as unknown as typeof fetch);

    const p = await bc.payments.create({
      amountCents: 1250,
      reference: "order maté 123",
      description: "CS Fridge",
      returnUrl: "https://shop.example/return",
    });

    expect(p.paymentId).toBe("tx1");
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://merchant.api.preprod.bancontact.net/v3/payments");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      amount: 1250,
      currency: "EUR",
      reference: "order mat 123", // é stripped
      returnUrl: "https://shop.example/return",
      description: "CS Fridge",
    });
  });

  it("caps the reference at 35 chars", async () => {
    const fetchImpl = mockFetch(201, { paymentId: "tx", status: "PENDING", _links: {} });
    const bc = client(fetchImpl as unknown as typeof fetch);
    await bc.payments.create({ amountCents: 100, reference: "x".repeat(50), returnUrl: "https://a.test" });
    const sent = JSON.parse((fetchImpl as any).mock.calls[0][1].body);
    expect(sent.reference).toHaveLength(35);
  });
});

describe("payments.get / search / findByReference", () => {
  it("gets a payment by id", async () => {
    const fetchImpl = mockFetch(200, { paymentId: "tx9", status: "SUCCEEDED", _links: {} });
    const bc = client(fetchImpl as unknown as typeof fetch);
    const p = await bc.payments.get("tx9");
    expect(p.status).toBe("SUCCEEDED");
    expect((fetchImpl as any).mock.calls[0][0]).toBe(
      "https://merchant.api.preprod.bancontact.net/v3/payments/tx9",
    );
  });

  it("search returns the details array; findByReference returns the first", async () => {
    const fetchImpl = mockFetch(200, { details: [{ paymentId: "a", status: "PENDING", _links: {} }] });
    const bc = client(fetchImpl as unknown as typeof fetch);
    expect(await bc.payments.search("ref")).toHaveLength(1);
    const first = await bc.payments.findByReference("ref");
    expect(first?.paymentId).toBe("a");
  });

  it("returns undefined from findByReference when there are no matches", async () => {
    const fetchImpl = mockFetch(200, { details: [] });
    const bc = client(fetchImpl as unknown as typeof fetch);
    expect(await bc.payments.findByReference("nope")).toBeUndefined();
  });
});

describe("errors", () => {
  it("throws BancontactError with status + body on a non-2xx", async () => {
    const fetchImpl = mockFetch(400, { code: "INVALID_REFERENCE", message: "reference invalid" });
    const bc = client(fetchImpl as unknown as typeof fetch);
    await expect(bc.payments.get("x")).rejects.toMatchObject({
      name: "BancontactError",
      httpStatus: 400,
      apiCode: "INVALID_REFERENCE",
    });
    await expect(bc.payments.get("x")).rejects.toBeInstanceOf(BancontactError);
  });
});

describe("environment", () => {
  it("defaults to preprod and targets the prod base only when asked", async () => {
    const fetchImpl = mockFetch(200, { paymentId: "t", status: "PENDING", _links: {} });
    const bc = new BancontactPro({ apiKey: "k", environment: "prod", fetch: fetchImpl as unknown as typeof fetch });
    await bc.payments.get("t");
    expect((fetchImpl as any).mock.calls[0][0]).toContain("https://merchant.api.bancontact.net");
  });
});

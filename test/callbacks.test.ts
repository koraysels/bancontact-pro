import { generateKeyPairSync, KeyObject, sign as cryptoSign } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BancontactPro } from "../src/client.js";
import { SignatureVerificationError } from "../src/errors.js";
import type { Jwk } from "../src/callbacks.js";

let privateKey: KeyObject;
let jwk: Jwk;
const KID = "test-key-1";

beforeAll(() => {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  privateKey = pair.privateKey;
  jwk = { ...(pair.publicKey.export({ format: "jwk" }) as Jwk), kid: KID };
});

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64url");
}

/** Produce a detached JWS (ES256) over `body`, like Bancontact's webhook. */
function signDetached(body: string, header: Record<string, unknown> = { alg: "ES256", kid: KID }): string {
  const protectedB64 = b64url(JSON.stringify(header));
  const signingInput = `${protectedB64}.${b64url(body)}`;
  const sig = cryptoSign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${protectedB64}..${b64url(sig)}`;
}

function client() {
  return new BancontactPro({ apiKey: "k", environment: "preprod" });
}

describe("callbacks.verify", () => {
  const body = JSON.stringify({ paymentId: "tx1", status: "SUCCEEDED", reference: "order-1" });

  it("verifies a valid detached JWS and returns the parsed payload", async () => {
    const bc = client();
    const payload = await bc.callbacks.verify({
      rawBody: body,
      signature: signDetached(body),
      jwks: { keys: [jwk] },
    });
    expect(payload).toMatchObject({ paymentId: "tx1", status: "SUCCEEDED" });
  });

  it("rejects a tampered body", async () => {
    const bc = client();
    const signature = signDetached(body);
    const tampered = body.replace("SUCCEEDED", "FAILED");
    await expect(
      bc.callbacks.verify({ rawBody: tampered, signature, jwks: { keys: [jwk] } }),
    ).rejects.toBeInstanceOf(SignatureVerificationError);
  });

  it("rejects a non-ES256 algorithm (alg confusion / none)", async () => {
    const bc = client();
    const sig = signDetached(body, { alg: "none", kid: KID });
    await expect(
      bc.callbacks.verify({ rawBody: body, signature: sig, jwks: { keys: [jwk] } }),
    ).rejects.toThrow(/ES256/);
  });

  it("rejects when the kid is not in the JWKS", async () => {
    const bc = client();
    const sig = signDetached(body, { alg: "ES256", kid: "unknown" });
    await expect(
      bc.callbacks.verify({ rawBody: body, signature: sig, jwks: { keys: [jwk] } }),
    ).rejects.toThrow(/no key/);
  });

  it("rejects a malformed (non-detached) signature", async () => {
    const bc = client();
    await expect(
      bc.callbacks.verify({ rawBody: body, signature: "not.a.jws", jwks: { keys: [jwk] } }),
    ).rejects.toThrow(/malformed/);
  });

  it("fetches and caches the JWKS from the network when not supplied", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const bc = new BancontactPro({ apiKey: "k", environment: "preprod", fetch: fetchImpl as unknown as typeof fetch });
    const sig = signDetached(body);
    await bc.callbacks.verify({ rawBody: body, signature: sig });
    await bc.callbacks.verify({ rawBody: body, signature: sig });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // second call served from cache
    expect((fetchImpl as any).mock.calls[0][0]).toBe(
      "https://jwks.preprod.bancontact.net/.well-known/jwks.json",
    );
  });
});

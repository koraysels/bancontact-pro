import { createPublicKey, verify as cryptoVerify, type JsonWebKey as NodeJwk } from "node:crypto";
import { SignatureVerificationError } from "./errors.js";
import type { Environment } from "./types.js";

// JWKS host per environment (from the Bancontact Pro callback guide). The path
// is not published, so it defaults to the well-known location and can be
// overridden per call via `jwksUrl` if your account uses a different path.
const JWKS_HOST: Record<Environment, string> = {
  prod: "https://jwks.bancontact.net",
  preprod: "https://jwks.preprod.bancontact.net",
};

export interface Jwk {
  kid?: string;
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  alg?: string;
  use?: string;
  [k: string]: unknown;
}

export interface VerifyInput {
  /** The exact raw request body bytes as received (do not re-serialize JSON). */
  rawBody: string;
  /** Value of the inbound `signature` header (a detached compact JWS). */
  signature: string;
  /** Supply the JWKS directly to skip the network fetch (e.g. in tests). */
  jwks?: { keys: Jwk[] };
  /** Override the JWKS URL to fetch signing keys from. */
  jwksUrl?: string;
  /** Max age of a cached JWKS before refetch. Default 1 hour. */
  maxKeyAgeMs?: number;
}

interface CacheEntry {
  keys: Jwk[];
  fetchedAt: number;
}

/** Verifies inbound Bancontact webhook signatures (detached JWS, ES256). */
export class Callbacks {
  private readonly defaultJwksUrl: string;
  private readonly fetchImpl: typeof fetch;
  private cache: CacheEntry | undefined;

  constructor(environment: Environment, fetchImpl: typeof fetch) {
    this.defaultJwksUrl = `${JWKS_HOST[environment]}/.well-known/jwks.json`;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Verify a webhook and return its parsed JSON payload. Throws
   * `SignatureVerificationError` if the signature is missing, malformed, uses an
   * unexpected algorithm, or does not verify against the signing key.
   */
  async verify(input: VerifyInput): Promise<Record<string, unknown>> {
    const { protectedB64, header, signatureBytes } = parseDetachedJws(input.signature);

    if (header.alg !== "ES256") {
      throw new SignatureVerificationError(`unexpected JWS alg "${header.alg}" (expected ES256)`);
    }
    // If the header marks params critical, they must at least be present.
    if (Array.isArray(header.crit)) {
      for (const name of header.crit) {
        if (!(name in header)) {
          throw new SignatureVerificationError(`missing critical header param "${name}"`);
        }
      }
    }
    if (!header.kid) throw new SignatureVerificationError("JWS header has no kid");

    const jwk = await this.resolveKey(header.kid, input);
    const signingInput = Buffer.from(`${protectedB64}.${base64url(input.rawBody)}`);

    let ok = false;
    try {
      const key = createPublicKey({ key: jwk as unknown as NodeJwk, format: "jwk" });
      // JWS ES256 signatures are raw R||S (IEEE P1363), not DER.
      ok = cryptoVerify("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" }, signatureBytes);
    } catch (e) {
      throw new SignatureVerificationError(`signature verification failed: ${(e as Error).message}`);
    }
    if (!ok) throw new SignatureVerificationError("signature does not verify");

    try {
      return JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      throw new SignatureVerificationError("verified, but body is not valid JSON");
    }
  }

  private async resolveKey(kid: string, input: VerifyInput): Promise<Jwk> {
    // 1. Caller-supplied JWKS.
    if (input.jwks) {
      const k = input.jwks.keys.find((j) => j.kid === kid);
      if (!k) throw new SignatureVerificationError(`no key "${kid}" in supplied JWKS`);
      return k;
    }
    // 2. Cache (refetch once on a miss in case of key rotation).
    const maxAge = input.maxKeyAgeMs ?? 3_600_000;
    const url = input.jwksUrl ?? this.defaultJwksUrl;
    let fromCache = this.cachedKey(kid, maxAge);
    if (fromCache) return fromCache;

    await this.refresh(url);
    fromCache = this.cachedKey(kid, maxAge);
    if (!fromCache) throw new SignatureVerificationError(`no key "${kid}" in JWKS at ${url}`);
    return fromCache;
  }

  private cachedKey(kid: string, maxAge: number): Jwk | undefined {
    if (!this.cache) return undefined;
    if (Date.now() - this.cache.fetchedAt > maxAge) return undefined;
    return this.cache.keys.find((j) => j.kid === kid);
  }

  private async refresh(url: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new SignatureVerificationError(`could not fetch JWKS: ${(e as Error).message}`);
    }
    if (!res.ok) throw new SignatureVerificationError(`JWKS fetch returned ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    if (!Array.isArray(body.keys)) throw new SignatureVerificationError("JWKS has no keys array");
    this.cache = { keys: body.keys, fetchedAt: Date.now() };
  }
}

interface JoseHeader {
  alg?: string;
  kid?: string;
  crit?: string[];
  [k: string]: unknown;
}

function parseDetachedJws(signature: string): {
  protectedB64: string;
  header: JoseHeader;
  signatureBytes: Buffer;
} {
  const parts = signature.split(".");
  if (parts.length !== 3 || parts[1] !== "") {
    throw new SignatureVerificationError("malformed detached JWS (expected `header..signature`)");
  }
  const protectedB64 = parts[0]!;
  let header: JoseHeader;
  try {
    header = JSON.parse(Buffer.from(protectedB64, "base64url").toString("utf8")) as JoseHeader;
  } catch {
    throw new SignatureVerificationError("JWS header is not valid base64url JSON");
  }
  const signatureBytes = Buffer.from(parts[2]!, "base64url");
  return { protectedB64, header, signatureBytes };
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

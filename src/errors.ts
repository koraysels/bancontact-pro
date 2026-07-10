/** Thrown for any non-2xx response from the Bancontact API. Carries the HTTP
 *  status and, when the body is JSON, the parsed error payload. */
export class BancontactError extends Error {
  readonly httpStatus: number;
  readonly body: unknown;
  /** The API's own error code, when present in the body. */
  readonly apiCode?: string;

  constructor(message: string, httpStatus: number, body: unknown) {
    super(message);
    this.name = "BancontactError";
    this.httpStatus = httpStatus;
    this.body = body;
    const code = (body as { code?: unknown } | null)?.code;
    if (typeof code === "string") this.apiCode = code;
  }
}

/** Thrown when a webhook signature fails verification (or can't be verified). */
export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

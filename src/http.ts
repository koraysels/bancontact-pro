import { BancontactError } from "./errors.js";
import type { ClientOptions, Environment } from "./types.js";

const BASE_URLS: Record<Environment, string> = {
  prod: "https://merchant.api.bancontact.net",
  preprod: "https://merchant.api.preprod.bancontact.net",
};

export function resolveBaseUrl(opts: ClientOptions): string {
  if (opts.baseUrl) return opts.baseUrl.replace(/\/+$/, "");
  return BASE_URLS[opts.environment ?? "preprod"];
}

/** Minimal typed request core shared by every sub-client. */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) throw new Error("bancontact-pro: `apiKey` is required");
    this.baseUrl = resolveBaseUrl(opts);
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("bancontact-pro: global fetch is unavailable — use Node 18+ or pass `fetch`");
    }
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;

    if (!res.ok) {
      const message =
        (parsed as { message?: string } | undefined)?.message ??
        `Bancontact API ${res.status} ${res.statusText}`;
      throw new BancontactError(message, res.status, parsed ?? text);
    }
    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

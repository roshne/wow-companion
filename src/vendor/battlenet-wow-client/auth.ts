/**
 * OAuth 2.0 client-credentials token manager for the Battle.net API.
 *
 * Most Game Data endpoints use the client-credentials flow: exchange a client id/secret for a
 * bearer token that lasts ~24h. This caches the token and refreshes it just before expiry.
 */

export interface OAuthOptions {
  /** Client ID from the Battle.net Developer Portal (API Access). */
  clientId: string;
  /** Client secret from the Battle.net Developer Portal. */
  clientSecret: string;
  /**
   * OAuth token endpoint. Defaults to the global host `https://oauth.battle.net/token`.
   * For China, use `https://oauth.battlenet.com.cn/token`.
   */
  tokenUrl?: string;
  /** Custom fetch implementation (e.g. for proxies or tests). Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

const DEFAULT_TOKEN_URL = "https://oauth.battle.net/token";
/** Refresh this many ms before actual expiry to avoid using a token that expires mid-flight. */
const EXPIRY_SKEW_MS = 60_000;

function base64(input: string): string {
  if (typeof btoa === "function") return btoa(input);
  // Node fallback without requiring @types/node in consumers.
  const nodeBuffer = (
    globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }
  ).Buffer;
  if (nodeBuffer) return nodeBuffer.from(input, "utf-8").toString("base64");
  throw new Error("No base64 encoder (btoa/Buffer) available in this environment.");
}

/**
 * Fetches and caches a client-credentials access token, refreshing just before expiry.
 * Concurrent callers during a refresh share a single in-flight request.
 */
export class TokenManager {
  private token?: string;
  private expiresAt = 0;
  private inflight?: Promise<string>;

  constructor(private readonly opts: OAuthOptions) {
    if (!opts.clientId || !opts.clientSecret) {
      throw new Error("TokenManager requires both clientId and clientSecret.");
    }
  }

  /** Returns a valid bearer token, fetching or refreshing as needed. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - EXPIRY_SKEW_MS) {
      return this.token;
    }
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Forget the cached token so the next `getToken()` fetches a fresh one. */
  reset(): void {
    this.token = undefined;
    this.expiresAt = 0;
  }

  private async fetchToken(): Promise<string> {
    const doFetch = this.opts.fetch ?? fetch;
    const url = this.opts.tokenUrl ?? DEFAULT_TOKEN_URL;
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64(`${this.opts.clientId}:${this.opts.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    });
    if (!res.ok) {
      throw new Error(
        `Battle.net OAuth token request failed: ${res.status} ${res.statusText} - ${await res.text()}`,
      );
    }
    const json = (await res.json()) as TokenResponse;
    this.token = json.access_token;
    this.expiresAt = Date.now() + json.expires_in * 1000;
    return this.token;
  }
}

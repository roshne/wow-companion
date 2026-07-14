import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./generated/schema";
import { TokenManager } from "./auth";

/**
 * Global API regions. China (`cn`) uses different hosts — for it, pass `baseUrl` and `tokenUrl`
 * explicitly (`https://gateway.battlenet.com.cn` and `https://oauth.battlenet.com.cn/token`).
 */
export type Region = "us" | "eu" | "kr" | "tw";

/** Namespace categories used by the WoW Game Data & Profile APIs. */
export type NamespaceCategory = "static" | "dynamic" | "profile";

export interface BlizzardClientOptions {
  /** Region for the data host and default namespaces. Default: `"us"`. */
  region?: Region;
  /** Override the data API base URL (default `https://{region}.api.blizzard.com`). */
  baseUrl?: string;
  /**
   * Supply access tokens yourself — e.g. from a Tauri Rust command that holds the client secret in
   * the OS keychain. When set, no secret is needed in this layer and `clientId`/`clientSecret` are
   * ignored. This is the recommended path for desktop/browser apps where the secret must not ship
   * in the frontend bundle.
   */
  getToken?: () => string | Promise<string>;
  /**
   * Custom fetch implementation. In a Tauri app, pass the HTTP plugin's `fetch`
   * (`@tauri-apps/plugin-http`) so requests go through Rust and bypass webview CORS.
   * Defaults to the global `fetch`.
   */
  fetch?: typeof fetch;
  /** Client ID for the built-in client-credentials flow (ignored when `getToken` is set). */
  clientId?: string;
  /** Client secret for the built-in client-credentials flow (ignored when `getToken` is set). */
  clientSecret?: string;
  /** Token endpoint for the built-in flow (default `https://oauth.battle.net/token`). */
  tokenUrl?: string;
}

export interface BlizzardClient {
  /** The typed openapi-fetch client. Every request is auto-authenticated with a bearer token. */
  api: Client<paths>;
  /** The active region. */
  region: Region;
  /** Present only when using the built-in client-credentials flow (clientId/secret). */
  tokens?: TokenManager;
  /** Build a namespace for this region, e.g. `namespace("static")` -> `"static-us"`. */
  namespace: (category: NamespaceCategory) => string;
}

/**
 * Create a typed, auto-authenticated Battle.net / WoW Web API client.
 *
 * Provide tokens one of two ways:
 * - `getToken` — a provider you control (e.g. a Tauri Rust command). Recommended for apps.
 * - `clientId` + `clientSecret` — the client does the client-credentials exchange itself
 *   (fine for servers/scripts; never ship a secret in a frontend bundle).
 *
 * Requests are strongly typed for path, query, header, and body parameters (response bodies are
 * `unknown` — the source spec omits response schemas).
 *
 * @example
 * // App: token comes from Rust, requests go through the Tauri HTTP plugin.
 * const bnet = createBlizzardClient({ region: "us", getToken, fetch: tauriFetch });
 * @example
 * // Server/script: built-in client-credentials flow.
 * const bnet = createBlizzardClient({ clientId, clientSecret, region: "us" });
 */
export function createBlizzardClient(opts: BlizzardClientOptions): BlizzardClient {
  const region = opts.region ?? "us";
  const baseUrl = opts.baseUrl ?? `https://${region}.api.blizzard.com`;

  let tokens: TokenManager | undefined;
  let getToken = opts.getToken;
  if (!getToken) {
    if (!opts.clientId || !opts.clientSecret) {
      throw new Error(
        "createBlizzardClient requires either a getToken provider, or clientId + clientSecret.",
      );
    }
    tokens = new TokenManager({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      tokenUrl: opts.tokenUrl,
      fetch: opts.fetch,
    });
    getToken = () => tokens!.getToken();
  }

  const api = createClient<paths>({ baseUrl, fetch: opts.fetch });

  // Inject a fresh bearer token on every request.
  api.use({
    async onRequest({ request }) {
      request.headers.set("Authorization", `Bearer ${await getToken!()}`);
      return request;
    },
  });

  return {
    api,
    region,
    tokens,
    namespace: (category) => `${category}-${region}`,
  };
}

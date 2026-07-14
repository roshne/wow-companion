import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createBlizzardClient, type Region } from "../vendor/battlenet-wow-client";

/**
 * Build an authenticated WoW Web API client.
 *
 * - The access token comes from the Rust `get_access_token` command (the client secret stays in the
 *   OS keychain, never in the webview).
 * - Requests go through the Tauri HTTP plugin so they aren't blocked by webview CORS.
 */
export function makeClient(region: Region = "us") {
  return createBlizzardClient({
    region,
    getToken: () => invoke<string>("get_access_token"),
    fetch: tauriFetch as unknown as typeof fetch,
  });
}

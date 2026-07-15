import { vi } from "vitest";
import type { BlizzardClient, Region } from "../vendor/battlenet-wow-client";

/**
 * A minimal `Response` stand-in carrying only what `unwrap()` reads (`ok`, `status`, and a
 * case-insensitive `headers.get`). Avoids depending on a global `Headers` across test environments.
 */
export function mockResponse(status = 200, headers: Record<string, string> = {}): Response {
  const lower: Record<string, string> = {};
  for (const key of Object.keys(headers)) lower[key.toLowerCase()] = headers[key];
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

/**
 * A mock Blizzard client. `api.GET` is the returned `get` vi mock — configure it with
 * `get.mockResolvedValue({ data, response })` (build `response` with `mockResponse`).
 */
export function mockBnet(region: Region = "us") {
  const get = vi.fn();
  const bnet = {
    region,
    namespace: (category: string) => `${category}-${region}`,
    api: { GET: get },
  } as unknown as BlizzardClient;
  return { bnet, get };
}

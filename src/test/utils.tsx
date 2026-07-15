import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

/** A QueryClient tuned for tests: no retries (errors surface immediately), cache kept for the test. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** Render `ui` wrapped in a QueryClientProvider. Returns the RTL result plus the `client` used. */
export function renderWithClient(
  ui: ReactElement,
  client: QueryClient = testQueryClient(),
): RenderResult & { client: QueryClient } {
  const result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client, ...result };
}

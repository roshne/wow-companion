import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

// App reaches Rust via Tauri `invoke` and makes data calls through the HTTP plugin's `fetch`; both
// are mocked so the component renders without a Tauri backend.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { renderWithClient } from "./test/utils";
import { notifyUnauthorized } from "./lib/auth";

const mockInvoke = vi.mocked(invoke);

describe("App — 401 re-auth", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_credentials") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
  });

  it("clears credentials and returns to the connect form when a 401 is signalled", async () => {
    renderWithClient(<App />);

    // Connected: the main tabbed view renders.
    await screen.findByRole("button", { name: "WoW Token" });

    notifyUnauthorized();

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("clear_credentials"));
    await screen.findByText(/Connect your Battle.net client/);
    expect(screen.getByText(/please reconnect/)).toBeInTheDocument();
  });
});

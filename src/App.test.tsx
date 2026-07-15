import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

// App reaches Rust via Tauri `invoke` and makes data calls through the HTTP plugin's `fetch`; both
// are mocked so the component renders without a Tauri backend.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { renderWithClient } from "./test/utils";
import { notifyUnauthorized } from "./lib/auth";

const mockInvoke = vi.mocked(invoke);

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("restores the persisted region on load", async () => {
    localStorage.setItem("wow-companion:region", "eu");
    renderWithClient(<App />);

    const select = (await screen.findByLabelText(/Region/)) as HTMLSelectElement;
    expect(select.value).toBe("eu");
  });

  it("persists a region change", async () => {
    renderWithClient(<App />);

    const select = (await screen.findByLabelText(/Region/)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "kr" } });
    await waitFor(() => expect(localStorage.getItem("wow-companion:region")).toBe("kr"));
  });
});

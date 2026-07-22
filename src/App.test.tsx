import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";

// App reaches Rust via Tauri `invoke` and makes data calls through the HTTP plugin's `fetch`; both
// are mocked so the component renders without a Tauri backend.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// App now background-captures the token price; give its HTTP calls a valid (empty) JSON response.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(
    async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
  ),
}));

import { invoke } from "@tauri-apps/api/core";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import App from "./App";
import { renderWithClient } from "./test/utils";
import { notifyUnauthorized } from "./lib/auth";

const mockInvoke = vi.mocked(invoke);
const mockFetch = vi.mocked(httpFetch);

/** A 200 JSON Response for the HTTP-plugin fetch mock. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The region subdomain of a Battle.net request URL (`https://eu.api.blizzard.com/...` -> `eu`). */
function requestRegion(input: unknown): string {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  return new URL(url).host.split(".")[0];
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_credentials") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    // Default: every data call returns an empty JSON body. Tests that care about a specific endpoint
    // (e.g. per-region realm indexes) override this with their own implementation.
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => jsonResponse({}));
  });

  it("clears credentials and returns to the connect form when a 401 is signalled", async () => {
    renderWithClient(<App />);

    // Connected: the main tabbed view renders.
    await screen.findByRole("tab", { name: "WoW Token" });

    notifyUnauthorized();

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("clear_credentials"));
    await screen.findByText(/Connect your Battle.net client/);
    // A live region, so the reconnect notice is announced and not just painted.
    expect(await screen.findByRole("status")).toHaveTextContent(/please reconnect/);
  });

  it("wires the nav to the view as a tablist over one panel", async () => {
    renderWithClient(<App />);

    const token = await screen.findByRole("tab", { name: "WoW Token" });
    expect(token).toHaveAttribute("aria-selected", "true");

    const panel = screen.getByRole("tabpanel", { name: "WoW Token" });
    expect(panel).toHaveAttribute("id", token.getAttribute("aria-controls"));
    // The panel is the <main> landmark; the app bar and the nav sit outside it.
    expect(panel.tagName).toBe("MAIN");
    expect(panel.querySelector("header, [role='tablist']")).toBeNull();
  });

  it("names the connect form's credential fields", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_credentials") return Promise.resolve(false);
      return Promise.resolve(undefined);
    });
    renderWithClient(<App />);

    await screen.findByText(/Connect your Battle.net client/);
    // A placeholder is gone the moment the field has a value, so it can't be the only label.
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
  });

  it("renders the Guild tab in the nav once connected", async () => {
    renderWithClient(<App />);
    expect(await screen.findByRole("tab", { name: "Guild" })).toBeInTheDocument();
  });

  it("switches to the Auctions tab and renders the browser", async () => {
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Auctions" }));
    expect(await screen.findByRole("heading", { name: "Auction House" })).toBeInTheDocument();
  });

  it("shows the build-time version stamp in the footer", async () => {
    renderWithClient(<App />);
    // vitest injects a fixed __BUILD_ID__ (see vitest.config.ts).
    expect(await screen.findByText("v0.0.0-test")).toBeInTheDocument();
  });

  it("opens the settings dialog from the header", async () => {
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByLabelText(/Region/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Theme/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("disconnects from the settings dialog", async () => {
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("clear_credentials"));
    await screen.findByText(/Connect your Battle.net client/);
  });

  it("restores the persisted region on load (shown in settings)", async () => {
    localStorage.setItem("wow-companion:region", "eu");
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    const select = screen.getByLabelText(/Region/) as HTMLSelectElement;
    expect(select.value).toBe("eu");
  });

  it("persists a region change from settings", async () => {
    renderWithClient(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    const select = screen.getByLabelText(/Region/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "kr" } });
    await waitFor(() => expect(localStorage.getItem("wow-companion:region")).toBe("kr"));
  });

  it("opens a character's sheet from the Warband roster", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_credentials") return Promise.resolve(true);
      if (cmd === "get_warband")
        return Promise.resolve({
          account: "ACC",
          source: "s",
          characters: [{ name: "Testchar", realm: "Testrealm" }],
        });
      return Promise.resolve(undefined);
    });
    renderWithClient(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "Warband" }));
    fireEvent.click(await screen.findByRole("button", { name: "Testchar" }));

    // Switched to the Character tab, with the roster entry seeded into the lookup form.
    await screen.findByRole("heading", { name: "Character Lookup" });
    const realmInput = screen.getByPlaceholderText(/Realm/);
    await waitFor(() => expect(realmInput).toHaveValue("Testrealm"));
    expect(screen.getByPlaceholderText("Character name")).toHaveValue("Testchar");
  });

  it("switches the region to the one that lists the alt's realm when opening from Warband", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_credentials") return Promise.resolve(true);
      if (cmd === "get_warband")
        return Promise.resolve({
          account: "ACC",
          source: "s",
          characters: [{ name: "Testchar", realm: "Euonly" }],
        });
      return Promise.resolve(undefined);
    });
    // Only the EU realm index lists "Euonly"; other regions come back empty, so detection is
    // unambiguous — the app should switch the region selector from US to EU.
    mockFetch.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url.includes("/data/wow/realm/index")) {
        const realms = requestRegion(input) === "eu" ? [{ name: "Euonly", slug: "euonly" }] : [];
        return jsonResponse({ realms });
      }
      return jsonResponse({});
    });
    renderWithClient(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "Warband" }));
    fireEvent.click(await screen.findByRole("button", { name: "Testchar" }));

    // The alt is seeded into the Character lookup...
    await screen.findByRole("heading", { name: "Character Lookup" });
    await waitFor(() => expect(screen.getByPlaceholderText(/Realm/)).toHaveValue("Euonly"));

    // ...and detection flipped the region to EU — confirm via the settings dialog.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const select = screen.getByLabelText(/Region/) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("eu"));
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { Settings } from "./Settings";
import type { Region } from "../vendor/battlenet-wow-client";

const mockInvoke = vi.mocked(invoke);

function renderSettings(over: Partial<Parameters<typeof Settings>[0]> = {}) {
  const props = {
    region: "us" as Region,
    onRegionChange: vi.fn(),
    onDisconnect: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<Settings {...props} />);
  return props;
}

describe("Settings", () => {
  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("renders region, theme, and credential controls in one dialog", () => {
    renderSettings();
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByLabelText(/Region/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Theme/)).toBeInTheDocument();
    // The credential form is collapsed by default; only its opener shows.
    expect(within(dialog).queryByPlaceholderText("Client ID")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Edit credentials" })).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Disconnect credentials" }),
    ).toBeInTheDocument();
  });

  it("names both credential fields, so they stay identifiable once typed into", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Edit credentials" }));
    // A placeholder disappears the moment there's a value — it can't be the only label.
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
  });

  it("changes the region through onRegionChange", () => {
    const { onRegionChange } = renderSettings();
    fireEvent.change(screen.getByLabelText(/Region/), { target: { value: "eu" } });
    expect(onRegionChange).toHaveBeenCalledWith("eu");
  });

  it("saves replaced credentials to the keychain", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Edit credentials" }));
    fireEvent.change(screen.getByPlaceholderText("Client ID"), { target: { value: "id-123" } });
    fireEvent.change(screen.getByPlaceholderText("Client Secret"), {
      target: { value: "sec-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save to keychain" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("save_credentials", {
        clientId: "id-123",
        clientSecret: "sec-456",
      }),
    );
    // Announced, not merely shown — the result appears far from the button that caused it.
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });

  it("disconnects through onDisconnect", () => {
    const { onDisconnect } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect credentials" }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps the credential form collapsed until asked for", () => {
    // Settings is only reachable once credentials exist, so this form only ever *replaces* a
    // working pair — showing it by default invites editing something that isn't broken.
    renderSettings();
    expect(screen.queryByPlaceholderText("Client ID")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save to keychain" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit credentials" }));
    expect(screen.getByPlaceholderText("Client ID")).toBeInTheDocument();
    // The opener goes away while the editor is open, so there's one way back out.
    expect(screen.queryByRole("button", { name: "Edit credentials" })).not.toBeInTheDocument();
  });

  it("collapses the form again after a successful save, keeping the result announced", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Edit credentials" }));
    fireEvent.change(screen.getByPlaceholderText("Client ID"), { target: { value: "id" } });
    fireEvent.change(screen.getByPlaceholderText("Client Secret"), { target: { value: "sec" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to keychain" }));

    // "Saved." lives outside the form precisely so it survives the collapse.
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    await waitFor(() => expect(screen.queryByPlaceholderText("Client ID")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Edit credentials" })).toBeInTheDocument();
  });

  it("keeps the form open when a save fails, so the values can be corrected", async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === "save_credentials" ? Promise.reject("nope") : Promise.resolve(undefined),
    );
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Edit credentials" }));
    fireEvent.change(screen.getByPlaceholderText("Client ID"), { target: { value: "id" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to keychain" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/nope/);
    // Collapsing here would throw away what was typed and force a retype.
    expect(screen.getByPlaceholderText("Client ID")).toBeInTheDocument();
  });

  it("cancels an edit without saving, discarding what was typed", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Edit credentials" }));
    fireEvent.change(screen.getByPlaceholderText("Client ID"), { target: { value: "typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByPlaceholderText("Client ID")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("save_credentials", expect.anything());

    // Reopening starts clean rather than restoring the abandoned value.
    fireEvent.click(screen.getByRole("button", { name: "Edit credentials" }));
    expect(screen.getByPlaceholderText("Client ID")).toHaveValue("");
  });

  it("offers to connect an account when none is connected", async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "has_account_grant" ? false : undefined),
    );
    renderSettings();
    expect(await screen.findByRole("button", { name: "Connect account" })).toBeInTheDocument();
    // The 24-hour expiry is stated, so a connection lapsing overnight reads as expected.
    expect(screen.getByText(/lasts about 24 hours/)).toBeInTheDocument();
  });

  it("offers to disconnect when one is connected, and says what that does not do", async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "has_account_grant" ? true : undefined),
    );
    renderSettings();
    expect(await screen.findByRole("button", { name: "Disconnect account" })).toBeInTheDocument();
    // It forgets a local token; it does not revoke the authorisation on Battle.net.
    expect(screen.getByText(/stays on your Battle.net account/)).toBeInTheDocument();
  });

  it("keeps the two disconnects distinct, so neither can be clicked by mistake", async () => {
    // Both exist in one dialog and do different things: one drops the client credentials every data
    // tab needs, the other only forgets the account grant.
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "has_account_grant" ? true : undefined),
    );
    renderSettings();
    await screen.findByRole("button", { name: "Disconnect account" });
    expect(screen.getByRole("button", { name: "Disconnect credentials" })).toBeInTheDocument();
  });

  it("disconnecting the account leaves the credentials alone", async () => {
    // The regression that would take every data tab down with it.
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "has_account_grant" ? true : undefined),
    );
    const { onDisconnect } = renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect account" }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("clear_account_grant"));
    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commands).not.toContain("clear_credentials");
    // ...and it doesn't drop the app back to the connect gate either.
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("disables the connect button while a consent round trip is in flight", async () => {
    // Otherwise a second click opens another browser window against a port already bound.
    let release: (() => void) | undefined;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_account_grant") return Promise.resolve(false);
      if (cmd === "begin_account_login") return new Promise<void>((r) => (release = r));
      return Promise.resolve(undefined);
    });
    renderSettings();
    const button = await screen.findByRole("button", { name: "Connect account" });
    fireEvent.click(button);

    const pending = await screen.findByRole("button", { name: "Waiting for Battle.net…" });
    expect(pending).toBeDisabled();
    release?.();
  });

  it("announces why a connection attempt failed", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_account_grant") return Promise.resolve(false);
      if (cmd === "begin_account_login")
        return Promise.reject("Battle.net declined the request: access_denied");
      return Promise.resolve(undefined);
    });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Connect account" }));

    // Announced rather than only shown — the outcome lands long after the click.
    expect(await screen.findByRole("status")).toHaveTextContent(/access_denied/);
    expect(screen.getByRole("button", { name: "Connect account" })).toBeEnabled();
  });

  it("traps Tab inside the dialog, wrapping at both ends", () => {
    // `aria-modal="true"` promises the rest of the app is unreachable; without a trap, Tab walks
    // straight out through the backdrop into the page behind it.
    renderSettings();
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button, input, select")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("pulls focus back in if it has escaped the dialog", () => {
    renderSettings();
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    document.body.focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on the close button, Escape, and a backdrop press", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Settings region="us" onRegionChange={() => {}} onDisconnect={() => {}} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(container.querySelector(".modal-backdrop") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

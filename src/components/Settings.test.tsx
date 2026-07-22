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
    expect(within(dialog).getByPlaceholderText("Client ID")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("names both credential fields, so they stay identifiable once typed into", () => {
    renderSettings();
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
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Tauri plugins so nothing hits real IPC. `vi.hoisted` makes the mock fns available to the
// hoisted `vi.mock` factories.
const { check, relaunch } = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

import { checkForUpdate } from "./updater";

type TauriWindow = { __TAURI_INTERNALS__?: object };

describe("checkForUpdate", () => {
  beforeEach(() => {
    check.mockReset();
    relaunch.mockReset();
    // Pretend we're inside the Tauri shell so the guard lets the check through.
    (window as unknown as TauriWindow).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as TauriWindow).__TAURI_INTERNALS__;
  });

  it("returns null when the app is current", async () => {
    check.mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
  });

  it("returns the available version when an update exists", async () => {
    check.mockResolvedValue({ version: "0.2.0", downloadAndInstall: vi.fn() });
    const update = await checkForUpdate();
    expect(update?.version).toBe("0.2.0");
  });

  it("installs by downloading then relaunching, in order", async () => {
    const order: string[] = [];
    const downloadAndInstall = vi.fn(async () => void order.push("download"));
    relaunch.mockImplementation(async () => void order.push("relaunch"));
    check.mockResolvedValue({ version: "0.2.0", downloadAndInstall });

    const update = await checkForUpdate();
    await update!.install();

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["download", "relaunch"]);
  });

  it("swallows updater errors and reports no update", async () => {
    check.mockRejectedValue(new Error("404: no release published"));
    expect(await checkForUpdate()).toBeNull();
  });

  it("does not touch the plugin when not running under Tauri", async () => {
    delete (window as unknown as TauriWindow).__TAURI_INTERNALS__;
    check.mockResolvedValue({ version: "9.9.9", downloadAndInstall: vi.fn() });
    expect(await checkForUpdate()).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });
});

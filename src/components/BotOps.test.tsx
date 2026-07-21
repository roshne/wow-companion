import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { BotOps } from "./BotOps";
import type { OpsTargetInfo } from "../lib/botops";

const mockInvoke = vi.mocked(invoke);
const one: OpsTargetInfo[] = [{ name: "debug", ssh: "me@box" }];

function mockBackend(
  env: Record<string, string> = { WOW_REALM: "eitrigg", ANNOUNCE_CHANNEL_ID: "111" },
) {
  mockInvoke.mockImplementation((cmd) => {
    switch (cmd) {
      case "bot_status":
        return Promise.resolve({
          running: true,
          status: "Up 3 days",
          image: "img",
          realmStatus: "UP",
        });
      case "bot_env_get":
        return Promise.resolve(env);
      case "bot_env_set":
        return Promise.resolve({ ok: true, changed: ["WOW_REALM"], recreated: true, backup: "/x" });
      case "bot_restart":
        return Promise.resolve("Bot restarted.");
      case "bot_logs":
        return Promise.resolve("a log line");
      default:
        return Promise.resolve(undefined);
    }
  });
}

describe("BotOps", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockBackend();
  });

  it("loads status and populates the env fields for the selected target", async () => {
    render(<BotOps targets={one} />);
    expect(await screen.findByText("Up 3 days")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("bot_status", { target: 0 });
    const realm = screen.getByLabelText("Realm slug") as HTMLInputElement;
    expect(realm.value).toBe("eitrigg");
  });

  it("hides the target selector with a single bot", async () => {
    render(<BotOps targets={one} />);
    await screen.findByText("Up 3 days");
    expect(screen.queryByLabelText("Bot")).not.toBeInTheDocument();
  });

  it("switches target and reloads against the new bot", async () => {
    render(
      <BotOps
        targets={[
          { name: "debug", ssh: "a@h" },
          { name: "prod", ssh: "b@h" },
        ]}
      />,
    );
    await screen.findByText("Up 3 days");
    fireEvent.change(screen.getByLabelText("Bot"), { target: { value: "1" } });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("bot_status", { target: 1 }));
  });

  it("enables Apply only after an edit and sends just the changed key for the target", async () => {
    render(<BotOps targets={one} />);
    const realm = (await screen.findByLabelText("Realm slug")) as HTMLInputElement;
    const apply = screen.getByRole("button", { name: "Apply & recreate" });
    expect(apply).toBeDisabled();

    fireEvent.change(realm, { target: { value: "shuhalo" } });
    expect(apply).toBeEnabled();

    fireEvent.click(apply); // opens the confirm bar
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("bot_env_set", {
        target: 0,
        changes: [{ key: "WOW_REALM", value: "shuhalo" }],
      }),
    );
    expect(await screen.findByText(/bot recreated/)).toBeInTheDocument();
  });

  it("restarts the selected target after confirmation", async () => {
    render(<BotOps targets={one} />);
    await screen.findByText("Up 3 days");

    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("bot_restart", { target: 0 }));
    expect(await screen.findByText("Bot restarted.")).toBeInTheDocument();
  });

  it("fetches logs on demand", async () => {
    render(<BotOps targets={one} />);
    await screen.findByText("Up 3 days");

    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("bot_logs", { target: 0, lines: 200 }),
    );
    expect(await screen.findByText("a log line")).toBeInTheDocument();
  });
});

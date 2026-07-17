import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Mock the updater lib so the banner's behaviour is exercised without touching the Tauri plugins.
const { checkForUpdate } = vi.hoisted(() => ({ checkForUpdate: vi.fn() }));
vi.mock("../lib/updater", () => ({ checkForUpdate }));

import { UpdateBanner } from "./UpdateBanner";

describe("UpdateBanner", () => {
  beforeEach(() => {
    checkForUpdate.mockReset();
  });

  it("renders nothing when the app is current", async () => {
    checkForUpdate.mockResolvedValue(null);
    const { container } = render(<UpdateBanner />);
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the available version and installs on click", async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    checkForUpdate.mockResolvedValue({ version: "0.2.0", install });
    render(<UpdateBanner />);

    const button = await screen.findByRole("button", { name: /install & restart/i });
    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();

    fireEvent.click(button);
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
  });
});

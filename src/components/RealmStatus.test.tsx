import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

// RealmStatus reads the local warband export via the `get_warband` Tauri command; mock it.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { RealmStatus } from "./RealmStatus";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

function page(results: unknown[]) {
  return { data: { pageCount: 1, results }, response: mockResponse(200) };
}

const emptyWarband = { account: "", source: "", characters: [] };

describe("RealmStatus", () => {
  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(emptyWarband);
  });

  it("auto-fetches on mount, renders rows, and filters them", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue(
      page([
        { data: { id: 1, realms: [{ name: { en_US: "Tichondrius" } }], status: { type: "UP" } } },
        { data: { id: 2, realms: [{ name: { en_US: "Area 52" } }], status: { type: "UP" } } },
      ]),
    );
    renderWithClient(<RealmStatus bnet={bnet} />);

    await waitFor(() => expect(screen.getByText("Tichondrius")).toBeInTheDocument());
    expect(screen.getByText("Area 52")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter…"), { target: { value: "tich" } });
    expect(screen.queryByText("Area 52")).toBeNull();
    expect(screen.getByText("Tichondrius")).toBeInTheDocument();
  });

  it("surfaces realm type, category, and timezone", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue(
      page([
        {
          data: {
            id: 1,
            realms: [
              {
                name: { en_US: "Tichondrius" },
                type: { name: { en_US: "Normal" }, type: "NORMAL" },
                category: { en_US: "United States" },
                timezone: "America/New_York",
              },
            ],
            status: { type: "UP" },
          },
        },
      ]),
    );
    renderWithClient(<RealmStatus bnet={bnet} />);

    await screen.findByText("Tichondrius");
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
    expect(screen.getByText("America/New_York")).toBeInTheDocument();
  });

  it("shows an error message when the search fails", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(503) });
    renderWithClient(<RealmStatus bnet={bnet} />);

    await waitFor(() => expect(screen.getByText("Failed (HTTP 503).")).toBeInTheDocument());
  });

  it("auto-pins warband realms present in the region and floats them to the top", async () => {
    mockInvoke.mockResolvedValue({
      account: "acc",
      source: "src",
      characters: [{ name: "Bob", realm: "Area 52" }],
    });
    const { bnet, get } = mockBnet();
    get.mockResolvedValue(
      page([
        {
          data: {
            id: 1,
            realms: [{ name: { en_US: "Tichondrius" }, slug: "tichondrius" }],
            status: { type: "UP" },
          },
        },
        {
          data: {
            id: 2,
            realms: [{ name: { en_US: "Area 52" }, slug: "area-52" }],
            status: { type: "UP" },
          },
        },
      ]),
    );
    renderWithClient(<RealmStatus bnet={bnet} />);

    await screen.findByText("Area 52");
    await waitFor(() => {
      const bodyRows = screen.getAllByRole("row").slice(1);
      expect(bodyRows[0].textContent).toContain("Area 52");
    });
    const area52Row = screen.getByText("Area 52").closest("tr")!;
    expect(area52Row.querySelector('[aria-pressed="true"]')).not.toBeNull();
  });

  it("ignores warband realms not present in the region", async () => {
    mockInvoke.mockResolvedValue({
      account: "acc",
      source: "src",
      characters: [{ name: "Bob", realm: "Nonexistent" }],
    });
    const { bnet, get } = mockBnet();
    get.mockResolvedValue(
      page([
        {
          data: {
            id: 1,
            realms: [{ name: { en_US: "Tichondrius" }, slug: "tichondrius" }],
            status: { type: "UP" },
          },
        },
      ]),
    );
    renderWithClient(<RealmStatus bnet={bnet} />);

    await screen.findByText("Tichondrius");
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("get_warband"));
    const row = screen.getByText("Tichondrius").closest("tr")!;
    expect(row.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it("pins a realm when its star is clicked", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue(
      page([
        {
          data: {
            id: 1,
            realms: [{ name: { en_US: "Tichondrius" }, slug: "tichondrius" }],
            status: { type: "UP" },
          },
        },
      ]),
    );
    renderWithClient(<RealmStatus bnet={bnet} />);

    const row = (await screen.findByText("Tichondrius")).closest("tr")!;
    fireEvent.click(row.querySelector("button")!);
    await waitFor(() =>
      expect(
        screen.getByText("Tichondrius").closest("tr")!.querySelector('[aria-pressed="true"]'),
      ).not.toBeNull(),
    );
  });
});

import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { RealmStatus } from "./RealmStatus";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";

function page(results: unknown[]) {
  return { data: { pageCount: 1, results }, response: mockResponse(200) };
}

describe("RealmStatus", () => {
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
});

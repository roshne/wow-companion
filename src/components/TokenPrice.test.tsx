import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { TokenPrice } from "./TokenPrice";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";

describe("TokenPrice", () => {
  it("does not fetch until the button is pressed, then shows the price", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { price: 2_500_000 }, response: mockResponse(200) });
    renderWithClient(<TokenPrice bnet={bnet} />);

    expect(get).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(screen.getByText("250 g")).toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the request fails", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(<TokenPrice bnet={bnet} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });
});

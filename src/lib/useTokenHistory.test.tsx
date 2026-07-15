import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { useTokenHistory } from "./useTokenHistory";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";

function Probe({ bnet }: { bnet: BlizzardClient }) {
  const { history } = useTokenHistory(bnet);
  return <div data-testid="count">{history.length}</div>;
}

describe("useTokenHistory", () => {
  beforeEach(() => localStorage.clear());

  it("accumulates a price point from a successful fetch", async () => {
    const { bnet, get } = mockBnet("us");
    get.mockResolvedValue({
      data: { price: 2_500_000, last_updated_timestamp: 123 },
      response: mockResponse(200),
    });
    renderWithClient(<Probe bnet={bnet} />);

    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TokenPrice } from "./TokenPrice";
import type { TokenView } from "../lib/useTokenHistory";
import type { TokenPricePoint } from "../lib/persist";

function tokenView(overrides: Partial<TokenView> = {}): TokenView {
  return {
    data: undefined,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    history: [],
    ...overrides,
  };
}

const points = (...prices: number[]): TokenPricePoint[] =>
  prices.map((price, i) => ({ t: i + 1, price }));

describe("TokenPrice", () => {
  it("renders the current price and updated time", () => {
    render(
      <TokenPrice
        token={tokenView({ data: { price: 2_500_000, last_updated_timestamp: 1_700_000_000_000 } })}
      />,
    );
    expect(screen.getByText("250 g")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("shows the 'collecting' state until there are two points", () => {
    render(<TokenPrice token={tokenView({ history: points(2_500_000) })} />);
    expect(screen.getByText("Collecting price history…")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Token price history" })).toBeNull();
  });

  it("renders the sparkline once there are two or more points", () => {
    render(<TokenPrice token={tokenView({ history: points(2_500_000, 2_600_000, 2_400_000) })} />);
    expect(screen.getByRole("img", { name: "Token price history" })).toBeInTheDocument();
    expect(screen.queryByText("Collecting price history…")).toBeNull();
  });

  it("calls refetch when Refresh is pressed", () => {
    const refetch = vi.fn();
    render(<TokenPrice token={tokenView({ refetch })} />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows an error message", () => {
    render(<TokenPrice token={tokenView({ isError: true, error: new Error("boom") })} />);
    expect(screen.getByText(/Error: Error: boom/)).toBeInTheDocument();
  });

  it("shows a loading skeleton on the first fetch (no data yet)", () => {
    render(<TokenPrice token={tokenView({ isFetching: true })} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/g$/)).toBeNull();
  });
});

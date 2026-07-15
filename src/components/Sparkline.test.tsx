import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders nothing for fewer than two values", () => {
    const { container } = render(<Sparkline values={[5]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws a polyline with one point per value", () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline!.getAttribute("points")!.trim().split(/\s+/)).toHaveLength(4);
  });
});

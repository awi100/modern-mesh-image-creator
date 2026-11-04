import { describe, it, expect } from "vitest";
import { drawFrom } from "./stock-draw";

describe("drawing stock for a sale", () => {
  it("takes everything from the primary bucket when it can", () => {
    expect(drawFrom(2, 10, 25)).toEqual({ fromPrimary: 2, fromAndover: 0, total: 2, short: 0 });
  });

  it("falls back to Andover when the bucket is empty", () => {
    // This Is Why We Can't Have Nice Things, order #4035: 0 at home, 25 at
    // Andover. It used to deduct nothing at all.
    expect(drawFrom(1, 0, 25)).toEqual({ fromPrimary: 0, fromAndover: 1, total: 1, short: 0 });
  });

  it("splits across both when the bucket is only part-way there", () => {
    expect(drawFrom(5, 2, 25)).toEqual({ fromPrimary: 2, fromAndover: 3, total: 5, short: 0 });
  });

  it("still reports a shortfall when neither can cover it", () => {
    expect(drawFrom(4, 1, 1)).toEqual({ fromPrimary: 1, fromAndover: 1, total: 2, short: 2 });
  });

  it("treats a negative balance as empty, never as capacity", () => {
    // A bucket at -1 has nothing to give. Letting Math.min see the negative is
    // what logged orders #3580/#3583 as "kits 0 -> -1".
    expect(drawFrom(1, -1, 0)).toEqual({ fromPrimary: 0, fromAndover: 0, total: 0, short: 1 });
    expect(drawFrom(1, -5, 3)).toEqual({ fromPrimary: 0, fromAndover: 1, total: 1, short: 0 });
  });

  it("takes nothing for a zero or negative request", () => {
    expect(drawFrom(0, 10, 10).total).toBe(0);
    expect(drawFrom(-3, 10, 10).total).toBe(0);
  });

  it("never takes more than was asked for", () => {
    const d = drawFrom(3, 100, 100);
    expect(d.total).toBe(3);
    expect(d.fromAndover).toBe(0);
  });
});

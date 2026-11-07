import { describe, it, expect } from "vitest";
import { restoreSplit } from "./canvas-stock";
import { drawFrom } from "./stock-draw";

describe("how a canvas restore splits", () => {
  it("sends everything back to the bucket when nothing came from Andover", () => {
    expect(restoreSplit(3, 0)).toEqual({ toPrimary: 3, toAndover: 0 });
  });

  it("sends the Andover portion back to Andover", () => {
    // A draw of 3 that took 1 from the tote and 2 from Andover must not credit
    // all 3 to the tote — that would move stock between two real places.
    expect(restoreSplit(3, 2)).toEqual({ toPrimary: 1, toAndover: 2 });
  });

  it("never credits more to Andover than is being restored", () => {
    // A partial restore of a bigger draw.
    expect(restoreSplit(1, 5)).toEqual({ toPrimary: 0, toAndover: 1 });
  });

  it("ignores a negative or fractional input", () => {
    expect(restoreSplit(-2, 1)).toEqual({ toPrimary: 0, toAndover: 0 });
    expect(restoreSplit(2.7, 1.9)).toEqual({ toPrimary: 1, toAndover: 1 });
  });

  it("round-trips a draw exactly", () => {
    // Whatever drawFrom took, restoreSplit must put back in the same places.
    const d = drawFrom(5, 2, 10);
    const r = restoreSplit(d.total, d.fromAndover);
    expect(r.toPrimary).toBe(d.fromPrimary);
    expect(r.toAndover).toBe(d.fromAndover);
  });

  it("round-trips a draw that fell entirely to Andover", () => {
    const d = drawFrom(2, 0, 25); // the Nice Things case: 0 at home, 25 at Andover
    expect(d).toMatchObject({ fromPrimary: 0, fromAndover: 2 });
    expect(restoreSplit(d.total, d.fromAndover)).toEqual({ toPrimary: 0, toAndover: 2 });
  });
});

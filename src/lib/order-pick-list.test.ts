import { describe, it, expect } from "vitest";
import { isSkipped, isOnPickList, onPickList } from "./order-pick-list";

const order = (over: Partial<{ id: string; locallyFulfilled: boolean; excludedAt: string | Date | null; canvases: number }> = {}) => ({
  id: "x",
  locallyFulfilled: false,
  excludedAt: null as string | Date | null,
  canvases: 0,
  ...over,
});

describe("isSkipped", () => {
  it("is false until someone unticks the order", () => {
    expect(isSkipped(order())).toBe(false);
  });

  it("accepts the Date the server holds and the string the client gets", () => {
    expect(isSkipped(order({ excludedAt: new Date("2026-11-13T10:00:00Z") }))).toBe(true);
    expect(isSkipped(order({ excludedAt: "2026-11-13T10:00:00.000Z" }))).toBe(true);
  });

  it("does not treat the epoch as unskipped", () => {
    // `excludedAt != null` rather than a truthiness check: new Date(0) is a
    // real timestamp but falsy once coerced, and so is the empty string.
    expect(isSkipped(order({ excludedAt: new Date(0) }))).toBe(true);
  });
});

describe("onPickList", () => {
  it("keeps an ordinary open order", () => {
    expect(onPickList([order({ id: "a" })]).map((o) => o.id)).toEqual(["a"]);
  });

  it("drops orders already deducted", () => {
    const rows = [order({ id: "a" }), order({ id: "b", locallyFulfilled: true })];
    expect(onPickList(rows).map((o) => o.id)).toEqual(["a"]);
  });

  it("drops orders deliberately skipped", () => {
    const rows = [order({ id: "a" }), order({ id: "wholesale", excludedAt: new Date() })];
    expect(onPickList(rows).map((o) => o.id)).toEqual(["a"]);
  });

  it("drops an order that is both", () => {
    expect(onPickList([order({ id: "a", locallyFulfilled: true, excludedAt: new Date() })])).toEqual([]);
  });

  it("stops one skipped order inflating what gets pulled", () => {
    // The bug this exists for: a 30-unit wholesale order summed into the
    // demand totals makes every OTHER order's row read "need 25" on a design
    // there is plenty of.
    const rows = [
      order({ id: "retail-1", canvases: 2 }),
      order({ id: "retail-2", canvases: 3 }),
      order({ id: "wholesale", canvases: 30, excludedAt: new Date() }),
    ];
    const needed = onPickList(rows).reduce((sum, o) => sum + o.canvases, 0);
    expect(needed).toBe(5);
  });

  it("gives a skipped order's stock back to the orders behind it", () => {
    // The allocation hands out inventory oldest-first. Left in the queue, an
    // old wholesale order consumes the canvases first and the orders behind it
    // report as unfulfillable against stock sitting on the shelf.
    const rows = [
      order({ id: "wholesale", canvases: 30, excludedAt: new Date() }),
      order({ id: "retail", canvases: 4 }),
    ];
    let remaining = 10;
    const fulfillable: string[] = [];
    for (const o of onPickList(rows)) {
      if (remaining >= o.canvases) { fulfillable.push(o.id); remaining -= o.canvases; }
    }
    expect(fulfillable).toEqual(["retail"]);
    expect(remaining).toBe(6);
  });

  it("does not mutate or reorder what it is given", () => {
    const rows = [order({ id: "a" }), order({ id: "b" })];
    const copy = [...rows];
    expect(onPickList(rows).map((o) => o.id)).toEqual(["a", "b"]);
    expect(rows).toEqual(copy);
  });
});

describe("isOnPickList", () => {
  it("keeps an ordinary open order", () => {
    expect(isOnPickList(order())).toBe(true);
  });

  it("drops one already deducted", () => {
    // The half the API route was missing: its totals tested excludedAt alone,
    // so an order whose stock had already left kept counting as still owed.
    expect(isOnPickList(order({ locallyFulfilled: true }))).toBe(false);
  });

  it("drops one deliberately skipped", () => {
    expect(isOnPickList(order({ excludedAt: new Date() }))).toBe(false);
  });

  it("agrees with onPickList on every combination", () => {
    for (const locallyFulfilled of [false, true]) {
      for (const excludedAt of [null, new Date()]) {
        const o = order({ locallyFulfilled, excludedAt });
        expect(isOnPickList(o)).toBe(onPickList([o]).length === 1);
      }
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  allocateCosts,
  landedUnitCost,
  valueFifo,
  consumeFifo,
  weightedAverage,
  periodicConsumption,
  consumptionBreakdown,
  round2,
  type Layer,
} from "./costing";

const layer = (
  id: string,
  qty: number,
  cost: number,
  day: string,
  estimated = false,
): Layer => ({
  id,
  quantity: qty,
  remaining: qty,
  landedUnitCost: cost,
  receivedAt: new Date(day),
  estimated,
});

describe("landed cost allocation", () => {
  it("splits freight by value, and the parts add back to the whole", () => {
    // The real Sanhome invoice: SH20261010.
    const lines = [
      { id: "ne", quantity: 300, unitCost: 3.2 },   // $960.00
      { id: "southie", quantity: 100, unitCost: 3.92 }, // $392.00
    ];
    const alloc = allocateCosts(lines, 455, "value");
    expect(round2(alloc.get("ne")! + alloc.get("southie")!)).toBe(455);
    // The bigger line carries the bigger share.
    expect(alloc.get("ne")!).toBeGreaterThan(alloc.get("southie")!);
    // 960 / (960 + 392) * 455
    expect(alloc.get("ne")).toBeCloseTo(323.08, 2);
  });

  it("splits by quantity when freight is priced per piece", () => {
    const lines = [
      { id: "ne", quantity: 300, unitCost: 3.2 },
      { id: "southie", quantity: 100, unitCost: 3.92 },
    ];
    const alloc = allocateCosts(lines, 400, "quantity");
    expect(alloc.get("ne")).toBe(300);
    expect(alloc.get("southie")).toBe(100);
  });

  it("gives rounding drift to the largest line so the total is exact", () => {
    const lines = [
      { id: "a", quantity: 1, unitCost: 1 },
      { id: "b", quantity: 1, unitCost: 1 },
      { id: "c", quantity: 1, unitCost: 1 },
    ];
    const alloc = allocateCosts(lines, 10, "value");
    expect(round2([...alloc.values()].reduce((a, b) => a + b, 0))).toBe(10);
  });

  it("splits evenly when there is nothing to weight by", () => {
    const lines = [
      { id: "a", quantity: 0, unitCost: 0 },
      { id: "b", quantity: 0, unitCost: 0 },
    ];
    const alloc = allocateCosts(lines, 50, "value");
    expect(alloc.get("a")).toBe(25);
    expect(alloc.get("b")).toBe(25);
  });

  it("computes a landed unit cost that includes freight", () => {
    // Raincoat Pup: 300 @ $3.25 + $260 FedEx = $1,235 / 300
    expect(landedUnitCost(300, 3.25, 260)).toBeCloseTo(4.12, 2);
  });
});

describe("FIFO valuation", () => {
  const march = layer("mar", 100, 5, "2026-03-01");
  const july = layer("jul", 100, 6, "2026-07-01");
  const october = layer("oct", 100, 7, "2026-10-01");

  it("keeps each purchase price rather than overwriting it", () => {
    const v = valueFifo(300, [march, july, october]);
    expect(v.value).toBe(100 * 5 + 100 * 6 + 100 * 7);
    expect(v.uncoveredUnits).toBe(0);
  });

  it("values what is left from the OLDEST layers first", () => {
    // 150 on hand: 100 from March, 50 from July.
    const v = valueFifo(150, [march, july, october]);
    expect(v.value).toBe(100 * 5 + 50 * 6);
  });

  it("reports units no layer covers instead of guessing a price", () => {
    const v = valueFifo(250, [march]); // only 100 costed
    expect(v.coveredUnits).toBe(100);
    expect(v.uncoveredUnits).toBe(150);
    expect(v.value).toBe(500);
  });

  it("flags a valuation that leaned on an estimated layer", () => {
    const opening = layer("open", 40, 4.5, "2026-01-01", true);
    expect(valueFifo(40, [opening]).estimated).toBe(true);
    expect(valueFifo(100, [march]).estimated).toBe(false);
  });

  it("offers weighted average from the same layers", () => {
    expect(weightedAverage([march, july, october])).toBe(6);
    expect(weightedAverage([])).toBeNull();
  });
});

describe("FIFO consumption", () => {
  it("takes the oldest cost first and says which layers to draw down", () => {
    const march = layer("mar", 100, 5, "2026-03-01");
    const july = layer("jul", 100, 6, "2026-07-01");
    const r = consumeFifo(120, [march, july]);
    expect(r.cost).toBe(100 * 5 + 20 * 6);
    expect(r.draws).toEqual([
      { layerId: "mar", units: 100, unitCost: 5 },
      { layerId: "jul", units: 20, unitCost: 6 },
    ]);
    expect(r.shortUnits).toBe(0);
  });

  it("reports a shortfall rather than inventing a cost for it", () => {
    const r = consumeFifo(50, [layer("a", 20, 5, "2026-03-01")]);
    expect(r.cost).toBe(100);
    expect(r.shortUnits).toBe(30);
  });
});

describe("periodic consumption", () => {
  it("treats bought-minus-remaining as used", () => {
    const c = periodicConsumption(100, 35);
    expect(c.consumed).toBe(65);
    expect(c.discrepancy).toBe(0);
  });

  it("flags holding more than was ever bought instead of a negative sale", () => {
    const c = periodicConsumption(10, 25);
    expect(c.consumed).toBe(0);
    expect(c.discrepancy).toBe(15);
  });
});

describe("consumption breakdown", () => {
  it("separates what left with a record from what didn't", () => {
    // 65 gone: Shopify accounts for 40, a logged event for 20, nothing
    // explains the last 5.
    const b = consumptionBreakdown({ consumed: 65, shopifySold: 40, recordedManual: 20 });
    expect(b.unaccounted).toBe(5);
    expect(b.overRecorded).toBe(0);
  });

  it("never reports unaccounted stock as sold", () => {
    const b = consumptionBreakdown({ consumed: 65, shopifySold: 0, recordedManual: 0 });
    expect(b.shopifySold).toBe(0);
    expect(b.unaccounted).toBe(65);
  });

  it("flags more recorded than actually left", () => {
    const b = consumptionBreakdown({ consumed: 10, shopifySold: 8, recordedManual: 6 });
    expect(b.overRecorded).toBe(4);
    expect(b.unaccounted).toBe(0);
  });
});

describe("end-to-end: the worked example from the spec", () => {
  it("buy 100, sell 40, use 20 at an event, give away 5, hold 35", () => {
    // 1. Buy 100 canvases at $5, with $100 freight.
    const alloc = allocateCosts([{ id: "l1", quantity: 100, unitCost: 5 }], 100, "value");
    const unit = landedUnitCost(100, 5, alloc.get("l1")!);
    expect(unit).toBe(6); // ($500 + $100) / 100

    // 2. Receive them: one layer of 100 @ $6.
    const received = 100;
    const layers = [layer("l1", 100, unit, "2026-03-01")];

    // 3-6. 40 sold through Shopify, 20 to a sip-and-stitch, 5 as raffle
    //      prizes. The counted remainder is 35.
    const onHand = 35;

    const c = periodicConsumption(received, onHand);
    expect(c.consumed).toBe(65);

    // 7. Costs. Consumption is valued FIFO at $6.
    const consumed = consumeFifo(c.consumed, layers);
    expect(consumed.cost).toBe(390);

    // Only the Shopify portion is retail COGS. The event and the raffle are
    // recorded separately, and would be misreported as sales if they were not.
    const b = consumptionBreakdown({ consumed: c.consumed, shopifySold: 40, recordedManual: 25 });
    expect(b.shopifySold).toBe(40);
    expect(b.recordedManual).toBe(25);
    expect(b.unaccounted).toBe(0);
    expect(round2(b.shopifySold * unit)).toBe(240); // retail COGS
    expect(round2(b.recordedManual * unit)).toBe(150); // event + promo

    // 8. Ending valuation, and the reconciliation that has to hold:
    //    opening + receipts - consumed = ending.
    const ending = valueFifo(onHand, [
      { ...layers[0], remaining: onHand },
    ]);
    expect(ending.value).toBe(210);
    expect(round2(0 + received * unit - consumed.cost)).toBe(ending.value);
  });

  it("a 13ct intro kit is costed as one bought unit, not as components", () => {
    // Intro kits arrive finished from the supplier, so their landed cost IS
    // the kit. Adding canvas + thread + hardware on top would count the same
    // money twice.
    const kitUnit = landedUnitCost(50, 18.5, 75);
    expect(kitUnit).toBeCloseTo(20, 2);
    const v = valueFifo(50, [layer("k", 50, kitUnit, "2026-09-01")]);
    expect(v.value).toBeCloseTo(1000, 2);
  });
});

import { describe, it, expect } from "vitest";
import { buildMarketPrep, type PrepOrder, type PrepDesign, type PrepSupply } from "./market-prep";

/** A POS sale of `qty` units of `designId`, `kits` of which were "+ kit". */
function sale(day: string, designId: string, qty: number, kits: number): PrepOrder {
  const at = new Date(`${day}T12:00:00`);
  const items: PrepOrder["items"] = [];
  if (kits > 0) items.push({ productTitle: designId, quantity: kits, designId, supplyId: null, needsKit: true });
  if (qty - kits > 0) items.push({ productTitle: designId, quantity: qty - kits, designId, supplyId: null, needsKit: false });
  return { orderDate: at, createdAt: at, items };
}

function design(id: string, toteCanvas: number, toteKits: number): PrepDesign {
  return {
    id, name: id,
    marketCanvasPrinted: toteCanvas, marketKitsReady: toteKits,
    canvasPrinted: 50, kitsReady: 50,
    canvasAndover: 0, kitsAndover: 0,
    archivedAt: null,
  };
}

const NO_SUPPLIES: PrepSupply[] = [];
const build = (orders: PrepOrder[], designs: PrepDesign[], supplies = NO_SUPPLIES) =>
  buildMarketPrep(orders, new Set<string>(), designs, supplies, "balanced");

describe("kits are targeted one per canvas", () => {
  it("packs a kit for every canvas, not just the share that sold as kits", () => {
    // The Fenway Frank case. Its busiest market moved 6 canvases but only 5
    // with a kit, so attach-rate sizing asked for 9 canvases and 8 kits. A
    // tote holding exactly 9 and 8 then read as fully covered and the row
    // dropped off the to-pack list entirely — leaving the 9th buyer able to
    // take a canvas but no kit.
    const orders = [sale("2026-01-04", "fenway", 6, 5), sale("2026-02-08", "fenway", 4, 3)];
    const [row] = build(orders, [design("fenway", 9, 8)]).rows;

    expect(row.recommendedCanvas).toBe(9);
    expect(row.recommendedKit).toBe(9); // was 8, sized from the 5-kit peak
    expect(row.toteKits).toBe(8);
  });

  it("surfaces that row as short so it reaches the to-pack list", () => {
    // The list defaults to the "todo" filter, so a row is only visible while
    // some gap is non-zero. This is the half she could only see by switching
    // to the Tote counts tab.
    const orders = [sale("2026-01-04", "fenway", 6, 5), sale("2026-02-08", "fenway", 4, 3)];
    const { rows, summary } = build(orders, [design("fenway", 9, 8)]);
    const r = rows[0];

    const canvasGap = Math.max(0, r.recommendedCanvas - (r.toteCanvas ?? 0));
    const kitGap = Math.max(0, r.recommendedKit - (r.toteKits ?? 0));
    expect(canvasGap).toBe(0);
    expect(kitGap).toBe(1);
    expect(canvasGap + kitGap).toBeGreaterThan(0); // i.e. not "ready" -> visible
    expect(summary.kit.toPack).toBe(1);
  });

  it("targets kits for a design that has never sold one at a market", () => {
    // These are ordinary designs that sell kits online; no market kit sale yet
    // is a gap in a small sample, not evidence the kit isn't wanted.
    const [row] = build([sale("2026-01-04", "crab", 2, 0)], [design("crab", 0, 0)]).rows;
    expect(row.recommendedCanvas).toBeGreaterThan(0);
    expect(row.recommendedKit).toBe(row.recommendedCanvas);
  });

  it("never asks for fewer kits than canvases, at any buffer", () => {
    const orders = [
      sale("2026-01-04", "a", 6, 5), sale("2026-02-08", "a", 4, 1),
      sale("2026-01-04", "b", 3, 3), sale("2026-02-08", "b", 1, 0),
      sale("2026-01-04", "c", 1, 0),
    ];
    const designs = [design("a", 2, 1), design("b", 0, 0), design("c", 5, 5)];
    for (const buffer of ["conservative", "balanced", "aggressive"] as const) {
      const { rows } = buildMarketPrep(orders, new Set<string>(), designs, NO_SUPPLIES, buffer);
      expect(rows.length).toBe(3);
      for (const r of rows) expect(r.recommendedKit).toBe(r.recommendedCanvas);
    }
  });

  it("leaves supplies alone — they have one count, not a canvas/kit pair", () => {
    const at = new Date("2026-01-04T12:00:00");
    const orders: PrepOrder[] = [{
      orderDate: at, createdAt: at,
      items: [{ productTitle: "Needles", quantity: 4, designId: null, supplyId: "s1", needsKit: false }],
    }];
    const supplies: PrepSupply[] = [{ id: "s1", name: "Needles", marketQuantity: 1, quantity: 10 }];
    const [row] = build(orders, [], supplies).rows;

    expect(row.kind).toBe("supply");
    expect(row.recommendedCanvas).toBe(0);
    expect(row.recommendedKit).toBe(0);
    expect(row.recommended).toBeGreaterThan(0);
    expect(row.inTote).toBe(1);
  });

  it("still never sums a design's canvases and kits", () => {
    // Long-standing rule 1: 3 canvases + 3 kits is not "6 in tote".
    const [row] = build([sale("2026-01-04", "a", 3, 3)], [design("a", 3, 3)]).rows;
    expect(row.inTote).toBeNull();
    expect(row.toteCanvas).toBe(3);
    expect(row.toteKits).toBe(3);
  });
});

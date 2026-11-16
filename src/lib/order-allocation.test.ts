import { describe, it, expect } from "vitest";
import {
  kitBudgetKey,
  calculateDemandByDesign,
  calculateFulfillableOrders,
  type AllocatableItem,
  type AllocatableOrder,
} from "./order-allocation";

/**
 * The numbers here are the live Street Sign - Large pool: Boylston and Newbury
 * share THREE bags of thread between them, and each design's own kit columns
 * are held at 0. The Orders page used to select those zeroed columns directly
 * and report "0 kits" for both while three bags sat on the shelf.
 *
 * Fixing the read is the easy half. The dangerous half is what these tests are
 * for: once each member reports the whole pool, anything that budgets or totals
 * per design hands the same three bags to both.
 */
const POOL = "kg_large";

function item(over: Partial<AllocatableItem> = {}): AllocatableItem {
  return {
    itemType: "canvas",
    quantity: 1,
    needsKit: true,
    designId: "d_boylston",
    kitGroupId: null,
    kitsReady: 0,
    canvasPrinted: 10,
    supplyId: null,
    supplyQuantity: 0,
    ...over,
  };
}

const boylston = (over: Partial<AllocatableItem> = {}) =>
  item({ designId: "d_boylston", kitGroupId: POOL, kitsReady: 3, ...over });
const newbury = (over: Partial<AllocatableItem> = {}) =>
  item({ designId: "d_newbury", kitGroupId: POOL, kitsReady: 3, ...over });

let seq = 0;
function order(items: AllocatableItem[], over: Partial<AllocatableOrder> = {}): AllocatableOrder {
  seq += 1;
  return {
    shopifyOrderId: `o${seq}`,
    createdAt: `2026-11-${String(seq).padStart(2, "0")}T00:00:00Z`,
    isExpress: false,
    locallyFulfilled: false,
    excludedAt: null,
    items,
    ...over,
  };
}

describe("kitBudgetKey", () => {
  it("uses the pool when there is one, so members share a budget", () => {
    expect(kitBudgetKey(boylston())).toBe(POOL);
    expect(kitBudgetKey(newbury())).toBe(POOL);
  });

  it("falls back to the design for unpooled kits", () => {
    expect(kitBudgetKey(item({ designId: "d_lobster" }))).toBe("d_lobster");
  });

  it("is null for an item with no design, which has no kit stock", () => {
    expect(kitBudgetKey(item({ designId: null }))).toBeNull();
  });
});

describe("calculateFulfillableOrders with a shared kit pool", () => {
  it("does not spend the same bags on two different members", () => {
    // Two bags each, from a pool of three. The first order gets them; the
    // second is one short. Keyed per design both would read as packable.
    const a = order([boylston({ quantity: 2 })]);
    const b = order([newbury({ quantity: 2 })]);
    const out = calculateFulfillableOrders([a, b]);
    expect(out.has(a.shopifyOrderId)).toBe(true);
    expect(out.has(b.shopifyOrderId)).toBe(false);
  });

  it("lets a pool cover several members when it actually has the bags", () => {
    const a = order([boylston({ quantity: 1 })]);
    const b = order([newbury({ quantity: 2 })]);
    const out = calculateFulfillableOrders([a, b]);
    expect(out.size).toBe(2);
  });

  it("totals an order's own members before checking, not item by item", () => {
    // Four bags inside ONE order, from a pool of three. Checked separately,
    // each item sees the untouched pool of 3 >= 2 and passes, and the order
    // then deducts four.
    const a = order([boylston({ quantity: 2 }), newbury({ quantity: 2 })]);
    expect(calculateFulfillableOrders([a]).size).toBe(0);
  });

  it("packs that same order when the pool is deep enough", () => {
    const a = order([boylston({ quantity: 2, kitsReady: 4 }), newbury({ quantity: 2, kitsReady: 4 })]);
    expect(calculateFulfillableOrders([a]).size).toBe(1);
  });

  it("ignores pooled kit stock for an item that needs no kit", () => {
    const a = order([boylston({ quantity: 5, needsKit: false, kitsReady: 0 })]);
    expect(calculateFulfillableOrders([a]).size).toBe(1);
  });

  it("still keeps canvases per design — they are not interchangeable", () => {
    // Newbury has canvases, Boylston has none. A pooled kit must not make
    // Boylston packable off Newbury's canvas.
    const a = order([boylston({ canvasPrinted: 0 })]);
    const b = order([newbury({ canvasPrinted: 5 })]);
    const out = calculateFulfillableOrders([a, b]);
    expect(out.has(a.shopifyOrderId)).toBe(false);
    expect(out.has(b.shopifyOrderId)).toBe(true);
  });

  it("totals one design's canvases across its line items in an order", () => {
    // The "+ kit" and canvas-only variants of one design are two line items.
    const a = order([
      item({ designId: "d_x", canvasPrinted: 1, needsKit: true, kitsReady: 9 }),
      item({ designId: "d_x", canvasPrinted: 1, needsKit: false }),
    ]);
    expect(calculateFulfillableOrders([a]).size).toBe(0);
  });

  it("gives express orders the stock first", () => {
    const slow = order([boylston({ quantity: 3 })]);
    const rush = order([newbury({ quantity: 3 })], { isExpress: true, createdAt: "2026-11-30T00:00:00Z" });
    const out = calculateFulfillableOrders([slow, rush]);
    expect(out.has(rush.shopifyOrderId)).toBe(true);
    expect(out.has(slow.shopifyOrderId)).toBe(false);
  });

  it("does not let a skipped or deducted order eat the pool", () => {
    const skipped = order([boylston({ quantity: 3 })], { excludedAt: "2026-11-01T00:00:00Z" });
    const done = order([boylston({ quantity: 3 })], { locallyFulfilled: true });
    const real = order([newbury({ quantity: 3 })]);
    const out = calculateFulfillableOrders([skipped, done, real]);
    expect(out.has(real.shopifyOrderId)).toBe(true);
    expect(out.has(skipped.shopifyOrderId)).toBe(false);
    expect(out.has(done.shopifyOrderId)).toBe(false);
  });
});

describe("calculateDemandByDesign with a shared kit pool", () => {
  it("reports the POOL's kit demand to every member", () => {
    // Boylston owes 1 bag and Newbury 2, but they come out of one pool, so the
    // honest figure beside a pooled `kitsReady` of 3 is 3 on both rows. Per
    // design, each row would read 1-of-3 and 2-of-3 and look comfortable.
    const d = calculateDemandByDesign([
      order([boylston({ quantity: 1 })]),
      order([newbury({ quantity: 2 })]),
    ]);
    expect(d.get("d_boylston")!.totalKitsNeeded).toBe(3);
    expect(d.get("d_newbury")!.totalKitsNeeded).toBe(3);
  });

  it("keeps canvas demand per design", () => {
    const d = calculateDemandByDesign([
      order([boylston({ quantity: 1 })]),
      order([newbury({ quantity: 2 })]),
    ]);
    expect(d.get("d_boylston")!.totalCanvasesNeeded).toBe(1);
    expect(d.get("d_newbury")!.totalCanvasesNeeded).toBe(2);
  });

  it("counts no kit demand for a canvas-only sale of a pooled design", () => {
    const d = calculateDemandByDesign([order([boylston({ quantity: 2, needsKit: false })])]);
    expect(d.get("d_boylston")!.totalKitsNeeded).toBe(0);
    expect(d.get("d_boylston")!.totalCanvasesNeeded).toBe(2);
  });

  it("leaves an unpooled design counting only itself", () => {
    const d = calculateDemandByDesign([
      order([item({ designId: "d_lobster", quantity: 4 })]),
      order([boylston({ quantity: 1 })]),
    ]);
    expect(d.get("d_lobster")!.totalKitsNeeded).toBe(4);
  });

  it("drops skipped and deducted orders from the demand", () => {
    const d = calculateDemandByDesign([
      order([boylston({ quantity: 9 })], { excludedAt: "2026-11-01T00:00:00Z" }),
      order([boylston({ quantity: 9 })], { locallyFulfilled: true }),
      order([newbury({ quantity: 2 })]),
    ]);
    expect(d.get("d_newbury")!.totalKitsNeeded).toBe(2);
    expect(d.has("d_boylston")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  canvasPullList,
  kitPullList,
  groupKitRowsByFolder,
  supplyPullList,
  otherPullList,
  type PullItem,
  type PullOrder,
} from "./order-pull-list";

/**
 * The live Street Sign - Large pool: Boylston and Newbury share three bags.
 *
 * The bug these tests exist for: all three lists iterated EVERY order, so
 * unticking the 20-unit wholesale order dropped it from the headline counts
 * (computed server-side, which did filter) and left its canvases and kits on
 * the lists she pulls against.
 */
const POOL = "kg_large";

function item(over: Partial<PullItem> = {}): PullItem {
  return {
    itemType: "canvas",
    quantity: 1,
    needsKit: true,
    designId: "d_boylston",
    designName: "Boylston St",
    productTitle: "Boylston St",
    variantTitle: "8x8 / Yes",
    productType: "Canvas",
    previewImageUrl: null,
    kitsReady: 0,
    kitGroupId: null,
    kitPool: null,
    canvasPrinted: 10,
    folderId: "f_signs",
    folderName: "Street Signs",
    totalSold: 4,
    supplyId: null,
    supplyName: null,
    supplyQuantity: 0,
    ...over,
  };
}

const pooled = { kitGroupId: POOL, kitsReady: 3, kitPool: { name: "Street Sign - Large", members: 2, contents: "2 x 909" } };
const boylston = (over: Partial<PullItem> = {}) => item({ ...pooled, ...over });
const newbury = (over: Partial<PullItem> = {}) =>
  item({ ...pooled, designId: "d_newbury", designName: "Newbury Street", productTitle: "Newbury Street", ...over });

let seq = 0;
function order(items: PullItem[], over: Partial<PullOrder> = {}): PullOrder {
  seq += 1;
  return { orderNumber: `#${seq}`, locallyFulfilled: false, excludedAt: null, items, ...over };
}

const SKIPPED = { excludedAt: "2026-11-16T00:00:00Z" };
const DEDUCTED = { locallyFulfilled: true };

describe("canvasPullList", () => {
  it("leaves out an order ticked 'not today'", () => {
    // The user-reported bug: unticking the wholesale order left its canvases on
    // the list. 20 units of demand she is not packing.
    const rows = canvasPullList([
      order([boylston({ quantity: 1 })]),
      order([boylston({ quantity: 20 })], SKIPPED),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(1);
  });

  it("leaves out an order already deducted", () => {
    const rows = canvasPullList([order([boylston({ quantity: 5 })], DEDUCTED)]);
    expect(rows).toEqual([]);
  });

  it("drops the design entirely when every order for it is off the list", () => {
    const rows = canvasPullList([
      order([boylston({ quantity: 3 })], SKIPPED),
      order([newbury({ quantity: 2 })]),
    ]);
    expect(rows.map((r) => r.designId)).toEqual(["d_newbury"]);
  });

  it("totals one design across orders and across lines in an order", () => {
    const rows = canvasPullList([
      order([boylston({ quantity: 2 }), boylston({ quantity: 1, needsKit: false })]),
      order([boylston({ quantity: 3 })]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(6);
    expect(rows[0].kitsNeeded).toBe(5);
  });

  it("keeps pooled designs as separate rows — canvases are not interchangeable", () => {
    const rows = canvasPullList([order([boylston(), newbury()])]);
    expect(rows.map((r) => r.designName).sort()).toEqual(["Boylston St", "Newbury Street"]);
  });

  it("sorts most-needed first", () => {
    const rows = canvasPullList([order([boylston({ quantity: 1 }), newbury({ quantity: 4 })])]);
    expect(rows.map((r) => r.quantity)).toEqual([4, 1]);
  });

  it("keeps an unmatched product, keyed by its title", () => {
    const rows = canvasPullList([order([item({ designId: null, designName: null, productTitle: "Brand New Thing" })])]);
    expect(rows[0].productTitle).toBe("Brand New Thing");
  });

  it("ignores supply and bundle lines", () => {
    const rows = canvasPullList([order([
      item({ itemType: "supply", supplyId: "s1", designId: null }),
      item({ itemType: "bundle", designId: null }),
    ])]);
    expect(rows).toEqual([]);
  });
});

describe("kitPullList", () => {
  it("leaves out an order ticked 'not today'", () => {
    const rows = kitPullList([
      order([boylston({ quantity: 1 })]),
      order([newbury({ quantity: 20 })], SKIPPED),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].designName).toBe("Boylston St");
    // ...and the skipped order's bags must not inflate the pool's demand either.
    expect(rows[0].bagsNeeded).toBe(1);
  });

  it("leaves out an order already deducted", () => {
    expect(kitPullList([order([boylston()], DEDUCTED)])).toEqual([]);
  });

  it("keeps one row per design but reports the pool's total demand on each", () => {
    const rows = kitPullList([order([boylston({ quantity: 1 }), newbury({ quantity: 1 })])]);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.quantity).toBe(1);        // this design's own bags
      expect(r.bagsNeeded).toBe(2);      // what the pool owes in total
      expect(r.kitsReady).toBe(3);       // the whole pool on hand
      expect(r.sharedWith.sort()).toEqual(["Boylston St", "Newbury Street"]);
    }
  });

  it("catches a pool-wide shortage that per-design maths would miss", () => {
    // 2 + 2 bags from a pool of 3. Per design each row reads 3 >= 2 and looks
    // fine; pool-wide they are one short.
    const rows = kitPullList([order([boylston({ quantity: 2 }), newbury({ quantity: 2 })])]);
    for (const r of rows) {
      expect(r.bagsNeeded).toBe(4);
      expect(r.kitsReady < r.bagsNeeded).toBe(true);
    }
  });

  it("does not let an unpooled design borrow another's demand", () => {
    const rows = kitPullList([order([
      boylston({ quantity: 1 }),
      item({ designId: "d_lobster", designName: "Lobster", kitsReady: 9, quantity: 4 }),
    ])]);
    const lobster = rows.find((r) => r.designId === "d_lobster")!;
    expect(lobster.bagsNeeded).toBe(4);
    expect(lobster.poolKey).toBeNull();
    expect(lobster.sharedWith).toEqual([]);
  });

  it("counts the pool total across orders, not just within one", () => {
    const rows = kitPullList([
      order([boylston({ quantity: 2 })]),
      order([newbury({ quantity: 2 })]),
    ]);
    for (const r of rows) expect(r.bagsNeeded).toBe(4);
  });

  it("ignores a canvas-only line of a pooled design", () => {
    const rows = kitPullList([order([boylston({ quantity: 2, needsKit: false })])]);
    expect(rows).toEqual([]);
  });
});

describe("groupKitRowsByFolder", () => {
  it("sorts folders alphabetically with uncategorized last, rows by quantity", () => {
    const rows = kitPullList([order([
      item({ designId: "d_a", designName: "A", folderId: "f_z", folderName: "Zebra", quantity: 1 }),
      item({ designId: "d_b", designName: "B", folderId: "f_a", folderName: "Apple", quantity: 2 }),
      item({ designId: "d_c", designName: "C", folderId: "f_a", folderName: "Apple", quantity: 7 }),
      item({ designId: "d_d", designName: "D", folderId: null, folderName: null, quantity: 9 }),
    ])]);
    const grouped = groupKitRowsByFolder(rows);
    expect(grouped.map(([, g]) => g[0].folderName)).toEqual(["Apple", "Zebra", null]);
    expect(grouped[0][1].map((r) => r.quantity)).toEqual([7, 2]);
    expect(grouped[2][0]).toBe("__uncategorized__");
  });
});

describe("supplyPullList", () => {
  const minder = (over: Partial<PullItem> = {}) =>
    item({ itemType: "supply", designId: null, designName: null, needsKit: false,
      productTitle: "Needle Minder", supplyId: "s_lemon", supplyName: "Lemon Needle Minder",
      supplyQuantity: 91, variantTitle: "Lemon", productType: "Accessory", ...over });

  it("leaves out an order ticked 'not today'", () => {
    const rows = supplyPullList([order([minder({ quantity: 1 })]), order([minder({ quantity: 50 })], SKIPPED)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(1);
  });

  it("leaves out an order already deducted", () => {
    expect(supplyPullList([order([minder()], DEDUCTED)])).toEqual([]);
  });

  it("names the row after the matched supply, not the shared line-item title", () => {
    // Both arrive as "Needle Minder" with the colour in the variant. Titled by
    // the line item these were two rows both reading "Needle Minder".
    const rows = supplyPullList([order([
      minder({ quantity: 1 }),
      minder({ supplyId: "s_duck", supplyName: "Rubber Duck Needle Minder", variantTitle: "Rubber Duck", quantity: 2 }),
    ])]);
    expect(rows.map((r) => r.name)).toEqual(["Rubber Duck Needle Minder", "Lemon Needle Minder"]);
  });

  it("totals one supply across orders and tallies its variants", () => {
    const rows = supplyPullList([
      order([minder({ quantity: 2 })]),
      order([minder({ quantity: 3 })]),
    ]);
    expect(rows[0].quantity).toBe(5);
    expect([...rows[0].variants]).toEqual([["Lemon", 5]]);
    expect(rows[0].inStock).toBe(91);
  });

  it("keeps a variant that also appears in the product name", () => {
    // Dropping those hid Silver/Gold on "Silver/Gold Embroidery Scissors".
    const rows = supplyPullList([order([minder({
      productTitle: "Silver/Gold Embroidery Scissors", supplyName: "Silver/Gold Embroidery Scissors",
      supplyId: "s_scissors", variantTitle: "Silver", quantity: 1,
    })])]);
    expect([...rows[0].variants]).toEqual([["Silver", 1]]);
  });

  it("ignores Shopify's single-variant placeholder", () => {
    const rows = supplyPullList([order([minder({ variantTitle: "Default Title" })])]);
    expect(rows[0].variants.size).toBe(0);
  });

  it("keeps an unmatched supply line, keyed and named by its title", () => {
    const rows = supplyPullList([order([minder({ supplyId: null, supplyName: null, productTitle: "Mystery Widget" })])]);
    expect(rows[0].supplyId).toBeNull();
    expect(rows[0].name).toBe("Mystery Widget");
  });

  it("ignores canvas lines", () => {
    expect(supplyPullList([order([boylston()])])).toEqual([]);
  });
});

describe("otherPullList", () => {
  const cls = (over: Partial<PullItem> = {}) =>
    item({
      itemType: "other",
      productTitle: "Private Class",
      variantTitle: null,
      designId: null,
      designName: null,
      needsKit: false,
      ...over,
    });

  it("lists a service with the order it was created for", () => {
    const rows = otherPullList([order([cls({ quantity: 1 })], { orderNumber: "#4360" })]);
    expect(rows).toEqual([
      { productTitle: "Private Class", variantTitle: null, quantity: 1, orderNumbers: ["#4360"] },
    ]);
  });

  it("groups the same one-off across orders and keeps both numbers", () => {
    const rows = otherPullList([
      order([cls({ quantity: 1 })], { orderNumber: "#4360" }),
      order([cls({ quantity: 2 })], { orderNumber: "#4361" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(3);
    expect(rows[0].orderNumbers).toEqual(["#4360", "#4361"]);
  });

  it("keeps different variants apart", () => {
    const rows = otherPullList([
      order([
        cls({ productTitle: "Gift Card", variantTitle: "$50.00" }),
        cls({ productTitle: "Gift Card", variantTitle: "$100.00" }),
      ]),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("leaves out an order ticked 'not today', like every other tab", () => {
    expect(otherPullList([order([cls()], SKIPPED)])).toEqual([]);
  });

  it("leaves out an order already deducted", () => {
    expect(otherPullList([order([cls()], DEDUCTED)])).toEqual([]);
  });

  it("ignores canvas and supply lines", () => {
    const rows = otherPullList([
      order([boylston(), item({ itemType: "supply", supplyId: "s1", supplyName: "Seam Ripper" })]),
    ]);
    expect(rows).toEqual([]);
  });

  it("keeps a service off the canvas and supply lists", () => {
    // The whole point: before this existed, an unmatched title defaulted to
    // "canvas" and a private class became something to go and fetch.
    const orders = [order([cls({ quantity: 1 })])];
    expect(canvasPullList(orders)).toEqual([]);
    expect(supplyPullList(orders)).toEqual([]);
    expect(kitPullList(orders)).toEqual([]);
  });
});

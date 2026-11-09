import { describe, it, expect } from "vitest";
import {
  classifyOrderKind,
  countsAsRetailDemand,
  isDraftOriginatedSource,
  kindFromTags,
  toOrderKind,
} from "./order-kind";

describe("spotting a draft-originated order", () => {
  it("recognises Shopify's source for a completed draft", () => {
    expect(isDraftOriginatedSource("shopify_draft_order")).toBe(true);
    expect(isDraftOriginatedSource("SHOPIFY_DRAFT_ORDER")).toBe(true);
    expect(isDraftOriginatedSource(" shopify_draft_order ")).toBe(true);
  });

  it("leaves every other source alone", () => {
    // All of these are live in the store today.
    for (const src of ["web", "pos", "tiktok", "3890849", "2329312", null, undefined]) {
      expect(isDraftOriginatedSource(src)).toBe(false);
    }
  });
});

describe("reading a kind off Shopify tags", () => {
  it("matches a tag that names a kind", () => {
    expect(kindFromTags(["wholesale"])).toBe("wholesale");
    expect(kindFromTags(["Donation"])).toBe("donation");
    expect(kindFromTags(["Replacement"])).toBe("replacement");
  });

  it("accepts the synonyms the owners actually write", () => {
    expect(kindFromTags(["trade"])).toBe("wholesale");
    expect(kindFromTags(["comp"])).toBe("donation");
    expect(kindFromTags(["giveaway"])).toBe("donation");
    expect(kindFromTags(["damaged"])).toBe("replacement");
    expect(kindFromTags(["re-print"])).toBe("replacement");
  });

  it("honours an explicit kind: prefix", () => {
    expect(kindFromTags(["kind:wholesale"])).toBe("wholesale");
    expect(kindFromTags(["order-kind: donation"])).toBe("donation");
    expect(kindFromTags(["Kind: Damaged"])).toBe("replacement");
  });

  it("ignores the app-written tags already on live orders", () => {
    // These are the real tags across the latest 250 orders. None of them means
    // anything about why the order exists, and a substring match on "comp"
    // would have caught "Shop Cash offers acquired" via "acquired"… which is
    // exactly why matching is whole-tag only.
    expect(
      kindFromTags([
        "Stitch Email Sent",
        "All customers",
        "Grow sales - test",
        "Shop Cash offers acquired",
        "Shipped by Seller",
        "Buyer:Eleni",
        "TikTokOrderID:577658702877594297",
      ])
    ).toBeNull();
  });

  it("does not read a kind from gift or free", () => {
    // A gift-wrap or discount app can apply either to an ordinary sale.
    expect(kindFromTags(["gift"])).toBeNull();
    expect(kindFromTags(["free"])).toBeNull();
  });

  it("takes the first tag that says something", () => {
    expect(kindFromTags(["Stitch Email Sent", "wholesale"])).toBe("wholesale");
  });

  it("copes with no tags at all", () => {
    expect(kindFromTags([])).toBeNull();
    expect(kindFromTags(null)).toBeNull();
    expect(kindFromTags(undefined)).toBeNull();
  });
});

describe("classifying an order", () => {
  it("calls an ordinary web sale retail", () => {
    expect(classifyOrderKind({ sourceName: "web", tags: [], totalAmount: "64.00" })).toBe("retail");
  });

  it("calls a POS sale retail", () => {
    expect(classifyOrderKind({ sourceName: "pos", tags: [], totalAmount: "48.00" })).toBe("retail");
  });

  it("treats a hand-built $0 draft order as a giveaway, not a sale", () => {
    // Orders #3617, #3675, #3803, #3805, #3892, #3934, #4112, #4148 and #4174:
    // all PAID, all FULFILLED, all $0, all built by hand. Every one of them was
    // dropped before this and deducted nothing.
    expect(classifyOrderKind({ sourceName: "shopify_draft_order", tags: [], totalAmount: "0.0" })).toBe("donation");
    expect(classifyOrderKind({ sourceName: "shopify_draft_order", tags: [], totalAmount: 0 })).toBe("donation");
  });

  it("leaves a draft order at a real price as retail", () => {
    // Order #3775: a $70 Martini typed up by hand. A phone order is still a sale.
    expect(classifyOrderKind({ sourceName: "shopify_draft_order", tags: [], totalAmount: "70.0" })).toBe("retail");
  });

  it("lets a tag override the price guess in both directions", () => {
    expect(
      classifyOrderKind({ sourceName: "shopify_draft_order", tags: ["damaged"], totalAmount: "0.0" })
    ).toBe("replacement");
    // A wholesale order is charged for, so only the tag can tell us.
    expect(
      classifyOrderKind({ sourceName: "shopify_draft_order", tags: ["wholesale"], totalAmount: "840.00" })
    ).toBe("wholesale");
    // And a tag wins even on a plain web order.
    expect(classifyOrderKind({ sourceName: "web", tags: ["kind:donation"], totalAmount: "64.00" })).toBe("donation");
  });

  it("does not guess when the total is unknown", () => {
    expect(classifyOrderKind({ sourceName: "shopify_draft_order", tags: [] })).toBe("retail");
    expect(classifyOrderKind({ sourceName: "shopify_draft_order", tags: [], totalAmount: null })).toBe("retail");
  });

  it("does not guess from a $0 web order", () => {
    // A $0 web total means refunded-to-zero, which isIgnorableOrder drops.
    expect(classifyOrderKind({ sourceName: "web", tags: [], totalAmount: "0.00" })).toBe("retail");
  });
});

describe("what counts as demand", () => {
  it("counts retail and nothing else", () => {
    expect(countsAsRetailDemand("retail")).toBe(true);
    expect(countsAsRetailDemand("wholesale")).toBe(false);
    expect(countsAsRetailDemand("donation")).toBe(false);
    expect(countsAsRetailDemand("replacement")).toBe(false);
  });

  it("treats a missing or unrecognised kind as retail", () => {
    // The column defaults to "retail", so every pre-existing order keeps
    // counting exactly as it did before this change.
    expect(countsAsRetailDemand(null)).toBe(true);
    expect(countsAsRetailDemand(undefined)).toBe(true);
    expect(countsAsRetailDemand("something-else")).toBe(true);
    expect(toOrderKind("nonsense")).toBe("retail");
  });
});

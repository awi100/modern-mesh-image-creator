import { describe, it, expect } from "vitest";
import { resolveSupply, supplyNameMap } from "./supply-match";

// The live bag rows as they stand: three colourways whose names still carry
// the "NEW!" Shopify has since dropped, the large bag, and the retired 2026
// row that caused the shadowing.
const SUPPLIES = [
  { name: "Navy Dashes NEW! Project Bag", stock: 245 },
  { name: "Green Gingham NEW! Project Bag", stock: 242 },
  { name: "Burgundy Polka Dots NEW! Project Bag", stock: 245 },
  { name: "NEW! Large Project Bag", stock: 244 },
  { name: "Project Bag", stock: 0 },
  { name: "Navy Super Snip Scissors", stock: 190 },
];
const resolve = (pt: string, vt: string | null) =>
  resolveSupply(pt, vt, SUPPLIES, supplyNameMap(SUPPLIES));

describe("resolveSupply", () => {
  it("prefers the variant match over a product title that collides with a dead row", () => {
    // The bug: Shopify renamed "NEW! Project Bag" to "Project Bag", which is
    // the exact name of the retired row holding 0. Resolving by title first
    // reported 0 stock for a bag with 245 on the shelf.
    expect(resolve("Project Bag", "Navy Dashes")?.name).toBe("Navy Dashes NEW! Project Bag");
    expect(resolve("Project Bag", "Green Gingham")?.name).toBe("Green Gingham NEW! Project Bag");
    expect(resolve("Project Bag", "Burgundy Polka Dots")?.name).toBe("Burgundy Polka Dots NEW! Project Bag");
  });

  it("never resolves a variant-bearing bag line to the retired row", () => {
    for (const variant of ["Navy Dashes", "Green Gingham", "Burgundy Polka Dots"]) {
      expect(resolve("Project Bag", variant)?.stock).toBeGreaterThan(0);
    }
  });

  it("still matches on the variant when the supply name keeps a word Shopify dropped", () => {
    // The supply rows say "NEW!", the product no longer does. The variant
    // matcher is substring-based, so renaming them is cosmetic, not required.
    expect(resolve("Project Bag", "Navy Dashes")?.name).toContain("NEW!");
  });

  it("falls back to the product title when there is no variant", () => {
    expect(resolve("Project Bag", null)?.name).toBe("Project Bag");
    expect(resolve("Navy Super Snip Scissors", null)?.name).toBe("Navy Super Snip Scissors");
  });

  it("ignores Shopify's placeholder variant and uses the title", () => {
    expect(resolve("Navy Super Snip Scissors", "Default Title")?.name).toBe("Navy Super Snip Scissors");
  });

  it("returns null when a renamed product matches no row at all", () => {
    // The large bag after the rename: the supply is still "NEW! Large Project
    // Bag", the product is "Large Project Bag", and "Default Title" gives the
    // variant matcher nothing to work with. This is why the supply row has to
    // be renamed — no precedence rule can rescue it.
    const orphan = SUPPLIES.filter((s) => s.name !== "NEW! Large Project Bag");
    expect(resolveSupply("Large Project Bag", "Default Title", orphan, supplyNameMap(orphan))).toBeNull();
  });

  it("resolves the large bag once the supply row is renamed to match", () => {
    const renamed = SUPPLIES.map((s) =>
      s.name === "NEW! Large Project Bag" ? { ...s, name: "Large Project Bag" } : s,
    );
    expect(resolveSupply("Large Project Bag", "Default Title", renamed, supplyNameMap(renamed))?.stock).toBe(244);
  });

  it("returns null for a product that is not a supply", () => {
    expect(resolve("Citgo Sign", "8x8 / Yes")).toBeNull();
  });

  it("does not let a canvas variant drag in an unrelated supply", () => {
    // Canvas lines carry variants like "8x8 / Yes". Those must not partial
    // match a supply just because both mention a size or a colour word.
    expect(resolve("Navy Blazer Canvas", "Navy / Yes")).toBeNull();
  });
});

describe("supplyNameMap", () => {
  it("keys on the normalized name", () => {
    expect(supplyNameMap(SUPPLIES).get("project bag")?.stock).toBe(0);
  });
});

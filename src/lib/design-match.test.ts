import { describe, it, expect } from "vitest";
import { designNameIndex, resolveDesign } from "./design-match";

/**
 * The live intro-kit designs, including the zero-stock decoys that make an
 * exact match mandatory. Keep the decoys: they are the reason this module does
 * not do substring matching, and a test without them would pass either way.
 */
const DESIGNS = [
  { id: "horseshoe", name: "Horseshoe Intro Kit" },
  { id: "horseshoe14", name: "Horseshoe Intro Kit (14)" },
  { id: "horseshoePrint", name: "Horseshoe Intro Kit (Print)" },
  { id: "heart", name: "Heart Intro Kit" },
  { id: "heart14", name: "Heart Intro Kit (14)" },
  { id: "heartPrint13", name: "Heart Intro Kit (13ct) (Print)" },
  { id: "shamrock", name: "Shamrock Intro Kit" },
  { id: "whale", name: "Whale Intro Kit" },
  { id: "pawPrint", name: "Paw Print Intro Kit" },
  { id: "duck", name: "Duck Intro Kit" },
  { id: "palmTree", name: "Palm Tree Intro Kit" },
  { id: "pretzel", name: "Pretzel Intro Kit" },
  { id: "lightning", name: "Lightning Intro Kit" },
  { id: "nevsE", name: "New England vs Everyone" },
  { id: "heartMatchbox", name: "Heart Matchbox" },
];

const index = designNameIndex(DESIGNS);
const resolve = (title: string, variant: string | null) => resolveDesign(title, variant, index);

describe("resolveDesign", () => {
  it("resolves the Starter Bundle's canvas component from its variant", () => {
    // order #4346: Shopify explodes the bundle and titles this line by option.
    expect(resolve("Intro Kit", "Horseshoe")?.id).toBe("horseshoe");
  });

  it("resolves every Intro Kit option the Starter Bundle offers", () => {
    const expected: [string, string][] = [
      ["Shamrock", "shamrock"],
      ["Horseshoe", "horseshoe"],
      ["Whale", "whale"],
      ["Heart", "heart"],
      ["Paw Print", "pawPrint"],
      ["Duck", "duck"],
      ["Palm Tree", "palmTree"],
      ["Pretzel", "pretzel"],
      ["Lightning", "lightning"],
    ];
    for (const [variant, id] of expected) {
      expect(resolve("Intro Kit", variant)?.id, variant).toBe(id);
    }
  });

  it("picks the live design, never a (14) or (Print) decoy", () => {
    // Substring matching would make these ambiguous and deduct from a print
    // version holding 0 canvases and 0 kits.
    expect(resolve("Intro Kit", "Horseshoe")?.name).toBe("Horseshoe Intro Kit");
    expect(resolve("Intro Kit", "Heart")?.name).toBe("Heart Intro Kit");
  });

  it("still matches a normal product by title alone", () => {
    expect(resolve("Heart Intro Kit", null)?.id).toBe("heart");
    expect(resolve("New England vs Everyone", "Yes")?.id).toBe("nevsE");
    expect(resolve("Horseshoe Intro Kit", "No")?.id).toBe("horseshoe");
  });

  it("does not let a kit yes/no variant invent a match", () => {
    expect(resolve("Not A Real Product", "Yes")).toBeNull();
    expect(resolve("Intro Kit", "Yes")).toBeNull();
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(resolve("Intro Kit", "Unicorn")).toBeNull();
    expect(resolve("Intro Kit", null)).toBeNull();
    expect(resolve("Needle Minder", "Pearl Shell")).toBeNull();
  });

  it("tries each token of a multi-option variant", () => {
    // If the bundle is ever sold as one line item instead of components.
    expect(resolve("Intro Kit", "Horseshoe / Pearl Shell / Green Gingham")?.id).toBe("horseshoe");
    expect(resolve("Intro Kit", "Gold / Heart / Navy Dashes")?.id).toBe("heart");
  });

  it("ignores punctuation and spacing differences", () => {
    expect(resolve("IntroKit", "Paw-Print")?.id).toBe("pawPrint");
  });

  it("refuses an ambiguous squashed name instead of picking one", () => {
    const dupes = designNameIndex([
      { id: "a", name: "Pink-Jeep Kit" },
      { id: "b", name: "Pink.Jeep Kit" },
    ]);
    // No exact "pink jeep kit" exists, and both squash to "pinkjeepkit", so
    // the variant pass has two candidates and must resolve neither.
    expect(resolveDesign("Kit", "Pink Jeep", dupes)).toBeNull();
    // The exact-name map is untouched and still works.
    expect(resolveDesign("Pink-Jeep Kit", null, dupes)?.id).toBe("a");
  });

  it("uses the squashed map when only one design can claim it", () => {
    const one = designNameIndex([{ id: "a", name: "Pink-Jeep Kit" }]);
    expect(resolveDesign("Kit", "Pink Jeep", one)?.id).toBe("a");
  });

  it("prefers the variant match over a bare title that also matches", () => {
    const idx = designNameIndex([
      { id: "plain", name: "Intro Kit" },
      { id: "horseshoe", name: "Horseshoe Intro Kit" },
    ]);
    expect(resolveDesign("Intro Kit", "Horseshoe", idx)?.id).toBe("horseshoe");
    expect(resolveDesign("Intro Kit", null, idx)?.id).toBe("plain");
  });
});

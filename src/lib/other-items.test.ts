import { describe, it, expect } from "vitest";
import { isOtherItemTitle, OTHER_ITEM_TITLES } from "./other-items";

describe("isOtherItemTitle", () => {
  it("recognises a private class", () => {
    expect(isOtherItemTitle("Private Class")).toBe(true);
  });

  it("matches on prefix so a suffixed one-off needs no code change", () => {
    expect(isOtherItemTitle("Private Class (2 hours)")).toBe(true);
    expect(isOtherItemTitle("Private Class - Beacon Hill")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isOtherItemTitle("  private CLASS  ")).toBe(true);
  });

  it("covers the live shipping top-up that was counted as a canvas", () => {
    // Order #4242, 14 Nov 2026.
    expect(isOtherItemTitle("Update Shipping")).toBe(true);
  });

  it("covers gift cards under either title", () => {
    expect(isOtherItemTitle("Modern Mesh Digital Gift Card")).toBe(true);
    expect(isOtherItemTitle("Gift Card")).toBe(true);
  });

  it("leaves a real product alone", () => {
    expect(isOtherItemTitle("Horseshoe Intro Kit")).toBe(false);
    expect(isOtherItemTitle("Green Self-Finishing Ornament")).toBe(false);
    expect(isOtherItemTitle("Project Bag")).toBe(false);
    expect(isOtherItemTitle("Fenway Frank")).toBe(false);
  });

  it("does not match a title that merely contains a listed word", () => {
    // Prefix, not substring: a design could legitimately be called this.
    expect(isOtherItemTitle("Needlepoint Class Sampler")).toBe(false);
    expect(isOtherItemTitle("Shipping Tag Canvas")).toBe(false);
  });

  it("handles null and empty titles", () => {
    expect(isOtherItemTitle(null)).toBe(false);
    expect(isOtherItemTitle(undefined)).toBe(false);
    expect(isOtherItemTitle("")).toBe(false);
  });

  it("keeps the list non-empty and free of blank entries", () => {
    // A blank entry would prefix-match every title and empty the pick list.
    expect(OTHER_ITEM_TITLES.length).toBeGreaterThan(0);
    for (const t of OTHER_ITEM_TITLES) expect(t.trim()).not.toBe("");
  });
});

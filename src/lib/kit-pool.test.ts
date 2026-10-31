import { describe, it, expect } from "vitest";
import { kitStockOf, totalKitStock, KIT_FIELDS } from "./kit-pool";

const loose = (home: number, market: number, andover: number) => ({
  kitsReady: home, marketKitsReady: market, kitsAndover: andover,
  kitGroupId: null, kitGroup: null,
});

const signs = {
  id: "g1", name: "Green Street Signs", contents: "2x909, 1xBLANC, 1x310 bobbin",
  kitsReady: 11, marketKitsReady: 4, kitsAndover: 0,
  _count: { designs: 5 },
};
const member = () => ({
  // A member's own columns are held at 0 on purpose.
  kitsReady: 0, marketKitsReady: 0, kitsAndover: 0,
  kitGroupId: "g1", kitGroup: signs,
});

describe("reading kit stock", () => {
  it("reads a design's own columns when it is in no group", () => {
    const s = kitStockOf(loose(3, 2, 7));
    expect(s).toMatchObject({ home: 3, market: 2, andover: 7, total: 12, shared: false, memberCount: 1 });
  });

  it("reads the pool for a grouped design, not its zeroed columns", () => {
    const s = kitStockOf(member());
    expect(s.home).toBe(11);
    expect(s.market).toBe(4);
    expect(s.total).toBe(15);
    expect(s.shared).toBe(true);
    expect(s.groupName).toBe("Green Street Signs");
    expect(s.memberCount).toBe(5);
  });

  it("gives each member the WHOLE pool, not a share of it", () => {
    // Any one of the five can use any bag, so dividing by five would make all
    // five look short while the shelf is full.
    expect(kitStockOf(member()).home).toBe(11);
    expect(kitStockOf(member()).home).not.toBe(11 / 5);
  });

  it("falls back to the design's columns if the group was not joined in", () => {
    // A query that forgot KIT_GROUP_INCLUDE must not report a member's zeroed
    // columns as a pool it knows nothing about.
    const s = kitStockOf({ kitsReady: 0, marketKitsReady: 0, kitsAndover: 0, kitGroupId: "g1" });
    expect(s.shared).toBe(false);
    expect(s.total).toBe(0);
  });
});

describe("totalling across designs", () => {
  it("counts a shared pool once, not once per member", () => {
    const all = [member(), member(), member(), member(), member()];
    const t = totalKitStock(all);
    expect(t.home).toBe(11); // not 55
    expect(t.market).toBe(4);
    expect(t.total).toBe(15);
  });

  it("adds ungrouped designs to the pool without double counting", () => {
    const t = totalKitStock([member(), member(), loose(6, 1, 0), loose(2, 0, 3)]);
    expect(t.home).toBe(11 + 6 + 2);
    expect(t.market).toBe(4 + 1);
    expect(t.andover).toBe(0 + 0 + 3);
  });

  it("keeps two different pools separate", () => {
    const other = {
      kitsReady: 0, marketKitsReady: 0, kitsAndover: 0, kitGroupId: "g2",
      kitGroup: { id: "g2", name: "Other", kitsReady: 5, marketKitsReady: 0, kitsAndover: 0, _count: { designs: 2 } },
    };
    expect(totalKitStock([member(), member(), other, other]).home).toBe(16);
  });

  it("is zero for an empty list", () => {
    expect(totalKitStock([])).toEqual({ home: 0, market: 0, andover: 0, total: 0 });
  });
});

describe("location fields", () => {
  it("names the three columns a location maps to", () => {
    expect(KIT_FIELDS).toEqual({ home: "kitsReady", market: "marketKitsReady", andover: "kitsAndover" });
  });
});

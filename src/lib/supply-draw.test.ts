import { describe, it, expect } from "vitest";
import { planSupplyRestore, type SupplyAuditRow } from "./supply-draw";

const row = (over: Partial<SupplyAuditRow> & { supplyId: string }): SupplyAuditRow => ({
  deducted: 0,
  fromAndover: 0,
  bucket: "online",
  ...over,
});

describe("planSupplyRestore", () => {
  it("puts back what was taken, not what was ordered", () => {
    // The order wanted 5 bags; only 3 existed anywhere. Restoring the line-item
    // quantity would invent 2 that never left the shelf.
    const plans = planSupplyRestore(
      new Map([["bag", 5]]),
      [row({ supplyId: "bag", deducted: 3 })],
      false,
    );
    expect(plans).toEqual([{ supplyId: "bag", toBucket: 3, toAndover: 0, toMarket: false }]);
  });

  it("credits an Andover draw back to Andover", () => {
    // 2 came off the tote, 4 fell through to Andover. Crediting all 6 to the
    // tote would move stock between two real places on paper.
    const plans = planSupplyRestore(
      new Map([["bag", 6]]),
      [row({ supplyId: "bag", deducted: 6, fromAndover: 4, bucket: "market" })],
      true,
    );
    expect(plans).toEqual([{ supplyId: "bag", toBucket: 2, toAndover: 4, toMarket: true }]);
  });

  it("restores to the bucket the row names, not today's channel", () => {
    // sourceName is overwritten on every fulfil POST, so a channel change
    // between fulfil and undo must not redirect the stock.
    const plans = planSupplyRestore(
      new Map([["bag", 3]]),
      [row({ supplyId: "bag", deducted: 3, bucket: "market" })],
      false, // isPos false now, but the draw came off the tote
    );
    expect(plans[0].toMarket).toBe(true);
  });

  it("gives nothing back for a supply with no row on an audited order", () => {
    // The zero-unit row is what makes this knowable: the order ran, this supply
    // had nothing to give, so there is nothing to return.
    const plans = planSupplyRestore(
      new Map([
        ["bag", 2],
        ["scissors", 1],
      ]),
      [row({ supplyId: "bag", deducted: 2 })],
      false,
    );
    expect(plans).toEqual([{ supplyId: "bag", toBucket: 2, toAndover: 0, toMarket: false }]);
  });

  it("drops a supply whose row says it deducted zero", () => {
    const plans = planSupplyRestore(
      new Map([["bag", 4]]),
      [row({ supplyId: "bag", deducted: 0 })],
      false,
    );
    expect(plans).toEqual([]);
  });

  it("falls back to line-item quantities when the order was never audited", () => {
    // Every order predating the SupplyDeduction table. This is the old
    // behaviour exactly, and it must stay unchanged.
    const plans = planSupplyRestore(new Map([["bag", 4]]), [], true);
    expect(plans).toEqual([{ supplyId: "bag", toBucket: 4, toAndover: 0, toMarket: true }]);
  });

  it("uses only the newest row per supply", () => {
    // fulfil -> undo -> fulfil leaves two sets of rows for one order. Summing
    // them would restore both fulfilments' worth.
    const plans = planSupplyRestore(
      new Map([["bag", 2]]),
      [row({ supplyId: "bag", deducted: 2 }), row({ supplyId: "bag", deducted: 2 })],
      false,
    );
    expect(plans).toEqual([{ supplyId: "bag", toBucket: 2, toAndover: 0, toMarket: false }]);
  });

  it("restores a supply that is no longer in the line-item expansion", () => {
    // A bundle whose components changed since the sale. What was taken is what
    // goes back; the current expansion is not evidence of anything.
    const plans = planSupplyRestore(
      new Map(),
      [row({ supplyId: "retired-bag", deducted: 3 })],
      false,
    );
    expect(plans).toEqual([{ supplyId: "retired-bag", toBucket: 3, toAndover: 0, toMarket: false }]);
  });

  it("never returns a negative restore", () => {
    const plans = planSupplyRestore(
      new Map([["bag", -2]]),
      [row({ supplyId: "other", deducted: -5 })],
      false,
    );
    expect(plans).toEqual([]);
  });

  it("clamps fromAndover to what was actually deducted", () => {
    // A corrupt row must not conjure Andover stock out of an undo.
    const plans = planSupplyRestore(
      new Map(),
      [row({ supplyId: "bag", deducted: 2, fromAndover: 9 })],
      false,
    );
    expect(plans).toEqual([{ supplyId: "bag", toBucket: 0, toAndover: 2, toMarket: false }]);
  });
});

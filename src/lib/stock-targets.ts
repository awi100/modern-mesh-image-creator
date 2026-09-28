// Single source of truth for restock thresholds.
//
// These numbers used to be redefined in four files (inventory page, restock,
// andover-pickup, tools hub) under three different names — they agreed only by
// luck. Import from here instead.
//
// "On hand" = Home + Market tote. Andover is bulk storage and is NOT on hand;
// you pick stock up from Andover to top on-hand back up.

export const LOW_ON_HAND = 20;
export const RESTOCK_TARGET = 30;

export type StockKind = "canvas" | "kit" | "supply";

/** Below this, a design is flagged low and wants a pickup from Andover. */
export const LOW_FOR: Record<StockKind, number | null> = {
  canvas: LOW_ON_HAND,
  kit: LOW_ON_HAND,
  // Supplies have no meaningful universal threshold — you might keep 3 project
  // bags at home and 200 at Andover. Flagging those "low" against a canvas
  // number is noise, so supplies are never auto-flagged.
  supply: null,
};

/** Pickups top on-hand up to this. `null` = no suggestion; the user types a qty. */
export const TARGET_FOR: Record<StockKind, number | null> = {
  canvas: RESTOCK_TARGET,
  kit: RESTOCK_TARGET,
  supply: null,
};

/**
 * Suggested pickup quantity: enough to reach the target, capped by what's
 * actually at Andover. Kinds with no target return 0 — the row still shows
 * (because there IS stock at Andover) but we don't invent a number.
 */
export function suggestPickup(kind: StockKind, andover: number, onHand: number): number {
  const target = TARGET_FOR[kind];
  if (target === null) return 0;
  return Math.min(andover, Math.max(0, target - onHand));
}

/** True when on-hand is low enough to be worth flagging for this kind. */
export function isLowOnHand(kind: StockKind, onHand: number): boolean {
  const low = LOW_FOR[kind];
  return low !== null && onHand < low;
}

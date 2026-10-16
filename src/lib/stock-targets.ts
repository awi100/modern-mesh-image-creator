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

/**
 * House default per kind. `null` = no suggestion; the user types a qty.
 *
 * A design may override the canvas/kit number with Design.restockTarget — pass
 * it to targetFor/suggestPickup/isLowOnHand below. Supplies have no per-item
 * override because they have no universal target to override.
 */
export const TARGET_FOR: Record<StockKind, number | null> = {
  canvas: RESTOCK_TARGET,
  kit: RESTOCK_TARGET,
  supply: null,
};

/**
 * The target that actually applies, honouring a design's own override.
 *
 * `override` is Design.restockTarget: null/undefined means "use the house
 * default", so most designs need no per-row data at all and changing
 * RESTOCK_TARGET still moves them. 0 is a real value (want none in Boston) and
 * is NOT treated as absent.
 */
export function targetFor(kind: StockKind, override?: number | null): number | null {
  if (kind === "supply") return TARGET_FOR.supply;
  return override ?? TARGET_FOR[kind];
}

/**
 * Suggested pickup quantity: enough to reach the target, capped by what's
 * actually at Andover. Kinds with no target return 0 — the row still shows
 * (because there IS stock at Andover) but we don't invent a number.
 */
export function suggestPickup(
  kind: StockKind,
  andover: number,
  onHand: number,
  override?: number | null,
): number {
  const target = targetFor(kind, override);
  if (target === null) return 0;
  return Math.min(andover, Math.max(0, target - onHand));
}

/**
 * True when on-hand is low enough to be worth flagging for this kind.
 *
 * A design with its own target is judged against that, scaled by the same
 * low:target ratio as the house numbers (20 of 30 = two thirds), so a design
 * that only wants 10 isn't permanently flagged for sitting at 12.
 */
export function isLowOnHand(kind: StockKind, onHand: number, override?: number | null): boolean {
  const low = LOW_FOR[kind];
  if (low === null) return false;
  const target = targetFor(kind, override);
  if (target === null || target === RESTOCK_TARGET) return onHand < low;
  return onHand < Math.round(target * (LOW_ON_HAND / RESTOCK_TARGET));
}

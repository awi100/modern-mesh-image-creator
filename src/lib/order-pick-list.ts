/**
 * Which orders count when you are standing at the shelf pulling stock.
 *
 * An order drops off the pick list for one of two reasons:
 *
 *  - it is **already deducted** (`locallyFulfilled`), so its canvases and kits
 *    have physically left and counting them again would double-pull; or
 *  - it is **deliberately skipped** (`excludedAt`) — a wholesale order waiting
 *    on a ship date, say. The units are still owed, but not today.
 *
 * Both exclusions have to be applied in the same two places or the page
 * contradicts itself, which is why this lives here instead of being written
 * inline each time:
 *
 *  1. **The demand totals.** Every item row reads `canvasPrinted/needed`, where
 *     `needed` is summed across every design in every open order. One 30-unit
 *     wholesale order turns that row red with "need 25" on designs there is
 *     plenty of — for every other order on the page, not just its own.
 *  2. **The fulfillable calculation**, which hands out inventory oldest-first.
 *     A skipped order left in the queue consumes stock before the orders behind
 *     it, so they report as unfulfillable against canvases that are sitting on
 *     the shelf.
 *
 * Skipping is local bookkeeping and says nothing about the order in Shopify.
 * Sync and fulfill both ignore `excludedAt`, so a skipped order that really
 * does ship is still recorded normally.
 */

/** The parts of an order that decide whether it is still to be pulled. */
export interface PickListOrder {
  locallyFulfilled: boolean;
  excludedAt: string | Date | null;
}

/** Has this order been deliberately left off the pick list? */
export function isSkipped(order: Pick<PickListOrder, "excludedAt">): boolean {
  return order.excludedAt != null;
}

/**
 * The orders still to be pulled: not yet deducted, and not skipped.
 *
 * Use this rather than filtering on `locallyFulfilled` alone — that was the
 * whole filter before skipping existed, so a bare `!o.locallyFulfilled` is the
 * shape of the bug this replaces.
 */
export function onPickList<T extends PickListOrder>(orders: readonly T[]): T[] {
  return orders.filter((o) => !o.locallyFulfilled && !isSkipped(o));
}

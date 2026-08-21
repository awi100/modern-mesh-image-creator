// Mystery Misprint Bag — a bundled product where 2 misprinted 14ct canvases
// (with matching kits) ship per bag. Internal team picks which designs go in
// each order before fulfillment so the right inventory gets deducted.

import { normalizeTitle } from "./shopify";

export const MYSTERY_BAG_TITLE = "Mystery Misprint Bag";

// Picks required per bag (2 canvases + 2 kits per bag).
export const PICKS_PER_BAG = 2;

const NORMALIZED_TITLE = normalizeTitle(MYSTERY_BAG_TITLE);

// Match on the base title as a prefix so Shopify suffixes still resolve — e.g.
// "Mystery Misprint Bag (NEW ENGLAND ONLY)" — without needing a code change
// each time the parenthetical is tweaked.
export function isMysteryBagTitle(productTitle: string | null | undefined): boolean {
  if (!productTitle) return false;
  return normalizeTitle(productTitle).startsWith(NORMALIZED_TITLE);
}

// Total picks needed for an order's mystery-bag line items.
// Sums quantities of every Mystery Bag line item and multiplies by PICKS_PER_BAG.
export function picksRequiredForItems(
  items: { productTitle: string; quantity: number }[]
): number {
  let bags = 0;
  for (const item of items) {
    if (isMysteryBagTitle(item.productTitle)) {
      bags += item.quantity;
    }
  }
  return bags * PICKS_PER_BAG;
}

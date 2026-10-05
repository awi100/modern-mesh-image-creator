// Mystery Misprint Bag — a bundled product. We no longer track which misprint
// designs go in a bag, so there is no pick flow and no inventory deduction for
// it; the only thing left is recognising the product so the Orders page can
// list those orders and show the customer's special instructions.

import { normalizeTitle } from "./shopify";

export const MYSTERY_BAG_TITLE = "Mystery Misprint Bag";

const NORMALIZED_TITLE = normalizeTitle(MYSTERY_BAG_TITLE);

// Match on the base title as a prefix so Shopify suffixes still resolve — e.g.
// "Mystery Misprint Bag (NEW ENGLAND ONLY)" — without needing a code change
// each time the parenthetical is tweaked.
export function isMysteryBagTitle(productTitle: string | null | undefined): boolean {
  if (!productTitle) return false;
  return normalizeTitle(productTitle).startsWith(NORMALIZED_TITLE);
}

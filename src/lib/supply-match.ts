/**
 * Which supply row a Shopify line item is actually asking for.
 *
 * A line item gives us a product title and (usually) a variant title. Two
 * matchers can resolve it, and the ORDER MATTERS:
 *
 *  1. `matchSupplyByVariant` — "<variant><product>", e.g. "Navy Dashes" +
 *     "Project Bag" -> the supply named "Navy Dashes NEW! Project Bag".
 *  2. the product title alone, looked up by normalized name.
 *
 * The variant match has to be tried FIRST, because it is strictly the more
 * specific of the two: it uses both halves of what Shopify told us, where the
 * name match throws the variant away. Whenever they disagree, the variant
 * match is the right answer by construction.
 *
 * This was the other way round until 18 Nov 2026, and the bug it caused is the
 * reason this is a documented function rather than one inline `??` chain.
 * "NEW! Project Bag" was renamed in Shopify to plain "Project Bag", which then
 * collided exactly with a long-dead supply row of the same name — the original
 * 2026 bag, retired, 0 in every location. The name match won, the variant was
 * never consulted, and every colourway reported 0 stock:
 *
 *     Project Bag [Navy Dashes]         -> "Project Bag"  0 + 0 + 0
 *     ...when the real row held            11 + 2 + 232
 *
 * She reads those numbers to decide what to pull off the shelf, so a false 0
 * is a bag that doesn't get packed. Checked against all 5,102 historical order
 * lines, flipping the precedence changes exactly one other combination, and
 * that one is also a correction ("Project Bag [Green]", 49 units, 0 ->
 * "Green Gingham NEW! Project Bag", 10).
 *
 * The rename also broke the large bag, which is a DIFFERENT failure and not
 * fixed here: "NEW! Large Project Bag" became "Large Project Bag" in Shopify
 * but the supply row kept its old name, and with no variant to match on
 * ("Default Title") BOTH matchers miss. The line then isn't a supply at all,
 * so it drops off the Supplies tab rather than showing a wrong number. No
 * precedence can fix a row nothing matches — the supply has to be renamed.
 * That is the failure mode to watch for whenever a Shopify product is renamed:
 * a variant-bearing product degrades to a wrong number, a bare one vanishes.
 */

import { matchSupplyByVariant, normalizeTitle } from "./shopify";

/** Supplies keyed by normalized name, for the product-title fallback. */
export function supplyNameMap<T extends { name: string }>(supplies: readonly T[]): Map<string, T> {
  const byName = new Map<string, T>();
  for (const supply of supplies) byName.set(normalizeTitle(supply.name), supply);
  return byName;
}

/**
 * The supply a line item refers to, or null if nothing matches.
 *
 * Variant match first, product-title match second. Pass the map from
 * `supplyNameMap` so it is built once per request rather than per line item.
 */
export function resolveSupply<T extends { name: string }>(
  productTitle: string,
  variantTitle: string | null | undefined,
  supplies: readonly T[],
  byName: Map<string, T>,
): T | null {
  return (
    matchSupplyByVariant(productTitle, variantTitle, supplies as T[]) ??
    byName.get(normalizeTitle(productTitle)) ??
    null
  );
}

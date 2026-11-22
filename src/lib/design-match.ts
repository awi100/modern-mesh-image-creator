/**
 * Which design a Shopify line item is actually asking for.
 *
 * The sibling of `supply-match.ts`, and it exists for the same reason: a line
 * item gives us a product title AND a variant, and matching on the title alone
 * throws half of that away.
 *
 * Designs were matched by title alone until 22 Nov 2026, which was fine while
 * every canvas was its own Shopify product ("Horseshoe Intro Kit", variant
 * "Yes"/"No" for the kit). The **Starter Bundle** broke that. Shopify does not
 * send a bundle as one line item — it explodes it into its components, and the
 * component carrying the canvas is titled by the OPTION, not the product:
 *
 *     order #4346, 22 Nov 2026
 *       "Intro Kit"                       [Horseshoe]        <- matched NOTHING
 *       "Needle Minder"                   [Pearl Shell]      -> supply, fine
 *       "Project Bag"                     [Green Gingham]    -> supply, fine
 *       "Silver/Gold Embroidery Scissors" [Gold]             -> supply, fine
 *       "Seam Ripper"                     [-]                -> supply, fine
 *
 * The four supply lines resolve because `resolveSupply` already consults the
 * variant. The canvas line did not, so a $75 bundle showed an "Intro Kit" row
 * connected to nothing: no canvas or kit on the picking list, and nothing
 * deducted from Horseshoe Intro Kit when the order was fulfilled. The design
 * it wants is `"<variant> <product title>"` — "Horseshoe" + "Intro Kit" ->
 * "Horseshoe Intro Kit" — and all nine Intro Kit option values resolve that way
 * (Shamrock, Horseshoe, Whale, Heart, Paw Print, Duck, Palm Tree, Pretzel,
 * Lightning).
 *
 * **The match is EXACT, never substring**, which is where this deliberately
 * parts company with `matchSupplyByVariant`. Design names are not unique the
 * way supply names are: "Heart Intro Kit" is shadowed by "Heart Intro Kit
 * (14)", "Heart Intro Kit (Print)" and "Heart Intro Kit (13ct) (Print)", all
 * live rows holding 0 canvases and 0 kits. A substring match would pick
 * whichever the database happened to return first and deduct from a print
 * version — the same class of bug as the retired "Project Bag" row, one step
 * worse because it is silent in both directions. If a title is ambiguous after
 * squashing, this resolves nothing and the line shows as unmatched, which is
 * the failure everyone can see.
 *
 * Replayed over all 5,185 historical order lines, adding the variant pass
 * changes **zero** existing matches: it only resolves lines that previously
 * matched nothing. It is purely additive by construction — the title lookup is
 * unchanged and still runs whenever the variant pass finds nothing.
 */

import { normalizeTitle } from "./shopify";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface DesignIndex<T> {
  byName: Map<string, T>;
  /** Punctuation/spacing-insensitive, with ambiguous keys deliberately dropped. */
  bySquashed: Map<string, T>;
}

/**
 * Build the lookup maps once per request rather than per line item.
 *
 * A squashed key shared by two designs is REMOVED rather than resolved to
 * either one. Duplicate names are common here ("Untitled Design (Print)" x61,
 * two "Après Ski"), and silently picking one would be a wrong deduction; the
 * exact-name map keeps its usual last-write-wins behaviour, unchanged.
 */
export function designNameIndex<T extends { name: string }>(designs: readonly T[]): DesignIndex<T> {
  const byName = new Map<string, T>();
  for (const d of designs) byName.set(normalizeTitle(d.name), d);

  const counts = new Map<string, number>();
  for (const d of designs) {
    const key = squash(d.name);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const bySquashed = new Map<string, T>();
  for (const d of designs) {
    const key = squash(d.name);
    if (key && counts.get(key) === 1) bySquashed.set(key, d);
  }

  return { byName, bySquashed };
}

/**
 * The design a line item refers to, or null if nothing matches.
 *
 * Variant pass first ("<variant> <product title>"), bare product title second.
 * A multi-option variant ("Horseshoe / Pearl Shell / Green Gingham") is tried
 * token by token, so this still works if the bundle is ever sold as a single
 * line item instead of exploded components.
 */
export function resolveDesign<T extends { name: string }>(
  productTitle: string,
  variantTitle: string | null | undefined,
  index: DesignIndex<T>,
): T | null {
  if (variantTitle) {
    for (const token of variantTitle.split("/").map((t) => t.trim()).filter(Boolean)) {
      const hit =
        index.byName.get(normalizeTitle(`${token} ${productTitle}`)) ??
        index.bySquashed.get(squash(`${token}${productTitle}`));
      if (hit) return hit;
    }
  }
  return index.byName.get(normalizeTitle(productTitle)) ?? null;
}

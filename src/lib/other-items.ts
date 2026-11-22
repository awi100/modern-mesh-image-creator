/**
 * Line items that are not a thing on a shelf.
 *
 * A private class, a gift card, a shipping top-up charged after the fact: all
 * of them are real money on a real order, and none of them is picked, packed
 * or counted. They are usually built by hand in the Shopify admin as a one-off.
 *
 * Without this list they land on the **Canvases** tab, because
 * `classifyItemType` defaults an unmatched product to "canvas" on the
 * reasonable theory that it is a new design nobody has added yet. That default
 * is right for a design and wrong for a service, and it is wrong in the
 * expensive direction: the Orders page is a picking list, so a $200 private
 * class reads as one canvas to go and fetch, and it also lands in the
 * "Products Not Matched to Designs" warning, which is where genuinely missing
 * designs are supposed to stand out. One live example was already doing this —
 * "Update Shipping" on order #4242, counted as a canvas since 14 Nov.
 *
 * So the list is deliberately an EXPLICIT allow-list, not a rule. Shopify does
 * know which variants are intangible (`requiresShipping: false`), and that was
 * considered, but a hand-built one-off line is exactly the case most likely to
 * have it unset, and the failure would be silent in the dangerous direction: a
 * real canvas quietly dropping off the picking list. A title nobody has listed
 * here keeps the old behaviour and keeps shouting, which is the right default
 * for something unrecognised.
 *
 * Match is by PREFIX on the normalized title, so "Private Class" also covers
 * "Private Class (2 hours)" and the like without another edit.
 *
 * The list below is the BUILT-IN one. Anything else is added from the Orders
 * page, which stores it in `OtherItemTitle` and passes it in here — a new kind
 * of one-off is a click rather than a deploy. Every caller that classifies a
 * line item has to pass those stored titles, or the page and the totals
 * disagree about what is physical, so `isOtherItemTitle` takes them as an
 * explicit argument rather than reading a module-level cache.
 */

import { normalizeTitle } from "./shopify";

/**
 * Non-physical product titles that ship with the app, matched as prefixes.
 *
 * Keep this short and specific. Anything here is invisible to the canvas, kit
 * and supply counts and deducts no stock, so a title added by mistake makes
 * real inventory stop being pulled. These cannot be removed from the Orders
 * page; everything added there lives in the database instead.
 */
export const OTHER_ITEM_TITLES: readonly string[] = [
  "Private Class",
  // Teaching at someone's office. Live on #4305, and a good illustration of
  // why the `requiresShipping` rule was rejected: this line has no Shopify
  // product and no variant behind it at all — it was typed onto a draft order
  // — so there was no flag to read either way.
  "Corporate Event",
  // Charged after the fact when a customer upgrades shipping; already live.
  "Update Shipping",
  // Intangible by definition — Shopify has it as requiresShipping: false.
  "Modern Mesh Digital Gift Card",
  "Gift Card",
];

const NORMALIZED = OTHER_ITEM_TITLES.map((t) => normalizeTitle(t));

/**
 * True when this line item is a service or credit rather than an object.
 *
 * `stored` is whatever is in `OtherItemTitle`, which the caller loads once per
 * request. A blank or whitespace-only entry is ignored rather than treated as
 * a prefix that matches everything — that single bad row would empty the
 * picking list, which is the one failure here nobody would notice in time.
 */
export function isOtherItemTitle(
  productTitle: string | null | undefined,
  stored: readonly string[] = [],
): boolean {
  if (!productTitle) return false;
  const title = normalizeTitle(productTitle);
  if (NORMALIZED.some((t) => title.startsWith(t))) return true;
  return stored.some((raw) => {
    const t = normalizeTitle(raw ?? "");
    return t.length > 0 && title.startsWith(t);
  });
}

/** Is this title one of the built-ins, i.e. not removable from the page? */
export function isBuiltInOtherTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return NORMALIZED.includes(normalizeTitle(title));
}

/**
 * Why an order exists — and therefore whether it counts as demand.
 *
 * Almost every order is an ordinary sale. The exceptions are the ones built by
 * hand in the Shopify admin as DRAFT orders, and they are usually not sales at
 * all: a donation to a raffle or a marketplace, a replacement for a canvas that
 * arrived badly printed, or a wholesale order at half price.
 *
 * All of them move real stock off a real shelf, so all of them must deduct.
 * None of them is retail demand. Letting them into the sales rate skews every
 * purchasing decision that reads it — reorder sizing, stock alerts, weeks of
 * cover, the kit-order planner — and a single 30-unit wholesale order reads as
 * a sudden surge in retail interest.
 *
 * So the kind is recorded on the order and the demand queries filter on it.
 * `Design.totalSold` still counts every kind, because that column answers "how
 * many units left the building", which a donation genuinely does.
 */

export const ORDER_KINDS = ["retail", "wholesale", "donation", "replacement"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** The default, and the only kind that counts as demand. */
export const RETAIL: OrderKind = "retail";

export function isOrderKind(value: unknown): value is OrderKind {
  return typeof value === "string" && (ORDER_KINDS as readonly string[]).includes(value);
}

/** Normalise an unknown stored/submitted value, falling back to retail. */
export function toOrderKind(value: unknown): OrderKind {
  return isOrderKind(value) ? value : RETAIL;
}

/**
 * Only retail counts toward the sales rate. Everything else deducts stock and
 * stays out of the numbers that decide what to buy.
 */
export function countsAsRetailDemand(kind: string | null | undefined): boolean {
  return toOrderKind(kind) === RETAIL;
}

export const ORDER_KIND_LABEL: Record<OrderKind, string> = {
  retail: "Retail",
  wholesale: "Wholesale",
  donation: "Donation",
  replacement: "Replacement",
};

/** One line explaining each kind, for the picker on the Orders page. */
export const ORDER_KIND_HELP: Record<OrderKind, string> = {
  retail: "A normal sale. Counts toward the sales rate that sizes reorders.",
  wholesale: "A shop buying at 50% off. Deducts stock; kept out of the retail sales rate.",
  donation: "Given away — a raffle, a marketplace, a comp. Deducts stock; not demand.",
  replacement: "Sent to replace a damaged or badly printed unit. Deducts stock; not demand.",
};

/**
 * Shopify stamps an order created by completing a draft order with this source.
 * Everything else we see is "web", "pos", "tiktok", or a bare app id.
 */
export function isDraftOriginatedSource(sourceName: string | null | undefined): boolean {
  return (sourceName || "").trim().toLowerCase() === "shopify_draft_order";
}

// Tags that name a kind outright. Deliberately narrow: a tag is matched only
// when the WHOLE tag is one of these (or a `kind:x` form), never as a substring,
// because the live store already carries app-written tags like "Stitch Email
// Sent", "All customers" and "Shop Cash offers acquired". "gift" and "free" are
// left out on purpose — a gift-wrap or discount app can apply either to an
// ordinary sale.
const TAG_SYNONYMS: Record<string, OrderKind> = {
  wholesale: "wholesale",
  trade: "wholesale",
  donation: "donation",
  donated: "donation",
  comp: "donation",
  giveaway: "donation",
  replacement: "replacement",
  damaged: "replacement",
  reprint: "replacement",
  redo: "replacement",
};

const squashTag = (tag: string) => tag.trim().toLowerCase().replace(/[\s_-]+/g, "");

/**
 * The kind a Shopify tag asks for, or null if no tag says anything.
 *
 * `kind:wholesale` / `order-kind:donation` are honoured as an explicit escape
 * hatch, so a kind can always be set from Shopify even if the word isn't in the
 * synonym list above.
 */
export function kindFromTags(tags: readonly string[] | null | undefined): OrderKind | null {
  if (!tags) return null;
  for (const raw of tags) {
    const prefixed = raw.trim().toLowerCase().match(/^(?:order[\s_-]*)?kind[\s_-]*:\s*(.+)$/);
    if (prefixed) {
      const asked = squashTag(prefixed[1]);
      if (isOrderKind(asked)) return asked;
      const synonym = TAG_SYNONYMS[asked];
      if (synonym) return synonym;
      continue;
    }
    const synonym = TAG_SYNONYMS[squashTag(raw)];
    if (synonym) return synonym;
  }
  return null;
}

export interface ClassifiableOrder {
  sourceName: string | null | undefined;
  tags?: readonly string[] | null;
  /** The order's current total, as Shopify's decimal string or a number. */
  totalAmount?: string | number | null;
}

function amountOf(total: string | number | null | undefined): number | null {
  if (total === null || total === undefined) return null;
  const n = typeof total === "number" ? total : parseFloat(total);
  return Number.isFinite(n) ? n : null;
}

/**
 * Work out why an order exists, from what Shopify tells us.
 *
 * 1. An explicit tag always wins — that is the owners saying so.
 * 2. A hand-built draft order totalling $0 is not a sale. Nobody checks out at
 *    zero; someone built it to give something away. Which of donation or
 *    replacement it is cannot be told apart from the order, so it defaults to
 *    donation and can be corrected on the Orders page. The two behave
 *    identically — the default only changes the label, never the arithmetic.
 * 3. Anything else is retail, including a draft order at a real price: a phone
 *    order typed up by hand is still a sale (order #3775, $70, was exactly
 *    that).
 */
export function classifyOrderKind(order: ClassifiableOrder): OrderKind {
  const tagged = kindFromTags(order.tags);
  if (tagged) return tagged;

  const amount = amountOf(order.totalAmount);
  if (isDraftOriginatedSource(order.sourceName) && amount === 0) return "donation";

  return RETAIL;
}

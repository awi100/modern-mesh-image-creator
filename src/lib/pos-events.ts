/**
 * How a day of in-person selling is classified.
 *
 * Shopify stamps every in-person sale with source_name = "pos", whether it was
 * a craft market or a sip-and-stitch evening at a restaurant. Only markets
 * should drive the market packing targets, so the distinction is stored by us,
 * one row per day, in pos_events. A day with no row counts as a market — that
 * keeps the common case zero-effort and means only exceptions need marking.
 *
 * Sales from a non-market day are still real sales: they continue to count for
 * velocity, reorder and revenue. The only thing they're excluded from is
 * "what should be in the market tote".
 */
export const EVENT_KINDS = ["market", "sip_and_stitch", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_LABEL: Record<EventKind, string> = {
  market: "Market",
  sip_and_stitch: "Sip & Stitch",
  other: "Other",
};

/**
 * The local day an in-person sale happened on. Must match how market/prep
 * buckets POS orders.
 *
 * This is deliberately NOT the UTC day. Everything in-person happens in
 * Boston, and an evening event runs past 8pm Eastern — which is already
 * tomorrow in UTC. Keying on `toISOString()` split the 14 Oct sip-and-stitch
 * into "14 Oct" (15 orders, up to 7:52pm) and "15 Oct" (12 orders, 8:02pm
 * onwards), so classifying the event as a sip-and-stitch only suppressed half
 * of it and the other half went on feeding the market packing targets. The
 * same split hit 23 Sep, where it got mistaken for a genuine two-day event.
 *
 * 18 of 281 POS orders land on a different UTC day than Eastern day, and every
 * one of them is one of those two evenings — the Sunday markets all finish
 * well before 8pm, so no market day moves.
 */
export const EVENT_TIME_ZONE = "America/New_York";

// en-CA formats as YYYY-MM-DD, which is the key format pos_events.day stores.
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: EVENT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const posDayKey = (d: Date) => DAY_FORMAT.format(d);

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

/** UTC day key. Must match how market/prep buckets POS orders. */
export const posDayKey = (d: Date) => d.toISOString().slice(0, 10);

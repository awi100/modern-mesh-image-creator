/**
 * Reading a webhook envelope.
 *
 * Ticket Tailor POSTs `{ id, created_at, event, resource_url, payload }`, where
 * `id` is its own delivery id and `payload` is the changed resource. Pure, so
 * the route is glue.
 */

export type WebhookKind =
  | "order.created" | "order.updated"
  | "issued_ticket.created" | "issued_ticket.updated"
  | "other";

export interface WebhookEnvelope {
  deliveryId: string | null;
  event: string | null;
  kind: WebhookKind;
  resourceUrl: string | null;
  /** The event this delivery concerns, if it can be determined. */
  ttEventId: string | null;
  payload: Record<string, unknown> | null;
}

const HANDLED = new Set<WebhookKind>([
  "order.created", "order.updated", "issued_ticket.created", "issued_ticket.updated",
]);

export function isHandled(kind: WebhookKind): boolean {
  return HANDLED.has(kind);
}

/**
 * Resources we act on, by the name Ticket Tailor actually uses.
 *
 * Versioned, hence the alias: a future `ORDER_V3` is one line here and no
 * change anywhere else.
 */
const RESOURCE_ALIASES: Record<string, "order" | "issued_ticket"> = {
  ORDER: "order",
  ORDER_V2: "order",
  ISSUED_TICKET: "issued_ticket",
};

/**
 * Map Ticket Tailor's event name onto what we do about it.
 *
 * THE NAMES ARE THEIRS, AND THEY ARE NOT WHAT THIS FILE FIRST GUESSED. A live
 * delivery is `ORDER_V2.CREATED` or `ISSUED_TICKET.CREATED` — upper case, and
 * the order resource is versioned. This used to compare the whole string
 * against `order.created` / `issued_ticket.created`, so every real delivery
 * classified as "other" and the route acknowledged it without re-syncing
 * anything: 20 deliveries between 9 and 14 Nov 2026 each returned 200 and
 * changed nothing, which is indistinguishable from no webhook at all.
 *
 * So the name is taken apart instead of matched whole — upper-cased, which
 * accepts the lower-case spelling too, split on the last ".", and the resource
 * put through the alias table. An unrecognised resource or action is still
 * "other", because acting on a name we do not understand is worse than
 * ignoring it.
 */
function classify(event: string | null): WebhookKind {
  if (!event) return "other";
  const dot = event.lastIndexOf(".");
  if (dot <= 0) return "other";

  const resource = RESOURCE_ALIASES[event.slice(0, dot).trim().toUpperCase()];
  const action = event.slice(dot + 1).trim().toUpperCase();
  if (!resource) return "other";
  if (action !== "CREATED" && action !== "UPDATED") return "other";

  return `${resource}.${action.toLowerCase()}` as WebhookKind;
}

/**
 * The order id out of a delivery's `resource_url`.
 *
 * An ORDER_V2 webhook payload does not carry its event: of the first 10 live
 * deliveries, NONE yielded an id through `eventIdFromPayload`. The
 * `event_summary` that function looks for belongs to an order read back from
 * the REST API, which is a different shape from the one pushed in a webhook —
 * the test fixture for this is an API response, so it proved nothing about the
 * webhook.
 *
 * The resource url is reliable (`.../v1/orders/or_87136845`), and an order we
 * have already stored tells us its event. That covers the case that matters:
 * an UPDATE to an existing order, i.e. a cancellation, which voids tickets.
 *
 * A brand-new order needs no fallback — an ISSUED_TICKET.CREATED for the same
 * purchase arrives within milliseconds, and a ticket payload does carry
 * `event_id`.
 */
export function orderIdFromResourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /\/orders\/([A-Za-z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}

/**
 * Find the event id in a payload.
 *
 * An issued ticket has `event_id` directly. An order does NOT — its event is at
 * `event_summary.id`, and its nested tickets each carry `event_id`, so both are
 * tried. Returns null rather than guessing, which the route turns into a 200
 * with nothing done: a delivery we cannot place is not an error worth making
 * Ticket Tailor retry 22 times.
 */
export function eventIdFromPayload(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;

  const direct = payload.event_id;
  if (typeof direct === "string" && direct) return direct;

  const summary = payload.event_summary as Record<string, unknown> | undefined;
  if (summary && typeof summary.id === "string" && summary.id) return summary.id;

  const nested = payload.issued_tickets;
  if (Array.isArray(nested)) {
    for (const t of nested) {
      const id = (t as Record<string, unknown> | null)?.event_id;
      if (typeof id === "string" && id) return id;
    }
  }
  return null;
}

export function parseEnvelope(body: unknown): WebhookEnvelope {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const payload = (o.payload && typeof o.payload === "object" ? o.payload : null) as Record<string, unknown> | null;
  const event = typeof o.event === "string" ? o.event : null;

  return {
    deliveryId: typeof o.id === "string" && o.id ? o.id : null,
    event,
    kind: classify(event),
    resourceUrl: typeof o.resource_url === "string" ? o.resource_url : null,
    ttEventId: eventIdFromPayload(payload),
    payload,
  };
}

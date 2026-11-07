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

function classify(event: string | null): WebhookKind {
  if (!event) return "other";
  return HANDLED.has(event as WebhookKind) ? (event as WebhookKind) : "other";
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

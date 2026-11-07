/**
 * Turning Ticket Tailor payloads into the app's own shapes.
 *
 * Pure, so every oddity below is pinned by a test against a real fixture in
 * __fixtures__/ rather than discovered in production.
 */

/** The canvas question is matched on this, not on its full text: the wording
 *  differs between events already — "check out our canvas selection at
 *  modernmeshco.com" on the December event versus "check out our canvases at
 *  modernmeshco.com" on the September ones — and matching the whole string
 *  would silently stop finding picks the next time it is reworded. */
export const CANVAS_QUESTION_PATTERN = /canvas/i;

/** What an API key without customer-data access returns instead of an answer.
 *  Treated as a failure rather than an unknown canvas: every ticket would
 *  otherwise resolve as unmapped and look like 37 new designs to map. */
export const MASKED = "****";

export interface CustomQuestion {
  question?: string | null;
  answer?: string | null;
}

/** Lowercase, collapse whitespace. The join key to the mapping table.
 *  "New England vs Everyone" and "New England Vs Everyone" are the same pick
 *  and must not become two mapping rows. */
export function normaliseAnswer(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function isMasked(s: string | null | undefined): boolean {
  const v = (s ?? "").trim();
  return v.length > 0 && /^\*+$/.test(v);
}

export interface CanvasAnswer {
  answer: string | null;
  /** The question the answer came from, kept so a reworded question is visible
   *  in the UI rather than mysteriously resolving differently. */
  question: string | null;
  /** More than one question matched /canvas/i. The first is used; this flags it
   *  so the event page can say so instead of quietly picking one. */
  ambiguous: boolean;
  masked: boolean;
}

export function findCanvasAnswer(questions: CustomQuestion[] | null | undefined): CanvasAnswer | null {
  const list = Array.isArray(questions) ? questions : [];
  const hits = list.filter((q) => CANVAS_QUESTION_PATTERN.test(q?.question ?? ""));
  if (hits.length === 0) return null;
  const first = hits[0];
  const raw = (first.answer ?? "").trim();
  return {
    answer: raw === "" ? null : raw,
    question: first.question ?? null,
    ambiguous: hits.length > 1,
    masked: isMasked(first.answer),
  };
}

/* -------------------------------------------------------------------------- */

/** Ticket Tailor sends unix seconds as ints. Null stays null rather than
 *  becoming 1970. */
export function unixToDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v * 1000);
  if (typeof v === "string" && /^\d+$/.test(v)) return new Date(Number(v) * 1000);
  return null;
}

/** `start` / `end` on an event are objects: { date, time, iso, unix, formatted,
 *  timezone }. `iso` carries no offset, so `unix` is the trustworthy field. */
export function eventDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const fromUnix = unixToDate(o.unix);
    if (fromUnix) return fromUnix;
    if (typeof o.iso === "string") {
      const d = new Date(o.iso);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function eventTimezone(v: unknown): string | null {
  if (v && typeof v === "object") {
    const tz = (v as Record<string, unknown>).timezone;
    if (typeof tz === "string" && tz) return tz;
  }
  return null;
}

export interface ParsedEvent {
  ttEventId: string;
  ttEventSeriesId: string | null;
  name: string;
  venueName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  timezone: string | null;
  ttStatus: string | null;
}

export function parseEvent(json: Record<string, unknown>): ParsedEvent {
  const venue = json.venue as Record<string, unknown> | null | undefined;
  return {
    ttEventId: String(json.id ?? ""),
    ttEventSeriesId: json.event_series_id ? String(json.event_series_id) : null,
    name: String(json.name ?? "Untitled event"),
    venueName: venue && typeof venue.name === "string" ? venue.name : null,
    startsAt: eventDate(json.start),
    endsAt: eventDate(json.end),
    timezone:
      (typeof json.timezone === "string" && json.timezone) ||
      eventTimezone(json.start) ||
      null,
    ttStatus: json.status ? String(json.status) : null,
  };
}

export interface ParsedTicket {
  ttTicketId: string;
  ttOrderId: string;
  ttEventId: string;
  attendeeName: string | null;
  attendeeEmail: string | null;
  ticketTypeName: string | null;
  ttTicketTypeId: string | null;
  canvasAnswer: string | null;
  answerKey: string | null;
  answerQuestion: string | null;
  answerAmbiguous: boolean;
  answerMasked: boolean;
  ttStatus: string | null;
  voidedAt: Date | null;
  listedPriceCents: number | null;
  ttCreatedAt: Date | null;
  ttUpdatedAt: Date | null;
}

export function parseIssuedTicket(json: Record<string, unknown>): ParsedTicket {
  const ca = findCanvasAnswer(json.custom_questions as CustomQuestion[] | undefined);
  // full_name is present on a standalone /issued_tickets read but null on the
  // copies nested inside an order, where first/last are also null. Fall back
  // through all three rather than showing a blank attendee.
  const name =
    pickString(json.full_name) ??
    joinNames(pickString(json.first_name), pickString(json.last_name)) ??
    null;

  return {
    ttTicketId: String(json.id ?? ""),
    ttOrderId: String(json.order_id ?? ""),
    ttEventId: String(json.event_id ?? ""),
    attendeeName: name,
    attendeeEmail: pickString(json.email),
    ticketTypeName: pickString(json.description),
    ttTicketTypeId: pickString(json.ticket_type_id),
    canvasAnswer: ca?.answer ?? null,
    answerKey: ca?.answer ? normaliseAnswer(ca.answer) : null,
    answerQuestion: ca?.question ?? null,
    answerAmbiguous: ca?.ambiguous ?? false,
    answerMasked: ca?.masked ?? false,
    ttStatus: pickString(json.status),
    voidedAt: unixToDate(json.voided_at),
    listedPriceCents: typeof json.listed_price === "number" ? json.listed_price : null,
    ttCreatedAt: unixToDate(json.created_at),
    ttUpdatedAt: unixToDate(json.updated_at),
  };
}

export interface ParsedOrder {
  ttOrderId: string;
  ttEventId: string | null;
  status: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  totalCents: number;
  totalPaidCents: number;
  refundCents: number;
  currency: string | null;
  ttCreatedAt: Date | null;
  /** Tickets arrive nested inside an order payload, which is what makes a
   *  single /orders read enough to build an attendee list. */
  tickets: ParsedTicket[];
}

export function parseOrder(json: Record<string, unknown>): ParsedOrder {
  const buyer = (json.buyer_details ?? {}) as Record<string, unknown>;
  const summary = (json.event_summary ?? {}) as Record<string, unknown>;
  const currency = (json.currency ?? {}) as Record<string, unknown>;
  const nested = Array.isArray(json.issued_tickets) ? (json.issued_tickets as Record<string, unknown>[]) : [];
  // The event id is at event_summary.id — there is no top-level event_id on an
  // order. Nested tickets carry their own event_id, so use that as a fallback.
  const ttEventId =
    pickString(summary.id) ?? pickString(nested[0]?.event_id) ?? null;

  return {
    ttOrderId: String(json.id ?? ""),
    ttEventId,
    status: pickString(json.status),
    buyerName:
      pickString(buyer.name) ??
      joinNames(pickString(buyer.first_name), pickString(buyer.last_name)) ??
      null,
    buyerEmail: pickString(buyer.email),
    // Minor units as sent: 6500 is $65.00.
    totalCents: num(json.total),
    totalPaidCents: num(json.total_paid),
    refundCents: num(json.refund_amount),
    currency: pickString(currency.code),
    ttCreatedAt: unixToDate(json.created_at),
    tickets: nested
      .map((t) => parseIssuedTicket({ ...t, event_id: t.event_id ?? ttEventId, order_id: t.order_id ?? json.id }))
      .filter((t) => t.ttTicketId),
  };
}

/* -------------------------------------------------------------------------- */

function pickString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function joinNames(first: string | null, last: string | null): string | null {
  const s = [first, last].filter(Boolean).join(" ").trim();
  return s === "" ? null : s;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

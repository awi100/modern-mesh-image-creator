/**
 * Ticket Tailor REST client. READ-ONLY by construction.
 *
 * There are no write methods here and there must never be: we mirror their
 * data, we never push to it. Voiding a ticket or editing an order is done by a
 * person in their dashboard.
 *
 * Auth is HTTP Basic with the API key as the username and a blank password.
 * The key is scoped to one box office.
 *
 * Rate limit is 5000 requests per 30 minutes. A full sync of five events is
 * roughly a dozen calls, so the limit is not a practical constraint — but a 429
 * is still honoured rather than hammered, and the remaining count is logged as
 * it gets low so an accidental loop is visible in the Vercel logs rather than
 * just failing.
 */

const BASE = "https://api.tickettailor.com/v1";

/** Ticket Tailor's maximum. Fewer requests for the same data. */
export const PAGE_LIMIT = 100;
/** Log when the budget drops below this, so a runaway loop is noticeable. */
const REMAINING_WARN = 200;
const MAX_429_RETRIES = 3;

export interface TtListResponse<T> {
  data: T[];
  links?: { next?: string | null; previous?: string | null };
}

export class TicketTailorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = "TicketTailorError";
  }
}

function authHeader(): string {
  const key = process.env.TICKET_TAILOR_API_KEY;
  if (!key) throw new Error("TICKET_TAILOR_API_KEY is not configured");
  // Basic auth, key as username, blank password.
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One GET. Retries only on 429, honouring Retry-After.
 *
 * A 4xx other than 429 is not retried: a bad event id or a key without
 * customer-data access will fail identically every time, and retrying buries
 * the real reason.
 */
export async function ttGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}${qs.toString() ? `?${qs}` : ""}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: authHeader(), Accept: "application/json" },
      // Always fresh: this is reconciliation, and a cached page would make a
      // sync silently do nothing.
      cache: "no-store",
    });

    const remaining = Number(res.headers.get("x-rate-limit-remaining") ?? NaN);
    if (Number.isFinite(remaining) && remaining < REMAINING_WARN) {
      console.warn(
        `Ticket Tailor rate limit low: ${remaining} requests left, resets ${res.headers.get("x-rate-limit-reset") ?? "?"}`,
      );
    }

    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after") ?? NaN);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2 ** attempt * 1000;
      console.warn(`Ticket Tailor 429 on ${path}; waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new TicketTailorError(
        `Ticket Tailor ${res.status} on ${path}: ${body.slice(0, 300)}`,
        res.status, path, body,
      );
    }

    return (await res.json()) as T;
  }
}

/**
 * Every page of a list endpoint.
 *
 * Pages with `starting_after` on the last id rather than following
 * `links.next`, because `next` is a relative path that would need re-signing
 * and re-parsing; the cursor is the id we already hold.
 *
 * `maxPages` is a stop so a malformed cursor cannot loop forever — 100 pages is
 * 10,000 records, far beyond anything this box office holds.
 */
export async function ttListAll<T extends { id?: string }>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  maxPages = 100,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await ttGet<TtListResponse<T>>(path, { ...params, limit: PAGE_LIMIT, starting_after: cursor });
    const batch = res.data ?? [];
    out.push(...batch);
    if (batch.length < PAGE_LIMIT) return out;

    const last = batch[batch.length - 1]?.id;
    // No usable cursor means we cannot advance; returning beats looping on the
    // same page forever.
    if (!last || last === cursor) return out;
    cursor = last;
  }

  console.warn(`Ticket Tailor ${path}: stopped at ${maxPages} pages (${out.length} records)`);
  return out;
}

/* ---- typed shapes, only what the sync reads ------------------------------ */

export interface TtEvent extends Record<string, unknown> { id: string }
export interface TtOrder extends Record<string, unknown> { id: string }
export interface TtIssuedTicket extends Record<string, unknown> { id: string }

export const listEvents = () => ttListAll<TtEvent>("/events");
export const getEvent = (ttEventId: string) => ttGet<{ data: TtEvent }>(`/events/${ttEventId}`);
export const listIssuedTickets = (ttEventId: string) =>
  ttListAll<TtIssuedTicket>("/issued_tickets", { event_id: ttEventId });
export const listOrders = (ttEventId?: string) =>
  ttListAll<TtOrder>("/orders", ttEventId ? { event_id: ttEventId } : {});

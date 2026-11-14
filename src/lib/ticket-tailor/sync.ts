/**
 * Mirroring Ticket Tailor into our own tables.
 *
 * SYNCING NEVER MOVES STOCK. This upserts events, orders and tickets and
 * re-resolves each pick against the mapping table. Nothing here decrements a
 * count — that happens only when someone presses Confirm on an event page.
 *
 * Three reasons it is built that way:
 *   - webhook idempotency becomes trivial, because every write is an upsert
 *     and a redelivery is harmless;
 *   - a ticket bought weeks early and later cancelled never touched stock;
 *   - it mirrors Shopify, which deducts at fulfilment rather than at order.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listEvents, listIssuedTickets, listOrders, getEvent } from "./client";
import { parseEvent, parseIssuedTicket, parseOrder, type ParsedTicket } from "./parse";
import { mappingsByKey, resolveTicket } from "./resolve";

/**
 * Events that started before this cutoff are marked `historical` the first time
 * they are seen.
 *
 * Their canvases were already deducted by hand or rung up through Shopify POS —
 * across the three classified sip-and-stitch days there were 42 POS orders
 * covering 33 design units — so confirming them would count the same canvas
 * twice. They stay viewable, and confirming needs an explicit unlock.
 *
 * A fixed date rather than "before today": a relative cutoff would quietly
 * reclassify an event as historical the day after it happened, including one
 * that had been confirmed correctly.
 */
export const HISTORICAL_BEFORE = new Date("2026-11-07T00:00:00Z");

export interface SyncResult {
  events: number;
  orders: number;
  tickets: number;
  unmapped: number;
  masked: number;
  errors: string[];
  /** Events the budget did not allow, newest-first order means these are the
   *  least urgent ones. Empty on a complete run. */
  skipped: string[];
  /** True when the budget stopped the loop rather than it finishing. */
  timedOut: boolean;
  /**
   * Milliseconds per event, so a slow one is visible instead of guessed at.
   *
   * `fetchMs` is wall-clock on the Ticket Tailor API and `ms` is what the loop
   * waited; they differ because the fetches overlap. Split out because "the
   * sync is slow" has two completely different fixes depending on which side it
   * is, and the first round of this was fixed by guessing right rather than by
   * knowing.
   */
  timings: { ttEventId: string; name: string | null; ms: number; fetchMs: number; writeMs: number }[];
}

const empty = (): SyncResult => ({
  events: 0, orders: 0, tickets: 0, unmapped: 0, masked: 0,
  errors: [], skipped: [], timedOut: false, timings: [],
});

/**
 * How many writes go to the database in one round trip.
 *
 * Every row used to be its own `await prisma.x.upsert(...)`, which on a full
 * sync of this box office is 193 order writes plus 247 ticket writes — 440
 * sequential round trips to a database that is not in the same building. That
 * is what was killing the route: the function hit the platform's 60s ceiling
 * and was terminated, so the browser got Vercel's HTML error page instead of
 * JSON ("Unexpected token 'A', \"An error o\"..."), and the events the loop had
 * not reached yet — the upcoming ones, the only ones anybody needs — were
 * never synced at all.
 *
 * Prisma's array form of $transaction sends the whole chunk as one request and
 * runs it in one database transaction, so the same 440 writes become 9 round
 * trips. Chunked rather than sent as a single transaction so one oversized
 * statement can't hold a lock across the entire sync.
 */
const WRITE_CHUNK = 50;

async function runChunked(ops: Prisma.PrismaPromise<unknown>[]): Promise<void> {
  for (let i = 0; i < ops.length; i += WRITE_CHUNK) {
    await prisma.$transaction(ops.slice(i, i + WRITE_CHUNK));
  }
}

/**
 * Has anything we store about this row actually changed?
 *
 * Syncing is reconciliation, and almost nothing moves between two syncs: press
 * Sync twice in a minute and every order and ticket is written again
 * identically. Those writes were the slow part — a measured run spent 0.5s
 * reading Ticket Tailor and 15.0s writing one event — so a row that matches
 * what is already stored is not written at all.
 *
 * `raw` is deliberately NOT compared. Reading every stored blob back to diff it
 * would cost more than the write it saves, and nothing reads `raw` to make a
 * decision — it is a record of what arrived. It still goes in whenever any
 * field we do compare has moved.
 */
export function unchanged(
  stored: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!stored) return false;
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "raw") continue;
    const s = stored[k];
    if (v instanceof Date || s instanceof Date) {
      const a = v instanceof Date ? v.getTime() : v === null || v === undefined ? null : NaN;
      const b = s instanceof Date ? s.getTime() : s === null || s === undefined ? null : NaN;
      if (a !== b) return false;
    } else if (s !== v) {
      return false;
    }
  }
  return true;
}

/** Upsert one event's row, deciding `state` only when it is first created. */
async function upsertEvent(json: Record<string, unknown>) {
  const e = parseEvent(json);
  if (!e.ttEventId) return null;
  const startsAt = e.startsAt ?? new Date(0);
  const historical = startsAt < HISTORICAL_BEFORE;

  const common = {
    ttEventSeriesId: e.ttEventSeriesId,
    name: e.name,
    venueName: e.venueName,
    startsAt,
    endsAt: e.endsAt,
    timezone: e.timezone,
    ttStatus: e.ttStatus,
    lastSyncedAt: new Date(),
  };

  return prisma.ticketTailorEvent.upsert({
    where: { ttEventId: e.ttEventId },
    // `state` is NOT updated: once an event is confirmed, or unlocked for
    // historical confirmation, a later sync must not reset that.
    update: common,
    create: { ttEventId: e.ttEventId, ...common, state: historical ? "historical" : "open" },
  });
}

/**
 * Resolve a parsed ticket and BUILD its write, preserving any override set.
 *
 * Returns the operation rather than awaiting it so the caller can batch. A
 * Prisma promise is lazy — nothing reaches the database until it is awaited or
 * handed to $transaction.
 */
function buildTicketUpsert(
  t: ParsedTicket,
  byKey: Map<string, { answerKey: string; designId: string | null; needsKit: boolean }>,
  /** What is already stored for this event, read once rather than per ticket. */
  stored: Map<string, { overrideDesignId: string | null } & Record<string, unknown>>,
) {
  if (!t.ttTicketId || !t.ttEventId || !t.ttOrderId) return { op: null, unmapped: false, masked: false };

  const existing = stored.get(t.ttTicketId);

  // An override is ours, not theirs, so it must survive a sync.
  const r = resolveTicket(
    { ...t, overrideDesignId: existing?.overrideDesignId ?? null },
    byKey,
  );

  const data = {
    ttOrderId: t.ttOrderId,
    ttEventId: t.ttEventId,
    attendeeName: t.attendeeName,
    attendeeEmail: t.attendeeEmail,
    ticketTypeName: t.ticketTypeName,
    ttTicketTypeId: t.ttTicketTypeId,
    canvasAnswer: t.canvasAnswer,
    answerKey: t.answerKey,
    resolveStatus: r.status,
    resolvedDesignId: r.designId,
    resolvedNeedsKit: r.needsKit,
    ttStatus: t.ttStatus,
    voidedAt: t.voidedAt,
    listedPriceCents: t.listedPriceCents,
    ttCreatedAt: t.ttCreatedAt,
    ttUpdatedAt: t.ttUpdatedAt,
    raw: t as unknown as object,
  };

  // The resolve above still runs for a skipped ticket: `unmapped` and `masked`
  // describe the event's state, not what was written, and a sync that stopped
  // counting them would report a clean event as soon as nothing had changed.
  const op = unchanged(existing, data)
    ? null
    : prisma.ticketTailorTicket.upsert({
        where: { ttTicketId: t.ttTicketId },
        update: data,
        create: { ttTicketId: t.ttTicketId, ...data },
      });

  return { op, unmapped: r.status === "unmapped", masked: r.masked };
}

/**
 * Everything one event needs from the API, fetched in one go.
 *
 * The three calls are INDEPENDENT of each other — only the writes are ordered
 * — so they are issued together. Do not read that as a speed-up: Ticket Tailor
 * serves this key's requests serially at roughly 3s each, so the bundle costs
 * about what the three calls cost one after another. It is grouped because it
 * makes one event's reads one unit of work with one failure, not because it
 * overlaps anything. Making a sync faster means making FEWER requests.
 *
 * Never rejects. A failure is carried as `ok: false` so one unreachable event
 * cannot abort the others — `listOrders` and `listIssuedTickets` used to throw
 * straight through `syncEvent` and out of the whole loop, discarding every
 * event that had already synced.
 */
type EventBundle =
  | { ok: true; ttEventId: string; event: Record<string, unknown>; orders: unknown[]; tickets: unknown[] }
  | { ok: false; ttEventId: string; error: string };

function fetchEventBundle(ttEventId: string): Promise<EventBundle> {
  return Promise.all([
    getEvent(ttEventId) as Promise<Record<string, unknown>>,
    listOrders(ttEventId) as Promise<unknown[]>,
    listIssuedTickets(ttEventId) as Promise<unknown[]>,
  ])
    .then(([event, orders, tickets]) => ({ ok: true as const, ttEventId, event, orders, tickets }))
    .catch((e) => ({ ok: false as const, ttEventId, error: e instanceof Error ? e.message : String(e) }));
}

/**
 * Sync one event: its own row, then its orders, then its tickets.
 *
 * Tickets are read from /issued_tickets rather than taken from the nested
 * copies inside each order. The nested copies have `first_name`/`last_name`
 * null, so attendee names would come out blank.
 */
export async function syncEvent(ttEventId: string): Promise<SyncResult> {
  if (!ttEventId) {
    const out = empty();
    out.errors.push("syncEvent called with no event id");
    return out;
  }
  const mappings = await prisma.ticketTailorCanvasMapping.findMany();
  return writeEventBundle(await fetchEventBundle(ttEventId), mappingsByKey(mappings));
}

/**
 * Write one already-fetched event. No API calls happen here, so the caller
 * controls when the network work runs and how much of it overlaps.
 *
 * `byKey` is passed in rather than read here: the mapping table is the same for
 * every event, and re-reading it per event was one extra round trip each.
 */
async function writeEventBundle(
  bundle: EventBundle,
  byKey: Map<string, { answerKey: string; designId: string | null; needsKit: boolean }>,
): Promise<SyncResult> {
  const out = empty();
  const ttEventId = bundle.ttEventId;

  if (!bundle.ok) {
    out.errors.push(`event ${ttEventId}: ${bundle.error}`);
    return out;
  }

  try {
    const ev = await upsertEvent(bundle.event);
    if (!ev) { out.errors.push(`event ${ttEventId} could not be parsed`); return out; }
    out.events = 1;
  } catch (e) {
    out.errors.push(`event ${ttEventId}: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }

  // What we already hold for this event, read once. This doubles as the list of
  // order ids the ticket loop checks against, so it replaces a second query.
  const storedOrders = new Map(
    (await prisma.ticketTailorOrder.findMany({
      where: { ttEventId },
      select: {
        ttOrderId: true, ttEventId: true, status: true, buyerName: true, buyerEmail: true,
        totalCents: true, totalPaidCents: true, refundCents: true, currency: true, ttCreatedAt: true,
      },
    })).map((o) => [o.ttOrderId, o as Record<string, unknown>]),
  );
  const knownOrders = new Set(storedOrders.keys());

  const orderOps: Prisma.PrismaPromise<unknown>[] = [];
  for (const raw of bundle.orders) {
    const o = parseOrder(raw as Record<string, unknown>);
    if (!o.ttOrderId) continue;
    // Skip an order whose event we have not stored: its FK would fail, and a
    // half-written order is worse than a missing one.
    if (o.ttEventId !== ttEventId) continue;

    const data = {
      ttEventId,
      status: o.status,
      buyerName: o.buyerName,
      buyerEmail: o.buyerEmail,
      totalCents: o.totalCents,
      totalPaidCents: o.totalPaidCents,
      refundCents: o.refundCents,
      currency: o.currency,
      ttCreatedAt: o.ttCreatedAt,
      raw: raw as object,
    };
    if (!unchanged(storedOrders.get(o.ttOrderId), data)) {
      orderOps.push(prisma.ticketTailorOrder.upsert({
        where: { ttOrderId: o.ttOrderId },
        update: data,
        create: { ttOrderId: o.ttOrderId, ...data },
      }));
    }
    // An order seen this sync is one the ticket loop may reference, whether or
    // not it needed writing.
    knownOrders.add(o.ttOrderId);
    out.orders++;
  }
  // Orders land before tickets are written, because the ticket loop checks each
  // ticket's order against what is stored.
  await runChunked(orderOps);

  // Every ticket we already hold for this event, read once. A findUnique per
  // ticket was 226 sequential round trips to a remote database on a full sync,
  // which took the route past any sensible timeout. `overrideDesignId` comes
  // back in the same query it used to need its own query for.
  const storedTickets = new Map(
    (await prisma.ticketTailorTicket.findMany({
      where: { ttEventId },
      select: {
        ttTicketId: true, overrideDesignId: true, ttOrderId: true, ttEventId: true,
        attendeeName: true, attendeeEmail: true, ticketTypeName: true, ttTicketTypeId: true,
        canvasAnswer: true, answerKey: true, resolveStatus: true, resolvedDesignId: true,
        resolvedNeedsKit: true, ttStatus: true, voidedAt: true, listedPriceCents: true,
        ttCreatedAt: true, ttUpdatedAt: true,
      },
    })).map((t) => [t.ttTicketId, t as { overrideDesignId: string | null } & Record<string, unknown>]),
  );

  const ticketOps: Prisma.PrismaPromise<unknown>[] = [];
  for (const raw of bundle.tickets) {
    const t = parseIssuedTicket(raw as Record<string, unknown>);
    // A ticket whose order was not stored would fail its FK. That means the
    // order list and the ticket list disagree, which is worth saying out loud
    // rather than swallowing as a constraint error.
    if (!knownOrders.has(t.ttOrderId)) {
      out.errors.push(`ticket ${t.ttTicketId} references order ${t.ttOrderId}, which this event's order list did not include`);
      continue;
    }
    const r = buildTicketUpsert(t, byKey, storedTickets);
    if (r.op) { ticketOps.push(r.op); out.tickets++; }
    if (r.unmapped) out.unmapped++;
    if (r.masked) out.masked++;
  }
  await runChunked(ticketOps);

  return out;
}

/**
 * Sync everything recent plus everything upcoming.
 *
 * 120 days back is enough to cover the events this box office has held while
 * staying a handful of API calls.
 */
export const RECENT_DAYS = 120;

/**
 * How long the loop may spend before it stops and reports.
 *
 * The route is capped at 60s by the platform. Finishing early with a partial,
 * honest result beats being killed: a kill returns the platform's HTML error
 * page, so the browser cannot even read what DID sync, and every event the
 * loop had not reached stays stale with nothing saying so.
 */
export const SYNC_BUDGET_MS = 45_000;

export async function syncRecent(budgetMs = SYNC_BUDGET_MS): Promise<SyncResult> {
  const out = empty();
  const startedAt = Date.now();
  const since = new Date(Date.now() - RECENT_DAYS * 864e5);

  let events: Record<string, unknown>[];
  try {
    events = (await listEvents()) as Record<string, unknown>[];
  } catch (e) {
    out.errors.push(`listing events: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }

  // Keep upcoming events and anything from the window; drop the rest so a long
  // history does not make every sync expensive.
  const wanted = events
    .map(parseEvent)
    .filter((e) => e.ttEventId && !(e.startsAt && e.startsAt < since));

  // ORDER MATTERS, and it did not before. The loop used to take events in
  // whatever order the API listed them, which here is oldest first — so when
  // the budget ran out it had synced September and October and never reached
  // the upcoming events, the only ones anyone is packing for.
  //
  // Upcoming first, soonest first. Then past events LEAST RECENTLY SYNCED
  // first, rather than newest first: a budget that reaches only some of them
  // would otherwise refresh the same two every time and leave the oldest
  // permanently stale, which is the state this sync was found in. Rotating
  // means every past event comes round within a few syncs.
  const lastSynced = new Map(
    (await prisma.ticketTailorEvent.findMany({ select: { ttEventId: true, lastSyncedAt: true } }))
      .map((r) => [r.ttEventId, r.lastSyncedAt?.getTime() ?? 0]),
  );
  const now = Date.now();
  const upcoming = wanted.filter((e) => (e.startsAt?.getTime() ?? 0) >= now)
    .sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0));
  const past = wanted.filter((e) => (e.startsAt?.getTime() ?? 0) < now)
    .sort((a, b) => (lastSynced.get(a.ttEventId) ?? 0) - (lastSynced.get(b.ttEventId) ?? 0));

  const ordered = [...upcoming, ...past];

  // Read once, not once per event: the mapping table is the same for all of
  // them.
  const byKey = mappingsByKey(await prisma.ticketTailorCanvasMapping.findMany());

  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    // Stop while there is still time to RETURN. Overrunning the platform
    // ceiling means the function is killed and the caller gets an HTML error
    // page instead of this result, which loses the work that did succeed.
    if (Date.now() - startedAt > budgetMs) {
      out.timedOut = true;
      out.skipped.push(e.name ?? e.ttEventId);
      continue;
    }

    // ONE EVENT AT A TIME, MEASURED. Starting every event's reads at once was
    // tried and was worse: Ticket Tailor serves this key's requests serially at
    // roughly 3s each, so firing all fifteen together did not shorten the total
    // — it only pushed the FIRST result out to 48.8s, past the budget, so a
    // sync that had been completing four events completed one. Concurrency
    // cannot help here; only making fewer requests can.
    const at = Date.now();
    const bundle = await fetchEventBundle(e.ttEventId);
    const writeAt = Date.now();
    const r = await writeEventBundle(bundle, byKey);
    out.timings.push({
      ttEventId: e.ttEventId,
      name: e.name ?? null,
      ms: Date.now() - at,
      fetchMs: writeAt - at,
      writeMs: Date.now() - writeAt,
    });
    out.events += r.events;
    out.orders += r.orders;
    out.tickets += r.tickets;
    out.unmapped += r.unmapped;
    out.masked += r.masked;
    out.errors.push(...r.errors);
  }
  return out;
}

/**
 * Re-resolve every ticket against the current mappings, without calling the API.
 *
 * Used after a mapping is added or changed, so one new mapping fixes every
 * ticket that ever gave that answer rather than only future ones.
 */
export async function reresolveTickets(ttEventId?: string): Promise<{ updated: number }> {
  const mappings = await prisma.ticketTailorCanvasMapping.findMany();
  const byKey = mappingsByKey(mappings);
  const tickets = await prisma.ticketTailorTicket.findMany({
    where: ttEventId ? { ttEventId } : {},
    select: {
      id: true, canvasAnswer: true, answerKey: true, overrideDesignId: true,
      resolveStatus: true, resolvedDesignId: true, resolvedNeedsKit: true,
    },
  });

  let updated = 0;
  for (const t of tickets) {
    const r = resolveTicket(
      {
        canvasAnswer: t.canvasAnswer,
        answerKey: t.answerKey,
        // Masking is a property of the stored answer, so it is re-derived here
        // rather than trusted from a column.
        answerMasked: !!t.canvasAnswer && /^\*+$/.test(t.canvasAnswer.trim()),
        overrideDesignId: t.overrideDesignId,
      },
      byKey,
    );
    if (
      r.status !== t.resolveStatus ||
      r.designId !== t.resolvedDesignId ||
      r.needsKit !== t.resolvedNeedsKit
    ) {
      await prisma.ticketTailorTicket.update({
        where: { id: t.id },
        data: { resolveStatus: r.status, resolvedDesignId: r.designId, resolvedNeedsKit: r.needsKit },
      });
      updated++;
    }
  }
  return { updated };
}

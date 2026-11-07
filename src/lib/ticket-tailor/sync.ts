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
}

const empty = (): SyncResult => ({ events: 0, orders: 0, tickets: 0, unmapped: 0, masked: 0, errors: [] });

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

/** Resolve a parsed ticket and write it, preserving any override already set. */
async function upsertTicket(
  t: ParsedTicket,
  byKey: Map<string, { answerKey: string; designId: string | null; needsKit: boolean }>,
  /** Overrides already stored, read once per event rather than per ticket. */
  overrides: Map<string, string | null>,
) {
  if (!t.ttTicketId || !t.ttEventId || !t.ttOrderId) return { written: false, unmapped: false, masked: false };

  // An override is ours, not theirs, so it must survive a sync.
  const r = resolveTicket(
    { ...t, overrideDesignId: overrides.get(t.ttTicketId) ?? null },
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

  await prisma.ticketTailorTicket.upsert({
    where: { ttTicketId: t.ttTicketId },
    update: data,
    create: { ttTicketId: t.ttTicketId, ...data },
  });

  return { written: true, unmapped: r.status === "unmapped", masked: r.masked };
}

/**
 * Sync one event: its own row, then its orders, then its tickets.
 *
 * Tickets are read from /issued_tickets rather than taken from the nested
 * copies inside each order. The nested copies have `first_name`/`last_name`
 * null, so attendee names would come out blank.
 */
export async function syncEvent(ttEventId: string): Promise<SyncResult> {
  const out = empty();
  if (!ttEventId) { out.errors.push("syncEvent called with no event id"); return out; }

  const mappings = await prisma.ticketTailorCanvasMapping.findMany();
  const byKey = mappingsByKey(mappings);

  try {
    const ev = await upsertEvent(await getEvent(ttEventId) as Record<string, unknown>);
    if (!ev) { out.errors.push(`event ${ttEventId} could not be parsed`); return out; }
    out.events = 1;
  } catch (e) {
    out.errors.push(`event ${ttEventId}: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }

  for (const raw of await listOrders(ttEventId)) {
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
    await prisma.ticketTailorOrder.upsert({
      where: { ttOrderId: o.ttOrderId },
      update: data,
      create: { ttOrderId: o.ttOrderId, ...data },
    });
    out.orders++;
  }

  // Every order id we hold for this event, read once. A findUnique per ticket
  // was 226 sequential round trips to a remote database on a full sync, which
  // took the route past any sensible timeout.
  const overrides = new Map(
    (await prisma.ticketTailorTicket.findMany({
      where: { ttEventId, overrideDesignId: { not: null } },
      select: { ttTicketId: true, overrideDesignId: true },
    })).map((t) => [t.ttTicketId, t.overrideDesignId]),
  );

  const knownOrders = new Set(
    (await prisma.ticketTailorOrder.findMany({ where: { ttEventId }, select: { ttOrderId: true } }))
      .map((o) => o.ttOrderId),
  );

  for (const raw of await listIssuedTickets(ttEventId)) {
    const t = parseIssuedTicket(raw as Record<string, unknown>);
    // A ticket whose order was not stored would fail its FK. That means the
    // order list and the ticket list disagree, which is worth saying out loud
    // rather than swallowing as a constraint error.
    if (!knownOrders.has(t.ttOrderId)) {
      out.errors.push(`ticket ${t.ttTicketId} references order ${t.ttOrderId}, which this event's order list did not include`);
      continue;
    }
    const r = await upsertTicket(t, byKey, overrides);
    if (r.written) out.tickets++;
    if (r.unmapped) out.unmapped++;
    if (r.masked) out.masked++;
  }

  return out;
}

/**
 * Sync everything recent plus everything upcoming.
 *
 * 120 days back is enough to cover the events this box office has held while
 * staying a handful of API calls.
 */
export const RECENT_DAYS = 120;

export async function syncRecent(): Promise<SyncResult> {
  const out = empty();
  const since = new Date(Date.now() - RECENT_DAYS * 864e5);

  let events: Record<string, unknown>[];
  try {
    events = (await listEvents()) as Record<string, unknown>[];
  } catch (e) {
    out.errors.push(`listing events: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }

  for (const raw of events) {
    const e = parseEvent(raw);
    // Keep upcoming events and anything from the window; skip the rest so a
    // long history does not make every sync expensive.
    if (e.startsAt && e.startsAt < since) continue;

    const r = await syncEvent(e.ttEventId);
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { kitStockOf, KIT_GROUP_INCLUDE } from "@/lib/kit-pool";
import { posDayKey } from "@/lib/pos-events";
import { buildDeductionPlan, posOverlap, eventDiscrepancies, type PlanTicket } from "@/lib/ticket-tailor/plan";

export const dynamic = "force-dynamic";

/**
 * Everything one event's page needs, in one request: attendees with their
 * picks, what to bring against current stock, unmapped answers, discrepancies,
 * and the Shopify POS sales on the same day.
 *
 * `id` may be our cuid or Ticket Tailor's ev_… id, so a link can use either.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const event = await prisma.ticketTailorEvent.findFirst({
    where: { OR: [{ id }, { ttEventId: id }] },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const tickets = await prisma.ticketTailorTicket.findMany({
    where: { ttEventId: event.ttEventId },
    include: {
      resolvedDesign: { select: { id: true, name: true, meshCount: true } },
      overrideDesign: { select: { id: true, name: true, meshCount: true } },
      order: { select: { ttOrderId: true, status: true, buyerName: true, totalCents: true, currency: true } },
    },
    orderBy: [{ attendeeName: "asc" }, { ttTicketId: "asc" }],
  });

  const deductions = await prisma.ticketTailorDeduction.findMany({
    where: { ttEventId: event.ttEventId },
    orderBy: { createdAt: "desc" },
  });

  // The design an override points at wins, which is what must be deducted.
  const planTickets: PlanTicket[] = tickets.map((t) => {
    const design = t.overrideDesign ?? t.resolvedDesign;
    return {
      ttTicketId: t.ttTicketId,
      attendeeName: t.attendeeName,
      canvasAnswer: t.canvasAnswer,
      designId: design?.id ?? null,
      designName: design?.name ?? null,
      needsKit: t.resolvedNeedsKit,
      status: (t.overrideDesignId ? "override" : t.resolveStatus) as PlanTicket["status"],
      masked: !!t.canvasAnswer && /^\*+$/.test(t.canvasAnswer.trim()),
      voided: !!t.voidedAt,
      orderCancelled: isCancelled(t.order?.status),
      manuallyExcluded: !!t.excludedAt,
    };
  });

  const plan = buildDeductionPlan(planTickets, { deductKits: event.confirmDeductKits });

  // Current stock for every design in the plan, kits read through kit-pool so a
  // shared pool is reported once rather than per member.
  const designIds = [...new Set(plan.totals.map((t) => t.designId))];
  const designs = designIds.length
    ? await prisma.design.findMany({
        where: { id: { in: designIds } },
        select: {
          id: true, name: true, meshCount: true,
          canvasPrinted: true, marketCanvasPrinted: true, canvasAndover: true,
          kitsReady: true, marketKitsReady: true, kitsAndover: true,
          kitGroupId: true, ...KIT_GROUP_INCLUDE,
        },
      })
    : [];
  const stockById = new Map(designs.map((d) => {
    const kits = kitStockOf(d);
    return [d.id, {
      canvasHome: d.canvasPrinted, canvasMarket: d.marketCanvasPrinted, canvasAndover: d.canvasAndover,
      kitsHome: kits.home, kitsMarket: kits.market, kitsAndover: kits.andover,
      kitPool: kits.shared ? { name: kits.groupName, members: kits.memberCount } : null,
    }];
  }));

  // Shopify POS sales of these designs on the event's own Eastern day. The
  // reason this is here: canvases demonstrably are rung up through POS at these
  // events, so the owners need both numbers side by side before deducting.
  const day = posDayKey(event.startsAt);
  const posByDesign = new Map<string, { designId: string; units: number; kits: number }>();
  if (designIds.length) {
    const dayStart = new Date(`${day}T00:00:00-05:00`);
    const dayEnd = new Date(dayStart.getTime() + 36 * 3600 * 1000);
    const posItems = await prisma.shopifyOrderItem.findMany({
      where: {
        designId: { in: designIds },
        order: { sourceName: "pos", OR: [
          { orderDate: { gte: dayStart, lte: dayEnd } },
          { orderDate: null, createdAt: { gte: dayStart, lte: dayEnd } },
        ] },
      },
      select: { designId: true, quantity: true, needsKit: true, order: { select: { orderDate: true, createdAt: true } } },
    });
    for (const i of posItems) {
      // Re-check the Eastern day: the window above is deliberately wide so the
      // query stays index-friendly, then filtered exactly here.
      if (posDayKey(i.order.orderDate ?? i.order.createdAt) !== day) continue;
      const e = posByDesign.get(i.designId!) ?? { designId: i.designId!, units: 0, kits: 0 };
      e.units += i.quantity;
      if (i.needsKit) e.kits += i.quantity;
      posByDesign.set(i.designId!, e);
    }
  }

  const posEvent = await prisma.posEvent.findUnique({ where: { day } });

  const discrepancies = eventDiscrepancies({
    event: {
      ttEventId: event.ttEventId, name: event.name, state: event.state,
      confirmedAt: event.confirmedAt, allowHistoricalConfirm: event.allowHistoricalConfirm,
    },
    tickets: planTickets,
    deductions,
    posEvent,
  });

  // Unmapped answers grouped, so one picker fixes every ticket that gave it.
  const unmappedAnswers = new Map<string, { answer: string; tickets: number }>();
  for (const t of plan.unmapped) {
    if (!t.canvasAnswer) continue;
    const key = t.canvasAnswer.toLowerCase().replace(/\s+/g, " ").trim();
    const e = unmappedAnswers.get(key) ?? { answer: t.canvasAnswer, tickets: 0 };
    e.tickets++;
    unmappedAnswers.set(key, e);
  }

  return NextResponse.json({
    event: {
      id: event.id, ttEventId: event.ttEventId, name: event.name, venueName: event.venueName,
      startsAt: event.startsAt.toISOString(), endsAt: event.endsAt?.toISOString() ?? null,
      timezone: event.timezone, ttStatus: event.ttStatus, state: event.state,
      allowHistoricalConfirm: event.allowHistoricalConfirm,
      confirmedAt: event.confirmedAt?.toISOString() ?? null,
      confirmLocation: event.confirmLocation, confirmDeductKits: event.confirmDeductKits,
      lastSyncedAt: event.lastSyncedAt?.toISOString() ?? null,
      posDay: day,
    },
    attendees: tickets.map((t) => ({
      ttTicketId: t.ttTicketId,
      attendeeName: t.attendeeName,
      orderNumber: t.order?.ttOrderId ?? null,
      orderStatus: t.order?.status ?? null,
      buyerName: t.order?.buyerName ?? null,
      canvasAnswer: t.canvasAnswer,
      resolveStatus: t.overrideDesignId ? "override" : t.resolveStatus,
      design: (t.overrideDesign ?? t.resolvedDesign) ?? null,
      overrideDesignId: t.overrideDesignId,
      overrideNote: t.overrideNote,
      needsKit: t.resolvedNeedsKit,
      voidedAt: t.voidedAt?.toISOString() ?? null,
      orderCancelled: isCancelled(t.order?.status),
      excludedAt: t.excludedAt?.toISOString() ?? null,
      excludedReason: t.excludedReason,
      ticketTypeName: t.ticketTypeName,
      listedPriceCents: t.listedPriceCents,
    })),
    toBring: plan.totals.map((t) => ({ ...t, stock: stockById.get(t.designId) ?? null })),
    plan: {
      totalCanvas: plan.totalCanvas, totalKits: plan.totalKits,
      unmapped: plan.unmapped.length, noAnswer: plan.noAnswer.length,
      ignored: plan.ignored.length, excluded: plan.excluded.length, masked: plan.masked.length,
    },
    unmappedAnswers: [...unmappedAnswers.values()].sort((a, b) => b.tickets - a.tickets),
    posOverlap: posOverlap(plan.totals, posByDesign),
    discrepancies,
    deductions: deductions.map((d) => ({
      id: d.id, ttTicketId: d.ttTicketId, designId: d.designId, designName: d.designName,
      location: d.location,
      kitsRequested: d.kitsRequested, kitsDeducted: d.kitsDeducted,
      canvasRequested: d.canvasRequested, canvasDeducted: d.canvasDeducted,
      canvasFromAndover: d.canvasFromAndover, kitsFromAndover: d.kitsFromAndover,
      skippedForPos: d.skippedForPos,
      reversedAt: d.reversedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
    revenueCents: await orderRevenue(event.ttEventId),
  });
}

/** No cancelled order has ever been observed, so this stays deliberately
 *  broad and the per-ticket voidedAt remains the real authority. */
function isCancelled(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "cancelled" || s === "canceled" || s === "refunded" || s === "voided";
}

async function orderRevenue(ttEventId: string): Promise<number> {
  const agg = await prisma.ticketTailorOrder.aggregate({
    where: { ttEventId },
    _sum: { totalCents: true, refundCents: true },
  });
  return (agg._sum.totalCents ?? 0) - (agg._sum.refundCents ?? 0);
}

/** PATCH — unlock a historical event for confirmation, nothing else. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const event = await prisma.ticketTailorEvent.findFirst({ where: { OR: [{ id }, { ttEventId: id }] } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  /**
   * Leave out every ticket that has no canvas answer, in one go.
   *
   * For an event that is over and cannot be fixed: Publico sold 81 tickets
   * while the canvas question was briefly not required, so 20 have no answer
   * and never will. Only touches tickets with NO answer — an unmapped answer is
   * still a real question, since mapping it helps every future event.
   */
  if (body.excludeUnanswered === true) {
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : "Canvas choice was not required at the time";
    const result = await prisma.ticketTailorTicket.updateMany({
      where: { ttEventId: event.ttEventId, resolveStatus: "no_answer", excludedAt: null },
      data: { excludedAt: new Date(), excludedReason: reason },
    });
    return NextResponse.json({ excluded: result.count, reason });
  }

  if (typeof body.allowHistoricalConfirm === "boolean") {
    const updated = await prisma.ticketTailorEvent.update({
      where: { id: event.id },
      data: { allowHistoricalConfirm: body.allowHistoricalConfirm },
    });
    return NextResponse.json({ allowHistoricalConfirm: updated.allowHistoricalConfirm });
  }
  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}

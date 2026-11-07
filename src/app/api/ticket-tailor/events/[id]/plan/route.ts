import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { kitStockOf, KIT_GROUP_INCLUDE } from "@/lib/kit-pool";
import { posDayKey } from "@/lib/pos-events";
import { buildDeductionPlan, posOverlap, type PlanTicket } from "@/lib/ticket-tailor/plan";
import { drawFrom } from "@/lib/stock-draw";

export const dynamic = "force-dynamic";

/**
 * GET /api/ticket-tailor/events/[id]/plan?location=market&deductKits=true
 *
 * Exactly what pressing Confirm would do, including where each unit would come
 * from and whether anything would run short — so the owners see the outcome
 * before the stock moves, not after.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location") === "home" ? "home" : "market";
  const deductKitsToo = searchParams.get("deductKits") !== "false";
  const skipDesignIds = (searchParams.get("skip") ?? "").split(",").filter(Boolean);

  const event = await prisma.ticketTailorEvent.findFirst({ where: { OR: [{ id }, { ttEventId: id }] } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const tickets = await prisma.ticketTailorTicket.findMany({
    where: { ttEventId: event.ttEventId },
    include: {
      resolvedDesign: { select: { id: true, name: true } },
      overrideDesign: { select: { id: true, name: true } },
      order: { select: { status: true } },
    },
  });

  const planTickets: PlanTicket[] = tickets.map((t) => {
    const design = t.overrideDesign ?? t.resolvedDesign;
    const s = (t.order?.status ?? "").toLowerCase();
    return {
      ttTicketId: t.ttTicketId, attendeeName: t.attendeeName, canvasAnswer: t.canvasAnswer,
      designId: design?.id ?? null, designName: design?.name ?? null,
      needsKit: t.resolvedNeedsKit,
      status: (t.overrideDesignId ? "override" : t.resolveStatus) as PlanTicket["status"],
      masked: !!t.canvasAnswer && /^\*+$/.test(t.canvasAnswer.trim()),
      voided: !!t.voidedAt,
      orderCancelled: ["cancelled", "canceled", "refunded", "voided"].includes(s),
    };
  });

  const plan = buildDeductionPlan(planTickets, { deductKits: deductKitsToo, skipDesignIds });

  const designIds = [...new Set(plan.totals.map((t) => t.designId))];
  const designs = designIds.length ? await prisma.design.findMany({
    where: { id: { in: designIds } },
    select: {
      id: true, name: true,
      canvasPrinted: true, marketCanvasPrinted: true, canvasAndover: true,
      kitsReady: true, marketKitsReady: true, kitsAndover: true,
      kitGroupId: true, ...KIT_GROUP_INCLUDE,
    },
  }) : [];

  // Where each design's units would actually come from, and what would fall
  // short. Computed with the same drawFrom the deduction uses, so the preview
  // cannot disagree with the outcome.
  const lines = plan.totals.map((tot) => {
    const d = designs.find((x) => x.id === tot.designId);
    if (!d) return { ...tot, canvasDraw: null, kitDraw: null };
    const kits = kitStockOf(d);
    const canvasPrimary = location === "home" ? d.canvasPrinted : d.marketCanvasPrinted;
    const kitPrimary = location === "home" ? kits.home : kits.market;
    return {
      ...tot,
      stock: {
        canvasHome: d.canvasPrinted, canvasMarket: d.marketCanvasPrinted, canvasAndover: d.canvasAndover,
        kitsHome: kits.home, kitsMarket: kits.market, kitsAndover: kits.andover,
        kitPool: kits.shared ? { name: kits.groupName, members: kits.memberCount } : null,
      },
      canvasDraw: drawFrom(tot.canvas, canvasPrimary, d.canvasAndover),
      kitDraw: tot.kits > 0 ? drawFrom(tot.kits, kitPrimary, kits.andover) : null,
    };
  });

  const day = posDayKey(event.startsAt);
  const posByDesign = new Map<string, { designId: string; units: number; kits: number }>();
  if (designIds.length) {
    const from = new Date(`${day}T00:00:00-05:00`);
    const to = new Date(from.getTime() + 36 * 3600 * 1000);
    const items = await prisma.shopifyOrderItem.findMany({
      where: {
        designId: { in: designIds },
        order: { sourceName: "pos", OR: [
          { orderDate: { gte: from, lte: to } },
          { orderDate: null, createdAt: { gte: from, lte: to } },
        ] },
      },
      select: { designId: true, quantity: true, needsKit: true, order: { select: { orderDate: true, createdAt: true } } },
    });
    for (const i of items) {
      if (posDayKey(i.order.orderDate ?? i.order.createdAt) !== day) continue;
      const e = posByDesign.get(i.designId!) ?? { designId: i.designId!, units: 0, kits: 0 };
      e.units += i.quantity; if (i.needsKit) e.kits += i.quantity;
      posByDesign.set(i.designId!, e);
    }
  }

  // Anything that must be dealt with before the button can be pressed.
  const blockers: string[] = [];
  if (event.state === "confirmed") blockers.push("This event is already confirmed.");
  if (event.state === "historical" && !event.allowHistoricalConfirm) {
    blockers.push("This event is historical — its canvases were already taken out by hand. Unlock it to confirm anyway.");
  }
  if (plan.masked.length) blockers.push(`${plan.masked.length} tickets have a hidden answer ("****") — the API key cannot read customer data.`);
  if (plan.unmapped.length) blockers.push(`${plan.unmapped.length} tickets picked a canvas that is not mapped to a design.`);
  if (plan.noAnswer.length) blockers.push(`${plan.noAnswer.length} tickets have no canvas answer — set one or leave them out.`);

  return NextResponse.json({
    location, deductKits: deductKitsToo,
    totalCanvas: plan.totalCanvas, totalKits: plan.totalKits,
    lines,
    skipped: plan.skipped,
    counts: {
      unmapped: plan.unmapped.length, noAnswer: plan.noAnswer.length,
      ignored: plan.ignored.length, excluded: plan.excluded.length, masked: plan.masked.length,
    },
    posOverlap: posOverlap(plan.totals, posByDesign),
    posDay: day,
    blockers,
    canConfirm: blockers.length === 0 && plan.lines.length > 0,
  });
}

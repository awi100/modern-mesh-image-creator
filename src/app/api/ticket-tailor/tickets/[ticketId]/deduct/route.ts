import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { lockOrder, lockDesigns } from "@/lib/order-lock";
import { deductKits, lockKitGroups } from "@/lib/kit-group";
import { deductCanvas } from "@/lib/canvas-stock";

export const dynamic = "force-dynamic";

/**
 * POST /api/ticket-tailor/tickets/[ticketId]/deduct
 *
 * Deduct one ticket that arrived after the event was confirmed — a late signup,
 * or a ticket whose canvas was identified only afterwards.
 *
 * Uses the options the event was confirmed with, so a late ticket comes out of
 * the same place as the rest rather than wherever the defaults currently point.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { ticketId } = await params;

  const ticket = await prisma.ticketTailorTicket.findFirst({
    where: { OR: [{ id: ticketId }, { ttTicketId: ticketId }] },
    include: {
      resolvedDesign: { select: { id: true, name: true } },
      overrideDesign: { select: { id: true, name: true } },
      order: { select: { status: true } },
      event: { select: { state: true, confirmLocation: true, confirmDeductKits: true } },
    },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const design = ticket.overrideDesign ?? ticket.resolvedDesign;
  if (!design) {
    return NextResponse.json({ error: "This ticket has no design yet — map its answer or set an override first." }, { status: 409 });
  }
  if (ticket.voidedAt) {
    return NextResponse.json({ error: "This ticket is voided; deducting it would take stock for a sale that was undone." }, { status: 409 });
  }
  if ((ticket.order?.status ?? "").toLowerCase() === "cancelled") {
    return NextResponse.json({ error: "This ticket's order was cancelled." }, { status: 409 });
  }
  if (ticket.event.state !== "confirmed") {
    return NextResponse.json(
      { error: "This event has not been confirmed yet — deduct the whole event instead of one ticket." },
      { status: 409 },
    );
  }

  // The options the event was confirmed with, so a late ticket matches the rest.
  const location = ticket.event.confirmLocation === "market" ? "market" : "home";
  const wantKits = ticket.event.confirmDeductKits && ticket.resolvedNeedsKit ? 1 : 0;

  const result = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, `tt-event:${ticket.ttEventId}`);

    // Already deducted? Another tab, or a double press.
    const existing = await tx.ticketTailorDeduction.findFirst({
      where: { ttTicketId: ticket.ttTicketId, reversedAt: null },
    });
    if (existing) return { already: true as const };

    await lockDesigns(tx, [design.id]);
    const group = await tx.design.findUnique({ where: { id: design.id }, select: { kitGroupId: true } });
    await lockKitGroups(tx, group?.kitGroupId ? [group.kitGroupId] : []);

    const canvas = await deductCanvas(tx, design.id, location, 1);
    const kit = wantKits > 0 ? await deductKits(tx, design.id, location, wantKits) : { deducted: 0, fromAndover: 0 };

    await tx.ticketTailorDeduction.create({
      data: {
        ttTicketId: ticket.ttTicketId, ttEventId: ticket.ttEventId,
        designId: design.id, designName: design.name, location,
        canvasRequested: 1, canvasDeducted: canvas.deducted, canvasFromAndover: canvas.fromAndover,
        kitsRequested: wantKits, kitsDeducted: kit.deducted, kitsFromAndover: kit.fromAndover,
        skippedForPos: false,
      },
    });

    return { already: false as const, canvas: canvas.deducted, kits: kit.deducted, short: canvas.short, designName: design.name };
  }, { timeout: 30000 });

  if (result.already) {
    return NextResponse.json({ error: "This ticket has already been deducted." }, { status: 409 });
  }
  return NextResponse.json({ deducted: true, ...result });
}

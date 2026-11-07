import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { lockOrder, lockDesigns } from "@/lib/order-lock";
import { restoreKits, lockKitGroups } from "@/lib/kit-group";
import { restoreCanvas } from "@/lib/canvas-stock";

export const dynamic = "force-dynamic";

/**
 * POST /api/ticket-tailor/tickets/[ticketId]/restore
 *
 * Put one ticket's canvas and kit back — the case where somebody voids or
 * refunds after the event was already confirmed.
 *
 * Deliberately NOT automatic. A void arriving by webhook is reported as a
 * discrepancy and left for a person, because the canvas may well have gone home
 * with the attendee: the money came back, the canvas did not. Restoring then
 * would invent stock.
 *
 * Replays the audit row rather than recomputing from the ticket, so the Andover
 * split is honoured and a design renamed or re-overridden since does not change
 * what goes back.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { ticketId } = await params;

  const ticket = await prisma.ticketTailorTicket.findFirst({
    where: { OR: [{ id: ticketId }, { ttTicketId: ticketId }] },
    select: { ttTicketId: true, ttEventId: true, attendeeName: true },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, `tt-event:${ticket.ttEventId}`);

    const rows = await tx.ticketTailorDeduction.findMany({
      where: { ttTicketId: ticket.ttTicketId, reversedAt: null, skippedForPos: false },
    });
    if (rows.length === 0) return { restored: false as const };

    const designIds = [...new Set(rows.map((r) => r.designId).filter(Boolean) as string[])];
    await lockDesigns(tx, designIds.sort());
    await lockKitGroups(tx, (
      await tx.design.findMany({ where: { id: { in: designIds }, kitGroupId: { not: null } }, select: { kitGroupId: true } })
    ).map((d) => d.kitGroupId!));

    let canvas = 0, kits = 0;
    for (const r of rows) {
      if (!r.designId) continue;
      const loc = r.location === "market" ? "market" : "home";
      await restoreCanvas(tx, r.designId, loc, r.canvasDeducted, r.canvasFromAndover);
      await restoreKits(tx, r.designId, loc, r.kitsDeducted, r.kitsFromAndover);
      canvas += r.canvasDeducted;
      kits += r.kitsDeducted;
    }
    await tx.ticketTailorDeduction.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { reversedAt: new Date() },
    });
    return { restored: true as const, canvas, kits, designName: rows[0].designName };
  }, { timeout: 30000 });

  if (!result.restored) {
    return NextResponse.json(
      { error: "Nothing to restore — this ticket has no live deduction." },
      { status: 409 },
    );
  }
  return NextResponse.json(result);
}

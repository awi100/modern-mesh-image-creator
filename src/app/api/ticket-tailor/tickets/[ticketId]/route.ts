import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { mappingsByKey, resolveTicket } from "@/lib/ticket-tailor/resolve";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/ticket-tailor/tickets/[ticketId]
 *
 * Override one attendee's canvas — somebody swapped at the table. The original
 * answer is never touched: it is the only evidence of what was picked at
 * checkout, and the difference is what the event page shows.
 *
 * Body: { overrideDesignId: string | null, overrideNote?: string }
 * Sending null clears the override and falls back to the mapping.
 *
 * This moves no stock. If the event is already confirmed the page reports the
 * mismatch as a discrepancy, so a person decides whether to restore the old
 * design and deduct the new one.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { ticketId } = await params;
  const body = await request.json().catch(() => ({}));

  const ticket = await prisma.ticketTailorTicket.findFirst({
    where: { OR: [{ id: ticketId }, { ttTicketId: ticketId }] },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  // Leave this ticket out, or put it back in play. Separate from an override:
  // excluding says "this one will never have a canvas", not "it has a
  // different one".
  if (typeof body.excluded === "boolean") {
    const updated = await prisma.ticketTailorTicket.update({
      where: { id: ticket.id },
      data: {
        excludedAt: body.excluded ? new Date() : null,
        excludedReason: body.excluded
          ? (typeof body.excludedReason === "string" && body.excludedReason.trim()
              ? body.excludedReason.trim().slice(0, 500)
              : "No canvas recorded")
          : null,
      },
    });
    return NextResponse.json({
      ttTicketId: updated.ttTicketId,
      excludedAt: updated.excludedAt,
      excludedReason: updated.excludedReason,
    });
  }

  const raw = body.overrideDesignId;
  const overrideDesignId = raw === null || raw === "" ? null : typeof raw === "string" ? raw : undefined;
  if (overrideDesignId === undefined) {
    return NextResponse.json({ error: "overrideDesignId must be a design id or null" }, { status: 400 });
  }

  if (overrideDesignId) {
    // Any live design, either mesh — picks span 13ct intro kits and 18ct
    // canvases alike.
    const design = await prisma.design.findFirst({
      where: { id: overrideDesignId, deletedAt: null },
      select: { id: true },
    });
    if (!design) return NextResponse.json({ error: "No such design" }, { status: 400 });
  }

  const note = typeof body.overrideNote === "string" && body.overrideNote.trim()
    ? body.overrideNote.trim().slice(0, 500)
    : null;

  // Re-resolve immediately so the row never sits in a stale state between the
  // write and the next sync.
  const byKey = mappingsByKey(await prisma.ticketTailorCanvasMapping.findMany());
  const r = resolveTicket(
    {
      canvasAnswer: ticket.canvasAnswer,
      answerKey: ticket.answerKey,
      answerMasked: !!ticket.canvasAnswer && /^\*+$/.test(ticket.canvasAnswer.trim()),
      overrideDesignId,
    },
    byKey,
  );

  const updated = await prisma.ticketTailorTicket.update({
    where: { id: ticket.id },
    data: {
      overrideDesignId,
      overrideNote: overrideDesignId ? note : null,
      resolveStatus: r.status,
      resolvedDesignId: r.designId,
      resolvedNeedsKit: r.needsKit,
    },
    include: { resolvedDesign: { select: { id: true, name: true, meshCount: true } } },
  });

  return NextResponse.json({
    ttTicketId: updated.ttTicketId,
    resolveStatus: updated.resolveStatus,
    design: updated.resolvedDesign,
    overrideDesignId: updated.overrideDesignId,
  });
}

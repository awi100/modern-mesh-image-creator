import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { lockOrder, lockDesigns } from "@/lib/order-lock";
import { deductKits, restoreKits, lockKitGroups } from "@/lib/kit-group";
import { deductCanvas, restoreCanvas } from "@/lib/canvas-stock";
import { posDayKey } from "@/lib/pos-events";
import { buildDeductionPlan, type PlanTicket } from "@/lib/ticket-tailor/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Deducting an event's canvases and kits.
 *
 * This is the ONLY place in the Ticket Tailor integration that moves stock, and
 * it runs only when someone presses the button after physically pulling the
 * canvases. Syncing and webhooks never touch a count.
 *
 * Confirming twice is impossible: the state re-check happens inside the locked
 * transaction, so a double click, two tabs, or two people at once all end with
 * one deduction and a clear "already confirmed".
 */

type Location = "home" | "market";

async function loadEvent(id: string) {
  return prisma.ticketTailorEvent.findFirst({ where: { OR: [{ id }, { ttEventId: id }] } });
}

/** Tickets in the shape the planner wants, with overrides already applied. */
async function planTicketsFor(ttEventId: string): Promise<PlanTicket[]> {
  const tickets = await prisma.ticketTailorTicket.findMany({
    where: { ttEventId },
    include: {
      resolvedDesign: { select: { id: true, name: true } },
      overrideDesign: { select: { id: true, name: true } },
      order: { select: { status: true } },
    },
  });
  return tickets.map((t) => {
    const design = t.overrideDesign ?? t.resolvedDesign;
    const s = (t.order?.status ?? "").toLowerCase();
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
      orderCancelled: ["cancelled", "canceled", "refunded", "voided"].includes(s),
    };
  });
}

/**
 * POST — deduct.
 *
 * Body: { location, deductKits, skipDesignIds, acknowledgePosOverlap }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  // Sip-and-stitch canvases always come from HOME, falling back to Andover.
  // The market tote is physically for craft markets, so an event never draws on
  // it — there is no UI choice, and `location` is only read so an old or
  // scripted request is not silently reinterpreted.
  const location: Location = body.location === "market" ? "market" : "home";
  const deductKitsToo = body.deductKits !== false;
  const skipDesignIds: string[] = Array.isArray(body.skipDesignIds)
    ? body.skipDesignIds.filter((x: unknown) => typeof x === "string")
    : [];

  const event = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.state === "confirmed") {
    return NextResponse.json(
      { error: `Already confirmed on ${event.confirmedAt?.toISOString().slice(0, 10)}. Undo it first if you need to redo it.` },
      { status: 409 },
    );
  }
  if (event.state === "historical" && !event.allowHistoricalConfirm) {
    return NextResponse.json(
      { error: "This event started before automatic deduction existed, so its canvases were already taken out by hand. Unlock it first if you are sure." },
      { status: 409 },
    );
  }

  const tickets = await planTicketsFor(event.ttEventId);
  const plan = buildDeductionPlan(tickets, { deductKits: deductKitsToo, skipDesignIds });

  // An unidentified pick blocks the whole event: deducting around it would
  // quietly understate what left the shelf.
  if (plan.unmapped.length || plan.noAnswer.length) {
    return NextResponse.json({
      error: "Some tickets still have no design",
      unmapped: plan.unmapped.length,
      noAnswer: plan.noAnswer.length,
      hint: "Map each answer, override the ticket, or mark the answer as not a canvas.",
    }, { status: 409 });
  }
  if (plan.lines.length === 0 && plan.skipped.length === 0) {
    return NextResponse.json({ error: "Nothing to deduct" }, { status: 409 });
  }

  const designIds = [...new Set([...plan.lines, ...plan.skipped.map((s) => ({ designId: s.designId }))].map((l) => l.designId))];

  const result = await prisma.$transaction(async (tx) => {
    // FIRST statement, as in every Shopify path: a check taken before the lock
    // is still a race. Keyed per event, so events selling at the same time
    // confirm independently.
    await lockOrder(tx, `tt-event:${event.ttEventId}`);

    // Re-read inside the lock. This is what makes a second click safe.
    const fresh = await tx.ticketTailorEvent.findUnique({ where: { id: event.id } });
    if (!fresh || fresh.state === "confirmed") {
      return { alreadyConfirmed: true as const };
    }

    await lockDesigns(tx, [...designIds].sort());
    const groupIds = (
      await tx.design.findMany({
        where: { id: { in: designIds }, kitGroupId: { not: null } },
        select: { kitGroupId: true },
      })
    ).map((d) => d.kitGroupId!);
    await lockKitGroups(tx, groupIds);

    const rows: {
      ttTicketId: string; designId: string; designName: string | null;
      canvasRequested: number; canvasDeducted: number; canvasFromAndover: number;
      kitsRequested: number; kitsDeducted: number; kitsFromAndover: number;
      skippedForPos: boolean;
    }[] = [];

    for (const line of plan.lines) {
      const canvas = await deductCanvas(tx, line.designId, location, line.canvas);
      const kit = line.kits > 0
        ? await deductKits(tx, line.designId, location, line.kits)
        : { deducted: 0, fromAndover: 0 };
      rows.push({
        ttTicketId: line.ttTicketId, designId: line.designId, designName: line.designName,
        canvasRequested: line.canvas, canvasDeducted: canvas.deducted, canvasFromAndover: canvas.fromAndover,
        kitsRequested: line.kits, kitsDeducted: kit.deducted, kitsFromAndover: kit.fromAndover,
        skippedForPos: false,
      });
    }

    // Skipped designs still get a row, with nothing deducted, so the decision
    // is on the record rather than invisible.
    const skippedTickets = tickets.filter((t) => t.designId && skipDesignIds.includes(t.designId) && !t.voided && !t.orderCancelled);
    for (const t of skippedTickets) {
      rows.push({
        ttTicketId: t.ttTicketId, designId: t.designId!, designName: t.designName ?? null,
        canvasRequested: 1, canvasDeducted: 0, canvasFromAndover: 0,
        kitsRequested: deductKitsToo && t.needsKit ? 1 : 0, kitsDeducted: 0, kitsFromAndover: 0,
        skippedForPos: true,
      });
    }

    await tx.ticketTailorDeduction.createMany({
      data: rows.map((r) => ({ ...r, ttEventId: event.ttEventId, location })),
    });

    await tx.ticketTailorEvent.update({
      where: { id: event.id },
      data: { state: "confirmed", confirmedAt: new Date(), confirmLocation: location, confirmDeductKits: deductKitsToo },
    });

    // Mark the day a sip-and-stitch so the craft-market packing list stops
    // counting it. A day already classified as something else is left alone and
    // reported as a discrepancy instead.
    const day = posDayKey(event.startsAt);
    const existingDay = await tx.posEvent.findUnique({ where: { day } });
    if (!existingDay) {
      await tx.posEvent.create({ data: { day, kind: "sip_and_stitch", name: event.name } });
    }

    return { alreadyConfirmed: false as const, rows, location };
  }, { timeout: 30000 });

  if (result.alreadyConfirmed) {
    return NextResponse.json({ error: "Already confirmed by another request" }, { status: 409 });
  }

  const canvasDeducted = result.rows.reduce((s, r) => s + r.canvasDeducted, 0);
  const kitsDeducted = result.rows.reduce((s, r) => s + r.kitsDeducted, 0);
  const short = result.rows.filter((r) => !r.skippedForPos &&
    (r.canvasDeducted < r.canvasRequested || r.kitsDeducted < r.kitsRequested));

  return NextResponse.json({
    confirmed: true,
    location: result.location,
    canvasDeducted,
    kitsDeducted,
    tickets: result.rows.filter((r) => !r.skippedForPos).length,
    skipped: result.rows.filter((r) => r.skippedForPos).length,
    shortLines: short.length,
  });
}

/**
 * DELETE — undo the whole confirmation.
 *
 * Replays the audit rows rather than recomputing from the tickets, exactly as
 * the Shopify undo does: what was actually deducted is the only safe basis for
 * putting it back, and it carries the Andover split so each unit returns where
 * it came from.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const event = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, `tt-event:${event.ttEventId}`);

    const rows = await tx.ticketTailorDeduction.findMany({
      where: { ttEventId: event.ttEventId, reversedAt: null },
    });
    if (rows.length === 0) return { restoredCanvas: 0, restoredKits: 0, rows: 0 };

    const designIds = [...new Set(rows.map((r) => r.designId).filter(Boolean) as string[])];
    await lockDesigns(tx, designIds.sort());
    await lockKitGroups(tx, (
      await tx.design.findMany({ where: { id: { in: designIds }, kitGroupId: { not: null } }, select: { kitGroupId: true } })
    ).map((d) => d.kitGroupId!));

    let restoredCanvas = 0, restoredKits = 0;
    for (const r of rows) {
      if (!r.designId || r.skippedForPos) continue;
      const loc = r.location === "home" ? "home" : "market";
      await restoreCanvas(tx, r.designId, loc, r.canvasDeducted, r.canvasFromAndover);
      await restoreKits(tx, r.designId, loc, r.kitsDeducted, r.kitsFromAndover);
      restoredCanvas += r.canvasDeducted;
      restoredKits += r.kitsDeducted;
    }

    await tx.ticketTailorDeduction.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { reversedAt: new Date() },
    });
    await tx.ticketTailorEvent.update({
      where: { id: event.id },
      data: { state: event.startsAt < new Date() ? "historical" : "open", confirmedAt: null },
    });

    return { restoredCanvas, restoredKits, rows: rows.length };
  }, { timeout: 30000 });

  return NextResponse.json({ undone: true, ...result });
}

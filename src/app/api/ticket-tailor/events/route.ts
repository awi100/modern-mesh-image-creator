import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

export const dynamic = "force-dynamic";

export interface EventListRow {
  id: string;
  ttEventId: string;
  name: string;
  venueName: string | null;
  startsAt: string;
  state: string;
  ttStatus: string | null;
  confirmedAt: string | null;
  allowHistoricalConfirm: boolean;
  tickets: number;
  liveTickets: number;
  voided: number;
  unmapped: number;
  noAnswer: number;
  masked: number;
  excluded: number;
  deducted: number;
  lastSyncedAt: string | null;
}

/**
 * GET /api/ticket-tailor/events
 *
 * Several events can be selling at once, so this is a list rather than a
 * "current event" — soonest first, with enough counts for the page to show
 * which ones need attention without a second request each.
 */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.ticketTailorEvent.findMany({
    orderBy: { startsAt: "desc" },
    include: {
      tickets: {
        select: { resolveStatus: true, voidedAt: true, canvasAnswer: true, excludedAt: true },
      },
    },
  });

  const deductionCounts = await prisma.ticketTailorDeduction.groupBy({
    by: ["ttEventId"],
    where: { reversedAt: null },
    _count: true,
  });
  const deductedBy = new Map(deductionCounts.map((d) => [d.ttEventId, d._count]));

  const rows: EventListRow[] = events.map((e) => {
    const live = e.tickets.filter((t) => !t.voidedAt);
    // Excluded tickets are a closed question, so they must not keep an event
    // reading "needs attention" forever.
    const open = live.filter((t) => !t.excludedAt);
    return {
      id: e.id,
      ttEventId: e.ttEventId,
      name: e.name,
      venueName: e.venueName,
      startsAt: e.startsAt.toISOString(),
      state: e.state,
      ttStatus: e.ttStatus,
      confirmedAt: e.confirmedAt?.toISOString() ?? null,
      allowHistoricalConfirm: e.allowHistoricalConfirm,
      tickets: e.tickets.length,
      liveTickets: live.length,
      voided: e.tickets.length - live.length,
      unmapped: open.filter((t) => t.resolveStatus === "unmapped").length,
      noAnswer: open.filter((t) => t.resolveStatus === "no_answer").length,
      // A masked answer is a key-permission failure, not a mapping gap.
      masked: open.filter((t) => !!t.canvasAnswer && /^\*+$/.test(t.canvasAnswer.trim())).length,
      excluded: live.length - open.length,
      deducted: deductedBy.get(e.ttEventId) ?? 0,
      lastSyncedAt: e.lastSyncedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json(rows);
}

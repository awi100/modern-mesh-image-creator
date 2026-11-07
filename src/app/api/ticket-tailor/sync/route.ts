import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";
import { syncEvent, syncRecent } from "@/lib/ticket-tailor/sync";

export const dynamic = "force-dynamic";
/** A full sync is a few dozen sequential API calls; the Vercel default of 10s
 *  is not enough. */
export const maxDuration = 60;

/**
 * POST /api/ticket-tailor/sync
 *
 * Body: {} for everything recent and upcoming, or { eventId } for one event.
 *
 * This moves no stock — it only mirrors Ticket Tailor and re-resolves picks.
 * The project has no scheduler, so this is the manual equivalent of the Shopify
 * reconcile button on /shopify.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.TICKET_TAILOR_API_KEY) {
    return NextResponse.json({ error: "TICKET_TAILOR_API_KEY is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const eventId = typeof body?.eventId === "string" ? body.eventId : null;

  try {
    const result = eventId ? await syncEvent(eventId) : await syncRecent();
    if (result.masked > 0) {
      console.error(
        `Ticket Tailor sync: ${result.masked} tickets came back with masked answers — ` +
        `the API key cannot read customer data.`,
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[ticket-tailor sync]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 },
    );
  }
}

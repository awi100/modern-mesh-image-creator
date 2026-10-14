import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { EVENT_KINDS, type EventKind, posDayKey as dayKey } from "@/lib/pos-events";

/**
 * Every day we sold in person, with how it's classified.
 *
 * POS orders can't distinguish a craft market from a sip-and-stitch at a
 * restaurant — both arrive from Shopify with source_name = "pos". The days are
 * derived from the orders themselves (so a new one appears the moment it syncs)
 * and the classification is stored separately in pos_events. A day with no row
 * counts as a market, so only the exceptions need touching.
 */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const orders = await prisma.shopifyOrder.findMany({
      where: { sourceName: { equals: "pos", mode: "insensitive" }, fulfilledAt: { not: null } },
      select: {
        orderDate: true,
        createdAt: true,
        items: { where: { processed: true }, select: { quantity: true, designId: true, supplyId: true } },
      },
    });

    const byDay = new Map<string, { orders: number; units: number; designUnits: number; supplyUnits: number }>();
    for (const o of orders) {
      const k = dayKey(o.orderDate ?? o.createdAt);
      const e = byDay.get(k) ?? { orders: 0, units: 0, designUnits: 0, supplyUnits: 0 };
      e.orders += 1;
      for (const i of o.items) {
        e.units += i.quantity;
        if (i.designId) e.designUnits += i.quantity;
        if (i.supplyId) e.supplyUnits += i.quantity;
      }
      byDay.set(k, e);
    }

    const rows = await prisma.posEvent.findMany();
    const classified = new Map(rows.map((r) => [r.day, r]));

    const days = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest first
      .map(([day, stats]) => {
        const ev = classified.get(day);
        return {
          day,
          weekday: new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
          kind: (ev?.kind ?? "market") as EventKind,
          name: ev?.name ?? null,
          classified: !!ev, // false = defaulted to market, never explicitly set
          ...stats,
        };
      });

    return NextResponse.json({
      days,
      summary: {
        total: days.length,
        markets: days.filter((d) => d.kind === "market").length,
        excluded: days.filter((d) => d.kind !== "market").length,
      },
    });
  } catch (error) {
    console.error("Error fetching POS events:", error);
    return NextResponse.json({ error: "Failed to fetch POS events" }, { status: 500 });
  }
}

/** Classify a day. { day: "YYYY-MM-DD", kind, name? } */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const day = String(body?.day ?? "");
    const kind = String(body?.kind ?? "");
    const name = body?.name === undefined || body?.name === null ? null : String(body.name).trim() || null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
    }
    if (!(EVENT_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: `kind must be one of ${EVENT_KINDS.join(", ")}` }, { status: 400 });
    }

    const saved = await prisma.posEvent.upsert({
      where: { day },
      update: { kind, name },
      create: { day, kind, name },
    });
    return NextResponse.json(saved);
  } catch (error) {
    console.error("Error saving POS event:", error);
    return NextResponse.json({ error: "Failed to save POS event" }, { status: 500 });
  }
}

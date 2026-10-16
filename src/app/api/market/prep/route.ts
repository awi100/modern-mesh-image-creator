import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { buildMarketPrep, parseBuffer } from "@/lib/market-prep";

/**
 * Market Prep: what to bring to the next market, and what's already in the
 * tote. All the judgement lives in lib/market-prep; this route is the query.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const buffer = parseBuffer(new URL(request.url).searchParams.get("buffer"));

    // Window by the REAL order date, not createdAt (which the schema documents
    // as our local sync time). These agree today because POS orders sync at the
    // till, but any bulk backfill of POS history would stamp every order with
    // one sync date, collapsing every market into a single event — and since
    // `recommended` scales off the busiest single market, that would tell you
    // to pack ~1.5x everything ever sold at a market.
    //
    // `processed` + `fulfilledAt` match inventory/velocity and
    // inventory/reorder: an order fulfilled and then undone keeps its line
    // items (undo only clears fulfilledAt and flips processed), so without
    // these filters it still counted toward the packing list, as did the
    // second row set left behind by a fulfil -> undo -> fulfil.
    const [orders, nonMarket, designs, supplies] = await Promise.all([
      prisma.shopifyOrder.findMany({
        where: {
          sourceName: { equals: "pos", mode: "insensitive" },
          fulfilledAt: { not: null },
        },
        select: {
          createdAt: true,
          orderDate: true,
          items: {
            where: { processed: true },
            select: { productTitle: true, quantity: true, designId: true, supplyId: true, needsKit: true },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.posEvent.findMany({ where: { kind: { not: "market" } }, select: { day: true } }),
      prisma.design.findMany({
        where: { deletedAt: null },
        select: {
          id: true, name: true, marketKitsReady: true, marketCanvasPrinted: true,
          kitsReady: true, canvasPrinted: true, archivedAt: true,
          kitsAndover: true, canvasAndover: true,
        },
      }),
      prisma.supply.findMany({
        select: { id: true, name: true, marketQuantity: true, quantity: true },
      }),
    ]);

    const nonMarketDays = new Set(nonMarket.map((e) => e.day));
    return NextResponse.json(buildMarketPrep(orders, nonMarketDays, designs, supplies, buffer));
  } catch (error) {
    console.error("Error building market prep:", error);
    return NextResponse.json({ error: "Failed to build market prep" }, { status: 500 });
  }
}

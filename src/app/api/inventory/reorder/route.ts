import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { meshCountWhere } from "@/lib/mesh-filter";

// Smart canvas reorder analysis.
//
// The decision is NOT "how many are left" — it's "will we run out before a new
// order can arrive". We measure each design's recent sales rate (units/week
// over a trailing window), divide the canvases on hand by that rate to get
// weeks-of-supply, and compare against the supplier lead time. A slow seller
// with few left can be fine (huge weeks-of-supply); a fast seller with plenty
// left can still need ordering now (runs out during the lead time).

const WINDOW_DAYS = 90; // trailing window for the sales-rate estimate
const DEFAULT_LEAD_WEEKS = 6; // orders take ~4-6 weeks to arrive; default to the safe end
const SAFETY_WEEKS = 2; // extra buffer beyond lead time before we're comfortable
const DEFAULT_TARGET_MONTHS = 6; // how long a reorder should last before ordering again
const WEEKS_PER_MONTH = 4.345;
// Below these we don't trust the rate enough to raise an urgent flag.
const MIN_UNITS_FOR_CONFIDENCE = 4;
const MIN_DAYS_FOR_CONFIDENCE = 21;

type ReorderStatus = "reorder_now" | "reorder_soon" | "ok" | "no_sales";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const leadWeeks = Math.min(16, Math.max(1, Number(url.searchParams.get("leadWeeks")) || DEFAULT_LEAD_WEEKS));
    // How long a reorder should last before we have to order again (months).
    const targetMonths = Math.min(24, Math.max(1, Number(url.searchParams.get("targetMonths")) || DEFAULT_TARGET_MONTHS));
    const targetCoverWeeks = Math.round(targetMonths * WEEKS_PER_MONTH);
    const meshWhere = meshCountWhere(url.searchParams.get("meshCount"));

    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const designs = await prisma.design.findMany({
      where: { deletedAt: null, archivedAt: null, notLiveAt: null, isDraft: false, printVersionOf: null, ...meshWhere },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        meshCount: true,
        createdAt: true,
        canvasPrinted: true,
        marketCanvasPrinted: true,
        canvasAndover: true,
        totalSold: true,
      },
    });

    // Units sold per design within the trailing window, from processed Shopify
    // orders (same source the velocity job uses). Order date = when it sold.
    const orders = await prisma.shopifyOrder.findMany({
      where: { createdAt: { gte: windowStart } },
      select: {
        createdAt: true,
        items: {
          where: { designId: { not: null } },
          select: { designId: true, quantity: true },
        },
      },
    });

    const soldInWindow = new Map<string, number>();
    for (const order of orders) {
      for (const item of order.items) {
        if (item.designId) {
          soldInWindow.set(item.designId, (soldInWindow.get(item.designId) || 0) + item.quantity);
        }
      }
    }

    const reorderPointWeeks = leadWeeks + SAFETY_WEEKS;

    const rows = designs.map((d) => {
      const onHand =
        d.canvasPrinted + (d.marketCanvasPrinted || 0) + (d.canvasAndover || 0);

      // Rate over the window, but never divide by more days than the design has
      // existed (so a 2-week-old design isn't averaged over 90 days).
      const ageDays = Math.max(1, (now.getTime() - d.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      const effectiveDays = Math.min(WINDOW_DAYS, ageDays);
      const units = soldInWindow.get(d.id) || 0;
      const weeklyVelocity = units / (effectiveDays / 7);

      const weeksOfSupply = weeklyVelocity > 0 ? onHand / weeklyVelocity : null; // null = effectively infinite
      const stockoutAt =
        weeksOfSupply !== null ? new Date(now.getTime() + weeksOfSupply * 7 * 24 * 60 * 60 * 1000) : null;

      const lowConfidence = units < MIN_UNITS_FOR_CONFIDENCE || effectiveDays < MIN_DAYS_FOR_CONFIDENCE;

      let status: ReorderStatus;
      if (weeklyVelocity <= 0 || weeksOfSupply === null) {
        status = "no_sales";
      } else if (weeksOfSupply <= leadWeeks) {
        status = "reorder_now";
      } else if (weeksOfSupply <= reorderPointWeeks) {
        status = "reorder_soon";
      } else {
        status = "ok";
      }

      // Order enough that, once it arrives (after the lead time), there's about
      // `targetMonths` of stock left — so you don't have to reorder again for
      // roughly that long. Covers sales during the lead time + the target cushion.
      const targetUnits = Math.ceil(weeklyVelocity * (leadWeeks + targetCoverWeeks));
      const suggestedQty = weeklyVelocity > 0 ? Math.max(0, targetUnits - onHand) : 0;

      return {
        id: d.id,
        name: d.name,
        previewImageUrl: d.previewImageUrl,
        meshCount: d.meshCount,
        onHand,
        here: d.canvasPrinted,
        market: d.marketCanvasPrinted || 0,
        andover: d.canvasAndover || 0,
        unitsInWindow: units,
        weeklyVelocity: Math.round(weeklyVelocity * 100) / 100,
        weeksOfSupply: weeksOfSupply === null ? null : Math.round(weeksOfSupply * 10) / 10,
        stockoutAt: stockoutAt ? stockoutAt.toISOString() : null,
        status,
        suggestedQty,
        lowConfidence,
        totalSold: d.totalSold,
      };
    });

    const statusOrder: Record<ReorderStatus, number> = { reorder_now: 0, reorder_soon: 1, ok: 2, no_sales: 3 };
    rows.sort((a, b) => {
      if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
      // Within a status, soonest to run out first; then fastest seller first
      // (so an out-of-stock best-seller outranks an out-of-stock slow mover).
      const wa = a.weeksOfSupply ?? Number.POSITIVE_INFINITY;
      const wb = b.weeksOfSupply ?? Number.POSITIVE_INFINITY;
      if (wa !== wb) return wa - wb;
      return b.weeklyVelocity - a.weeklyVelocity;
    });

    const summary = {
      total: rows.length,
      reorderNow: rows.filter((r) => r.status === "reorder_now").length,
      reorderSoon: rows.filter((r) => r.status === "reorder_soon").length,
      ok: rows.filter((r) => r.status === "ok").length,
      noSales: rows.filter((r) => r.status === "no_sales").length,
      leadWeeks,
      targetMonths,
      windowDays: WINDOW_DAYS,
      totalUnitsToOrder: rows.reduce((s, r) => s + (r.status === "reorder_now" || r.status === "reorder_soon" ? r.suggestedQty : 0), 0),
    };

    return NextResponse.json({ rows, summary });
  } catch (error) {
    console.error("Error building reorder analysis:", error);
    return NextResponse.json({ error: "Failed to build reorder analysis" }, { status: 500 });
  }
}

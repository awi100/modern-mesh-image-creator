import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { normalizeTitle } from "@/lib/shopify";

// Market Prep: recommend how many of each item to bring to the next market,
// from past Shopify POS sales. The goal is "don't sell out", so we size to the
// BUSIEST market day seen plus a safety buffer — not the average — because the
// sample is small and any day we actually sold out understates real demand.

type Buffer = "conservative" | "balanced" | "aggressive";
const FACTORS: Record<Buffer, number> = { conservative: 1.25, balanced: 1.5, aggressive: 2 };
const ONE_OFF: Record<Buffer, number> = { conservative: 1, balanced: 2, aggressive: 2 };

// Two POS days within this many days are treated as ONE market event (e.g. a
// Sat+Sun weekend). SoWa's weekly Sundays are 7 days apart → separate markets.
const SAME_MARKET_GAP_DAYS = 2;

function recommend(max: number, total: number, buffer: Buffer): number {
  if (total <= 1) return ONE_OFF[buffer];
  return Math.ceil(max * FACTORS[buffer]);
}

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const bufferParam = (url.searchParams.get("buffer") || "balanced") as Buffer;
    const buffer: Buffer = ["conservative", "balanced", "aggressive"].includes(bufferParam) ? bufferParam : "balanced";

    const orders = await prisma.shopifyOrder.findMany({
      where: { sourceName: { equals: "pos", mode: "insensitive" } },
      select: {
        createdAt: true,
        items: { select: { productTitle: true, quantity: true, designId: true, supplyId: true, needsKit: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Reference: current market-tote stock, so the packer can see how many more
    // to grab. Matched to POS product titles by normalized name.
    const [designs, supplies] = await Promise.all([
      prisma.design.findMany({
        where: { deletedAt: null },
        select: { name: true, marketKitsReady: true, marketCanvasPrinted: true },
      }),
      prisma.supply.findMany({ select: { name: true, marketQuantity: true } }),
    ]);
    const designTote = new Map<string, number>();
    for (const d of designs) designTote.set(normalizeTitle(d.name), (d.marketKitsReady || 0) + (d.marketCanvasPrinted || 0));
    const supplyTote = new Map<string, number>();
    for (const s of supplies) supplyTote.set(normalizeTitle(s.name), s.marketQuantity || 0);

    // Cluster POS order dates into market events.
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const distinctDays = [...new Set(orders.map((o) => dayKey(o.createdAt)))].sort();
    const marketOfDay = new Map<string, number>();
    const markets: { start: string; end: string; days: string[] }[] = [];
    for (const day of distinctDays) {
      const last = markets[markets.length - 1];
      const gap = last
        ? (new Date(day).getTime() - new Date(last.end).getTime()) / (24 * 60 * 60 * 1000)
        : Infinity;
      if (last && gap <= SAME_MARKET_GAP_DAYS) {
        last.end = day;
        last.days.push(day);
      } else {
        markets.push({ start: day, end: day, days: [day] });
      }
      marketOfDay.set(day, markets.length - 1);
    }
    const marketCount = markets.length;

    // Per item, sales per market event.
    interface ItemAgg {
      name: string;
      kind: "kit" | "canvas" | "supply" | "other";
      perMarket: number[];
      total: number;
    }
    const items = new Map<string, ItemAgg>();
    for (const o of orders) {
      const mIdx = marketOfDay.get(dayKey(o.createdAt))!;
      for (const it of o.items) {
        const name = it.productTitle;
        let agg = items.get(name);
        if (!agg) {
          const kind: ItemAgg["kind"] = it.supplyId ? "supply" : it.designId ? (it.needsKit ? "kit" : "canvas") : "other";
          agg = { name, kind, perMarket: new Array(marketCount).fill(0), total: 0 };
          items.set(name, agg);
        }
        // A kit line upgrades the kind (an item sold both ways reads as a kit).
        if (it.needsKit && agg.kind === "canvas") agg.kind = "kit";
        agg.perMarket[mIdx] += it.quantity;
        agg.total += it.quantity;
      }
    }

    const rows = [...items.values()].map((agg) => {
      const max = agg.perMarket.length ? Math.max(...agg.perMarket) : 0;
      const marketsSold = agg.perMarket.filter((q) => q > 0).length;
      const avgPerMarket = marketCount ? agg.total / marketCount : 0;
      const norm = normalizeTitle(agg.name);
      const inTote = designTote.has(norm) ? designTote.get(norm)! : supplyTote.has(norm) ? supplyTote.get(norm)! : null;
      return {
        name: agg.name,
        kind: agg.kind,
        perMarket: agg.perMarket,
        total: agg.total,
        max,
        marketsSold,
        avgPerMarket: Math.round(avgPerMarket * 10) / 10,
        recommended: recommend(max, agg.total, buffer),
        inTote,
      };
    });

    // Sort: biggest recommended bring first, then total sold.
    rows.sort((a, b) => b.recommended - a.recommended || b.total - a.total);

    const summary = {
      marketCount,
      itemCount: rows.length,
      totalUnitsToBring: rows.reduce((s, r) => s + r.recommended, 0),
      busiestDayUnits: markets.length
        ? Math.max(
            ...markets.map((_, i) => rows.reduce((s, r) => s + r.perMarket[i], 0))
          )
        : 0,
      buffer,
    };

    return NextResponse.json({
      rows,
      summary,
      markets: markets.map((m, i) => ({
        label: m.start === m.end ? m.start : `${m.start} – ${m.end}`,
        units: rows.reduce((s, r) => s + r.perMarket[i], 0),
      })),
    });
  } catch (error) {
    console.error("Error building market prep:", error);
    return NextResponse.json({ error: "Failed to build market prep" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { normalizeTitle } from "@/lib/shopify";
import { posDayKey } from "@/lib/pos-events";

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

/** UTC day key — shared so classifications line up with /api/market/events. */
const dayKeyUTC = posDayKey;

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

    // Window by the REAL order date, not createdAt (which the schema documents
    // as our local sync time). These agree today because POS orders sync at the
    // till, but any bulk backfill of POS history would stamp every order with
    // one sync date, collapsing every market into a single event — and since
    // `recommended` scales off the busiest single market, that would tell you to
    // pack ~1.5x everything ever sold at a market. inventory/velocity and
    // inventory/reorder already window this way.
    //
    // `processed` + `fulfilledAt` match those routes too: an order fulfilled and
    // then undone keeps its line items (undo only clears fulfilledAt and flips
    // processed), so without these filters it still counted toward the packing
    // list, as did the second row set left behind by a fulfil -> undo -> fulfil.
    const orders = await prisma.shopifyOrder.findMany({
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
    });
    // Legacy rows (pre-orderDate) fall back to sync time.
    const soldAt = (o: { orderDate: Date | null; createdAt: Date }) => o.orderDate ?? o.createdAt;

    // Drop days that weren't craft markets. Sip-and-stitch evenings at
    // restaurants also sell through Shopify POS, so they arrive here
    // indistinguishable from a market — but their sales say nothing about what
    // to pack in the market tote. A day with no pos_events row counts as a
    // market, so only the exceptions need classifying.
    const nonMarketDays = new Set(
      (await prisma.posEvent.findMany({ where: { kind: { not: "market" } }, select: { day: true } }))
        .map((e) => e.day)
    );
    const marketOrders = orders.filter((o) => !nonMarketDays.has(dayKeyUTC(soldAt(o))));

    // Reference: current market-tote stock, so the packer can see how many more
    // to grab. Matched to POS product titles by normalized name.
    const [designs, supplies] = await Promise.all([
      prisma.design.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, marketKitsReady: true, marketCanvasPrinted: true,
                  kitsReady: true, canvasPrinted: true },
      }),
      prisma.supply.findMany({ select: { id: true, name: true, marketQuantity: true, quantity: true } }),
    ]);
    // A design's tote stock is TWO numbers — canvases and kits — and they are
    // never summed. `inTote` used to be kits + canvases on the reasoning that a
    // POS line is one unit either way, which made 3 canvases + 3 kits read as
    // "6 in tote" next to a target that only ever counted canvases. Three
    // different Shamrock designs all showed 6 while holding 2+4, 4+2 and 3+3.
    // Design rows now carry no combined figure at all, so nothing can compare
    // one again; `inTote` is for supplies, which have no kit/canvas split.
    const designStock = new Map<string, {
      id: string; marketKits: number; marketCanvas: number; homeKits: number; homeCanvas: number;
    }>();
    for (const d of designs) {
      const key = normalizeTitle(d.name);
      designStock.set(key, {
        id: d.id,
        marketKits: d.marketKitsReady || 0, marketCanvas: d.marketCanvasPrinted || 0,
        homeKits: d.kitsReady || 0, homeCanvas: d.canvasPrinted || 0,
      });
    }
    const supplyTote = new Map<string, number>();
    const supplyStock = new Map<string, { id: string; market: number; home: number }>();
    for (const s of supplies) {
      const key = normalizeTitle(s.name);
      supplyTote.set(key, s.marketQuantity || 0);
      supplyStock.set(key, { id: s.id, market: s.marketQuantity || 0, home: s.quantity || 0 });
    }

    // Cluster POS order dates into market events.
    const dayKey = dayKeyUTC;
    const distinctDays = [...new Set(marketOrders.map((o) => dayKey(soldAt(o))))].sort();
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
      designId: string | null;
      perMarket: number[];
      total: number;
      // Every sale needs a printed canvas; only a "+ kit" sale also needs an
      // assembled thread kit. Tracked apart so the packing list can say how
      // many of EACH to put in the tote, which is what you actually carry.
      perMarketKit: number[];
      totalKit: number;
    }
    const items = new Map<string, ItemAgg>();
    for (const o of marketOrders) {
      const mIdx = marketOfDay.get(dayKey(soldAt(o)))!;
      for (const it of o.items) {
        const name = it.productTitle;
        let agg = items.get(name);
        if (!agg) {
          const kind: ItemAgg["kind"] = it.supplyId ? "supply" : it.designId ? (it.needsKit ? "kit" : "canvas") : "other";
          agg = { name, kind, designId: it.designId ?? null, perMarket: new Array(marketCount).fill(0), total: 0,
                  perMarketKit: new Array(marketCount).fill(0), totalKit: 0 };
          items.set(name, agg);
        }
        // A kit line upgrades the kind (an item sold both ways reads as a kit).
        if (it.needsKit && agg.kind === "canvas") agg.kind = "kit";
        if (!agg.designId && it.designId) agg.designId = it.designId;
        agg.perMarket[mIdx] += it.quantity;
        agg.total += it.quantity;
        if (it.needsKit) {
          agg.perMarketKit[mIdx] += it.quantity;
          agg.totalKit += it.quantity;
        }
      }
    }

    const rows = [...items.values()].map((agg) => {
      const max = agg.perMarket.length ? Math.max(...agg.perMarket) : 0;
      const marketsSold = agg.perMarket.filter((q) => q > 0).length;
      const avgPerMarket = marketCount ? agg.total / marketCount : 0;
      const norm = normalizeTitle(agg.name);
      // Supplies only — a design's tote stock is reported split, below.
      const inTote = designStock.has(norm) ? null : supplyTote.get(norm) ?? null;
      return {
        name: agg.name,
        kind: agg.kind,
        designId: agg.designId,
        perMarket: agg.perMarket,
        total: agg.total,
        max,
        marketsSold,
        avgPerMarket: Math.round(avgPerMarket * 10) / 10,
        recommended: recommend(max, agg.total, buffer),
        inTote,
        // Split packing figures. canvas = every unit sold; kit = only the
        // "+ kit" units. These are the only figures a design row should be
        // judged on, in both directions: target and tote, canvases against
        // canvases and kits against kits.
        recommendedCanvas: agg.kind === "supply" ? 0 : recommend(max, agg.total, buffer),
        recommendedKit: agg.kind === "supply"
          ? 0
          : (agg.totalKit > 0
              ? recommend(Math.max(...agg.perMarketKit, 0), agg.totalKit, buffer)
              : 0),
        toteCanvas: designStock.get(norm)?.marketCanvas ?? null,
        toteKits: designStock.get(norm)?.marketKits ?? null,
        // Enough to action a home -> market move without a second round trip.
        design: designStock.get(norm) ?? null,
        supply: supplyStock.get(norm) ?? null,
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

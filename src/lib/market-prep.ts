import { normalizeTitle } from "@/lib/shopify";
import { posDayKey } from "@/lib/pos-events";

/**
 * How much of each thing to bring to the next market, and how much of it is
 * already in the tote.
 *
 * The goal is "don't sell out", so targets are sized to the BUSIEST single
 * market seen plus a safety buffer — not the average — because the sample is
 * small and any day we actually sold out understates real demand.
 *
 * Two rules this has been got wrong on before, both now structural:
 *
 *  1. A design's canvases and kits are NEVER summed. Every sale needs a printed
 *     canvas; only a "+ kit" sale also needs an assembled kit. They were once
 *     added into a single `inTote`, which made 3 canvases + 3 kits read as "6
 *     in tote" beside a target counted from canvas sales alone. Design rows now
 *     carry no combined figure at all — `inTote` is for supplies, which have no
 *     such split.
 *
 *  2. Lines are grouped and matched by the designId/supplyId they already
 *     carry, never by `productTitle`. Titles are snapshots taken at fulfil
 *     time: rename a design and its earlier market sales keep the old name, so
 *     title-matching found no tote stock for them and dropped them out of the
 *     packing list. Newbury Street, Patriot Place and Comm Ave were all in that
 *     state — three designs that would have been under-packed.
 *
 * Extracted from the route so it can be run against live data directly.
 */

export type Buffer = "conservative" | "balanced" | "aggressive";

const FACTORS: Record<Buffer, number> = { conservative: 1.25, balanced: 1.5, aggressive: 2 };
const ONE_OFF: Record<Buffer, number> = { conservative: 1, balanced: 2, aggressive: 2 };

/** Two POS days within this many days are ONE market event (e.g. a Sat+Sun
 *  weekend). SoWa's weekly Sundays are 7 days apart → separate markets. */
export const SAME_MARKET_GAP_DAYS = 2;

export function parseBuffer(raw: string | null | undefined): Buffer {
  return raw === "conservative" || raw === "aggressive" || raw === "balanced" ? raw : "balanced";
}

function recommend(max: number, total: number, buffer: Buffer): number {
  if (total <= 1) return ONE_OFF[buffer];
  return Math.ceil(max * FACTORS[buffer]);
}

export interface PrepOrder {
  orderDate: Date | null;
  createdAt: Date;
  items: {
    productTitle: string;
    quantity: number;
    designId: string | null;
    supplyId: string | null;
    needsKit: boolean;
  }[];
}
export interface PrepDesign {
  id: string; name: string;
  marketKitsReady: number; marketCanvasPrinted: number;
  kitsReady: number; canvasPrinted: number;
  /** Retired. Its past market sales are real history, but you can't pack it. */
  archivedAt: Date | null;
}
export interface PrepSupply {
  id: string; name: string; marketQuantity: number; quantity: number;
}

export interface DesignStock { id: string; marketKits: number; marketCanvas: number; homeKits: number; homeCanvas: number; }
export interface SupplyStock { id: string; market: number; home: number; }

export interface PrepRow {
  name: string;
  kind: "kit" | "canvas" | "supply" | "other";
  designId: string | null;
  perMarket: number[];
  total: number;
  max: number;
  marketsSold: number;
  avgPerMarket: number;
  recommended: number;
  /** Supplies only; a design's tote stock is the split pair below. */
  inTote: number | null;
  recommendedCanvas: number;
  recommendedKit: number;
  toteCanvas: number | null;
  toteKits: number | null;
  design: DesignStock | null;
  supply: SupplyStock | null;
}

/**
 * Totals for one kind of thing. Canvases and kits are reported separately and
 * never added together — they are different objects, needed in different
 * amounts, and held in different amounts.
 *
 * `toPack` is NOT `required - inTote`. Targets are per design, and a surplus of
 * one design's canvases does not cover a shortfall of another's, so the
 * shortfall is summed per design.
 */
export interface KindTotals {
  /** In the tote, across the designs on this list. */
  inTote: number;
  /** Target for the next market, summed across this list. */
  required: number;
  /**
   * How much of `required` the tote actually covers: the per-design minimum of
   * held and needed. This — not `inTote` — is what `required` can be measured
   * against, because `covered + toPack === required` exactly, whereas
   * `inTote` includes surplus on designs that are already over target and so
   * overstates how ready you are.
   */
  covered: number;
  /** Sum of the per-design shortfalls — what you actually still have to carry. */
  toPack: number;
  /** Also in the tote, for designs with no market sales history to plan from. */
  offPlan: number;
}

export interface PrepResult {
  rows: PrepRow[];
  summary: {
    marketCount: number;
    itemCount: number;
    totalUnitsToBring: number;
    busiestDayUnits: number;
    buffer: Buffer;
    canvas: KindTotals;
    kit: KindTotals;
    supply: KindTotals;
  };
  markets: { label: string; units: number }[];
}

/** Legacy rows (pre-orderDate) fall back to our sync time. */
const soldAt = (o: PrepOrder) => o.orderDate ?? o.createdAt;

export function buildMarketPrep(
  orders: PrepOrder[],
  nonMarketDays: Set<string>,
  designs: PrepDesign[],
  supplies: PrepSupply[],
  buffer: Buffer,
): PrepResult {
  // Drop days that weren't craft markets. Sip-and-stitch evenings at
  // restaurants also sell through Shopify POS, so they arrive indistinguishable
  // from a market — but their sales say nothing about what to pack in the
  // market tote. A day with no pos_events row counts as a market, so only the
  // exceptions need classifying.
  const marketOrders = orders.filter((o) => !nonMarketDays.has(posDayKey(soldAt(o))));

  const designStock = new Map<string, DesignStock>();
  const designIdByTitle = new Map<string, string>();
  const designNameById = new Map<string, string>();
  const archivedDesigns = new Set<string>();
  for (const d of designs) {
    designIdByTitle.set(normalizeTitle(d.name), d.id);
    designNameById.set(d.id, d.name);
    if (d.archivedAt) archivedDesigns.add(d.id);
    designStock.set(d.id, {
      id: d.id,
      marketKits: d.marketKitsReady || 0, marketCanvas: d.marketCanvasPrinted || 0,
      homeKits: d.kitsReady || 0, homeCanvas: d.canvasPrinted || 0,
    });
  }
  const supplyStock = new Map<string, SupplyStock>();
  const supplyIdByTitle = new Map<string, string>();
  const supplyNameById = new Map<string, string>();
  for (const s of supplies) {
    supplyIdByTitle.set(normalizeTitle(s.name), s.id);
    supplyNameById.set(s.id, s.name);
    supplyStock.set(s.id, { id: s.id, market: s.marketQuantity || 0, home: s.quantity || 0 });
  }

  // Cluster POS days into market events.
  const distinctDays = [...new Set(marketOrders.map((o) => posDayKey(soldAt(o))))].sort();
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

  interface ItemAgg {
    name: string;
    kind: PrepRow["kind"];
    designId: string | null;
    supplyId: string | null;
    perMarket: number[];
    total: number;
    perMarketKit: number[];
    totalKit: number;
  }

  const items = new Map<string, ItemAgg>();
  for (const o of marketOrders) {
    const mIdx = marketOfDay.get(posDayKey(soldAt(o)))!;
    for (const it of o.items) {
      // Group by what the line was matched to, falling back to its title only
      // when it matched nothing at all.
      const norm = normalizeTitle(it.productTitle);
      const designId = it.designId ?? designIdByTitle.get(norm) ?? null;
      const supplyId = designId ? null : it.supplyId ?? supplyIdByTitle.get(norm) ?? null;
      const key = designId ? `d:${designId}` : supplyId ? `s:${supplyId}` : `t:${norm}`;
      // Shown under the name it has NOW, not whatever Shopify called it then.
      const name =
        (designId && designNameById.get(designId)) ||
        (supplyId && supplyNameById.get(supplyId)) ||
        it.productTitle;

      let agg = items.get(key);
      if (!agg) {
        const kind: ItemAgg["kind"] = supplyId ? "supply" : designId ? (it.needsKit ? "kit" : "canvas") : "other";
        agg = {
          name, kind, designId, supplyId,
          perMarket: new Array(marketCount).fill(0), total: 0,
          perMarketKit: new Array(marketCount).fill(0), totalKit: 0,
        };
        items.set(key, agg);
      }
      // A kit line upgrades the kind (an item sold both ways reads as a kit).
      if (it.needsKit && agg.kind === "canvas") agg.kind = "kit";
      agg.perMarket[mIdx] += it.quantity;
      agg.total += it.quantity;
      if (it.needsKit) {
        agg.perMarketKit[mIdx] += it.quantity;
        agg.totalKit += it.quantity;
      }
    }
  }

  const rows: PrepRow[] = [...items.values()].map((agg) => {
    const max = agg.perMarket.length ? Math.max(...agg.perMarket) : 0;
    const marketsSold = agg.perMarket.filter((q) => q > 0).length;
    const avgPerMarket = marketCount ? agg.total / marketCount : 0;
    const design = agg.designId ? designStock.get(agg.designId) ?? null : null;
    const supply = agg.supplyId ? supplyStock.get(agg.supplyId) ?? null : null;
    const isSupply = agg.kind === "supply";
    const recommended = recommend(max, agg.total, buffer);
    return {
      name: agg.name,
      kind: agg.kind,
      designId: agg.designId,
      perMarket: agg.perMarket,
      total: agg.total,
      max,
      marketsSold,
      avgPerMarket: Math.round(avgPerMarket * 10) / 10,
      recommended,
      inTote: design ? null : supply?.market ?? null,
      // canvas = every unit sold; kit = only the "+ kit" units. These are the
      // only figures a design row should be judged on, in both directions.
      recommendedCanvas: isSupply ? 0 : recommended,
      recommendedKit: isSupply
        ? 0
        : agg.totalKit > 0
          ? recommend(Math.max(...agg.perMarketKit, 0), agg.totalKit, buffer)
          : 0,
      toteCanvas: design?.marketCanvas ?? null,
      toteKits: design?.marketKits ?? null,
      // Enough to action a home -> market move without a second round trip.
      design,
      supply,
    };
  });

  // Sort: biggest recommended bring first, then total sold.
  rows.sort((a, b) => b.recommended - a.recommended || b.total - a.total);

  // Retired designs drop OUT of the list but stay IN the per-market history.
  // The 14ct intro kits sold well through July and were then archived; keeping
  // their rows told you to pack 9 of a product that no longer exists, and
  // since nothing can ever be put in the tote for them they sat permanently
  // "short". How busy a past market was is still a fact about that market,
  // though, so the totals below count every row.
  const packable = rows.filter((r) => !(r.designId && archivedDesigns.has(r.designId)));

  const designRows = packable.filter((r) => r.design);
  const supplyRows = packable.filter((r) => r.supply);
  const plannedDesignIds = new Set(designRows.map((r) => r.design!.id));
  const plannedSupplyIds = new Set(supplyRows.map((r) => r.supply!.id));
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

  const canvas: KindTotals = {
    inTote: sum(designRows, (r) => r.toteCanvas ?? 0),
    required: sum(designRows, (r) => r.recommendedCanvas),
    covered: sum(designRows, (r) => Math.min(r.toteCanvas ?? 0, r.recommendedCanvas)),
    toPack: sum(designRows, (r) => Math.max(0, r.recommendedCanvas - (r.toteCanvas ?? 0))),
    // Stock sitting in the tote for designs that have never sold at a market,
    // so there is nothing to size a target from. Counted here so these figures
    // can be reconciled against the Market tab's tote totals, which cover every
    // design rather than just the ones on this list.
    offPlan: sum(designs.filter((d) => !plannedDesignIds.has(d.id)), (d) => d.marketCanvasPrinted || 0),
  };
  const kit: KindTotals = {
    inTote: sum(designRows, (r) => r.toteKits ?? 0),
    required: sum(designRows, (r) => r.recommendedKit),
    covered: sum(designRows, (r) => Math.min(r.toteKits ?? 0, r.recommendedKit)),
    toPack: sum(designRows, (r) => Math.max(0, r.recommendedKit - (r.toteKits ?? 0))),
    offPlan: sum(designs.filter((d) => !plannedDesignIds.has(d.id)), (d) => d.marketKitsReady || 0),
  };
  const supply: KindTotals = {
    inTote: sum(supplyRows, (r) => r.supply!.market),
    required: sum(supplyRows, (r) => r.recommended),
    covered: sum(supplyRows, (r) => Math.min(r.supply!.market, r.recommended)),
    toPack: sum(supplyRows, (r) => Math.max(0, r.recommended - r.supply!.market)),
    offPlan: sum(supplies.filter((s) => !plannedSupplyIds.has(s.id)), (s) => s.marketQuantity || 0),
  };

  return {
    rows: packable,
    summary: {
      marketCount,
      itemCount: packable.length,
      totalUnitsToBring: packable.reduce((s, r) => s + r.recommended, 0),
      busiestDayUnits: markets.length
        ? Math.max(...markets.map((_, i) => rows.reduce((s, r) => s + r.perMarket[i], 0)))
        : 0,
      buffer,
      canvas,
      kit,
      supply,
    },
    markets: markets.map((m, i) => ({
      label: m.start === m.end ? m.start : `${m.start} – ${m.end}`,
      units: rows.reduce((s, r) => s + r.perMarket[i], 0),
    })),
  };
}

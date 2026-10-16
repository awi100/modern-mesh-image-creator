import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { normalizeTitle, matchSupplyByVariant } from "@/lib/shopify";
import { isMysteryBagTitle } from "@/lib/mystery-bag";
import { buildBundleMap, type BundleData } from "@/lib/bundles";

/**
 * Every sale that deducted nothing.
 *
 * A line item is matched to a design or a supply at fulfil time, by name. When
 * nothing matches, the line is still saved (`processed: true`) but no stock
 * moves — the sale is counted in revenue and invisible to inventory. The
 * /orders page has an "Unmatched" warning, but it is built from Shopify's
 * *unfulfilled* feed, so a line disappears from it the moment you fulfil the
 * order, which is exactly the moment the deduction was skipped. Nothing has
 * ever shown the ones that got away.
 *
 * This re-runs today's matcher over the whole history, so each title is
 * reported as one of:
 *   - "open"  — still matches nothing, so the next sale will skip stock again
 *   - "fixed" — matches now (the design or supply was added/renamed since);
 *               historical only, no action needed
 *
 * Mystery-bag and bundle lines are excluded: those legitimately carry no
 * design or supply of their own.
 */

export const dynamic = "force-dynamic";

interface UnmatchedRow {
  productTitle: string;
  variantTitle: string | null;
  units: number;
  lines: number;
  firstSeen: string | null;
  lastSeen: string | null;
  orderNumbers: string[];
  /** What today's matcher makes of it, or null if still nothing. */
  matchesNow: { kind: "design" | "supply"; id: string; name: string } | null;
  /** Nearest design name, when nothing matches — a hint, not a match. */
  suggestion: { kind: "design" | "supply"; name: string; score: number } | null;
}

/** Normalised edit distance, 0 = identical. Only used for the hint. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 1;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n] / Math.max(m, n);
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [designs, supplies, bundlesRaw, items] = await Promise.all([
      prisma.design.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
      prisma.supply.findMany({ select: { id: true, name: true } }),
      prisma.bundle.findMany({
        where: { active: true },
        include: { components: { include: { supply: { select: { name: true } } } } },
      }),
      prisma.shopifyOrderItem.findMany({
        where: { designId: null, supplyId: null, processed: true },
        select: {
          productTitle: true,
          variantTitle: true,
          quantity: true,
          order: {
            select: { orderNumber: true, orderDate: true, createdAt: true },
          },
        },
      }),
    ]);

    const designMap = new Map(designs.map((d) => [normalizeTitle(d.name), d]));
    const supplyMap = new Map(supplies.map((s) => [normalizeTitle(s.name), s]));
    const bundleData: BundleData[] = bundlesRaw.map((b) => ({
      id: b.id,
      title: b.title,
      components: b.components.map((c) => ({
        quantity: c.quantity,
        supplyId: c.supplyId,
        supplyName: c.supply?.name ?? null,
        chooseFrom: c.chooseFrom,
      })),
    }));
    const bundleMap = buildBundleMap(bundleData);

    // Group by title + variant: the same product can match on one variant and
    // not another (a per-colour supply with only some colours created).
    const groups = new Map<
      string,
      {
        productTitle: string;
        variantTitle: string | null;
        units: number;
        lines: number;
        first: Date | null;
        last: Date | null;
        orders: Set<string>;
      }
    >();

    for (const it of items) {
      if (isMysteryBagTitle(it.productTitle)) continue;
      if (bundleMap.get(normalizeTitle(it.productTitle))) continue;

      const key = `${it.productTitle}\u0000${it.variantTitle ?? ""}`;
      const g = groups.get(key) ?? {
        productTitle: it.productTitle,
        variantTitle: it.variantTitle,
        units: 0,
        lines: 0,
        first: null,
        last: null,
        orders: new Set<string>(),
      };
      g.units += it.quantity;
      g.lines += 1;
      g.orders.add(it.order.orderNumber);
      const when = it.order.orderDate ?? it.order.createdAt;
      if (!g.first || when < g.first) g.first = when;
      if (!g.last || when > g.last) g.last = when;
      groups.set(key, g);
    }

    const rows: UnmatchedRow[] = [...groups.values()].map((g) => {
      const normalized = normalizeTitle(g.productTitle);
      const design = designMap.get(normalized);
      const supply =
        supplyMap.get(normalized) ??
        matchSupplyByVariant(g.productTitle, g.variantTitle, supplies) ??
        undefined;

      const matchesNow = design
        ? ({ kind: "design", id: design.id, name: design.name } as const)
        : supply
          ? ({ kind: "supply", id: supply.id, name: supply.name } as const)
          : null;

      let suggestion: UnmatchedRow["suggestion"] = null;
      if (!matchesNow) {
        let best: { kind: "design" | "supply"; name: string; score: number } | null = null;
        for (const d of designs) {
          const score = distance(normalized, normalizeTitle(d.name));
          if (!best || score < best.score) best = { kind: "design", name: d.name, score };
        }
        for (const s of supplies) {
          const score = distance(normalized, normalizeTitle(s.name));
          if (!best || score < best.score) best = { kind: "supply", name: s.name, score };
        }
        // Anything further than this is noise, not a near-miss.
        if (best && best.score <= 0.45) suggestion = best;
      }

      return {
        productTitle: g.productTitle,
        variantTitle: g.variantTitle,
        units: g.units,
        lines: g.lines,
        firstSeen: g.first?.toISOString() ?? null,
        lastSeen: g.last?.toISOString() ?? null,
        orderNumbers: [...g.orders].slice(0, 8),
        matchesNow,
        suggestion,
      };
    });

    // Still-broken first, then by units sold — the biggest hole at the top.
    rows.sort((a, b) => {
      if (!a.matchesNow !== !b.matchesNow) return a.matchesNow ? 1 : -1;
      return b.units - a.units;
    });

    const open = rows.filter((r) => !r.matchesNow);
    const fixed = rows.filter((r) => r.matchesNow);

    return NextResponse.json({
      rows,
      summary: {
        openTitles: open.length,
        openUnits: open.reduce((s, r) => s + r.units, 0),
        fixedTitles: fixed.length,
        fixedUnits: fixed.reduce((s, r) => s + r.units, 0),
      },
    });
  } catch (error) {
    console.error("Error building unmatched sales report:", error);
    return NextResponse.json({ error: "Failed to build unmatched sales report" }, { status: 500 });
  }
}

import { normalizeTitle, matchSupplyByVariant } from "@/lib/shopify";
import { isMysteryBagTitle } from "@/lib/mystery-bag";
import { buildBundleMap, type BundleData } from "@/lib/bundles";

/**
 * Classifying the sales that deducted nothing.
 *
 * A line item is matched to a design or a supply at fulfil time, by name. When
 * nothing matches, the line is still saved (`processed: true`) but no stock
 * moves — the sale is counted in revenue and invisible to inventory.
 *
 * The trap this has to avoid: `productTitle` is a SNAPSHOT taken when the order
 * was fulfilled. Rename the product in Shopify and the old rows keep the old
 * spelling forever, so re-running the matcher on them says "this still matches
 * nothing" about a title that no longer exists. "Honey Duece" was sold three
 * times in August, corrected in Shopify on the 28th, and has matched on all 40
 * sales since — there is nothing to fix, but the stored rows cannot say so on
 * their own.
 *
 * So each title is classified on evidence, not on the matcher alone:
 *
 *   resolved — the design or supply it refers to has matched sales NEWER than
 *              this title's last appearance. Either the product or the design
 *              was renamed and the two line up again. History, not a job.
 *   stale    — sold once or twice, months ago, nothing newer. A one-off or
 *              custom item, not an ongoing hole.
 *   open     — recent or repeated, with no newer matched sale anywhere. These
 *              are the ones where the next sale really will skip stock.
 *
 * The design/supply a title "refers to" is established two ways, strongest
 * first: other line items carrying the SAME title that did match (exact
 * evidence of what it is), then the nearest name (a guess, labelled as one).
 *
 * Mystery-bag and bundle lines are excluded: those legitimately carry no
 * design or supply of their own.
 */

/** Sold this few times, this long ago, with nothing newer → a one-off. */
export const STALE_AFTER_DAYS = 60;
export const STALE_MAX_LINES = 2;

/** Anything further than this is noise, not a near-miss. */
export const SUGGESTION_LIMIT = 0.45;

export type UnmatchedStatus = "open" | "resolved" | "stale";

export interface Named {
  id: string;
  name: string;
}

export interface LineItemLike {
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  designId: string | null;
  supplyId: string | null;
  order: { orderNumber: string; orderDate: Date | null; createdAt: Date };
}

export interface Target {
  kind: "design" | "supply";
  id: string;
  name: string;
}

export interface UnmatchedRow {
  productTitle: string;
  variantTitle: string | null;
  units: number;
  lines: number;
  firstSeen: string | null;
  lastSeen: string | null;
  orderNumbers: string[];
  status: UnmatchedStatus;
  /** What it refers to, when we can tell. */
  target: (Target & { confident: boolean }) | null;
  /** Latest matched sale of that target, when it is newer than this row. */
  targetLastSold: string | null;
  /** One line saying why it is classified this way. */
  reason: string;
}

export interface UnmatchedReport {
  rows: UnmatchedRow[];
  summary: Record<UnmatchedStatus, { titles: number; units: number }>;
}

/** Normalised edit distance, 0 = identical. Only used for the guess. */
export function distance(a: string, b: string): number {
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

const when = (o: { orderDate: Date | null; createdAt: Date }) => o.orderDate ?? o.createdAt;

export function buildUnmatchedReport(
  items: LineItemLike[],
  designs: Named[],
  supplies: Named[],
  bundles: BundleData[],
  now: Date = new Date(),
): UnmatchedReport {
  const designById = new Map(designs.map((d) => [d.id, d]));
  const supplyById = new Map(supplies.map((s) => [s.id, s]));
  const designMap = new Map(designs.map((d) => [normalizeTitle(d.name), d]));
  const supplyMap = new Map(supplies.map((s) => [normalizeTitle(s.name), s]));
  const bundleMap = buildBundleMap(bundles);

  // Latest matched sale per design/supply — the test for "renamed since".
  const lastSold = new Map<string, Date>();
  // What a given title has matched to on its OTHER lines (exact evidence).
  // One title can point at several designs across its life — "Comm Ave Street
  // Sign" sold as the 14ct design until May and as the 18ct one after it — so
  // keep the MOST RECENT, which is what the title means now. Keeping the first
  // row the database happened to return would pin the title to a retired design
  // and report a live product as broken.
  const titleTarget = new Map<string, { target: Target; at: Date }>();

  for (const it of items) {
    if (!it.designId && !it.supplyId) continue;
    const key = it.designId ? `design:${it.designId}` : `supply:${it.supplyId}`;
    const d = when(it.order);
    const prev = lastSold.get(key);
    if (!prev || d > prev) lastSold.set(key, d);

    const norm = normalizeTitle(it.productTitle);
    const held = titleTarget.get(norm);
    if (held && held.at >= d) continue;
    if (it.designId) {
      const design = designById.get(it.designId);
      if (design) titleTarget.set(norm, { target: { kind: "design", id: design.id, name: design.name }, at: d });
    } else if (it.supplyId) {
      const supply = supplyById.get(it.supplyId);
      if (supply) titleTarget.set(norm, { target: { kind: "supply", id: supply.id, name: supply.name }, at: d });
    }
  }

  // Group the unmatched lines by title + variant: the same product can match on
  // one variant and not another (a per-colour supply with only some colours
  // created).
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
    if (it.designId || it.supplyId) continue;
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
    const d = when(it.order);
    if (!g.first || d < g.first) g.first = d;
    if (!g.last || d > g.last) g.last = d;
    groups.set(key, g);
  }

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const rows: UnmatchedRow[] = [...groups.values()].map((g) => {
    const normalized = normalizeTitle(g.productTitle);

    // Does it match outright today? (The design/supply was created since.)
    const designNow = designMap.get(normalized);
    const supplyNow =
      supplyMap.get(normalized) ??
      matchSupplyByVariant(g.productTitle, g.variantTitle, supplies) ??
      undefined;

    let target: (Target & { confident: boolean }) | null = null;
    if (designNow) {
      target = { kind: "design", id: designNow.id, name: designNow.name, confident: true };
    } else if (supplyNow) {
      target = { kind: "supply", id: supplyNow.id, name: supplyNow.name, confident: true };
    } else {
      // Other lines with this exact title that did match — exact evidence.
      const byTitle = titleTarget.get(normalized);
      if (byTitle) {
        target = { ...byTitle.target, confident: true };
      } else {
        // Nearest name. A guess, and reported as one.
        let best: (Target & { score: number }) | null = null;
        for (const d of designs) {
          const score = distance(normalized, normalizeTitle(d.name));
          if (!best || score < best.score) best = { kind: "design", id: d.id, name: d.name, score };
        }
        for (const s of supplies) {
          const score = distance(normalized, normalizeTitle(s.name));
          if (!best || score < best.score) best = { kind: "supply", id: s.id, name: s.name, score };
        }
        if (best && best.score <= SUGGESTION_LIMIT) {
          target = { kind: best.kind, id: best.id, name: best.name, confident: false };
        }
      }
    }

    const targetLast = target ? lastSold.get(`${target.kind}:${target.id}`) ?? null : null;
    const newer = !!(targetLast && g.last && targetLast > g.last);
    const ageDays = g.last ? (now.getTime() - g.last.getTime()) / 86_400_000 : Infinity;

    let status: UnmatchedStatus;
    let reason: string;
    if (designNow || supplyNow) {
      status = "resolved";
      reason = `Matches the ${target!.kind} ${target!.name} now — it was added or renamed since.`;
    } else if (newer) {
      status = "resolved";
      reason = `${target!.name} has sold and deducted normally since (latest ${fmtDate(targetLast!)}), so the name lines up again — this title is just the old spelling, kept on the old rows.`;
    } else if (g.lines <= STALE_MAX_LINES && ageDays > STALE_AFTER_DAYS) {
      status = "stale";
      reason = `Sold ${g.lines === 1 ? "once" : `${g.lines} times`}, ${Math.round(ageDays)} days ago, nothing since — most likely a one-off or custom item rather than a product that will sell again.`;
    } else {
      status = "open";
      reason = target
        ? `Nothing newer has matched${target.confident ? "" : ` — closest name is the ${target.kind} ${target.name}`}, so the next one sold will skip stock too.`
        : "Matches no design or supply, and nothing close enough to guess — the next one sold will skip stock too.";
    }

    return {
      productTitle: g.productTitle,
      variantTitle: g.variantTitle,
      units: g.units,
      lines: g.lines,
      firstSeen: g.first?.toISOString() ?? null,
      lastSeen: g.last?.toISOString() ?? null,
      orderNumbers: [...g.orders].slice(0, 8),
      status,
      target,
      targetLastSold: newer ? targetLast!.toISOString() : null,
      reason,
    };
  });

  const rank: Record<UnmatchedStatus, number> = { open: 0, stale: 1, resolved: 2 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || b.units - a.units);

  const tally = (s: UnmatchedStatus) => {
    const r = rows.filter((x) => x.status === s);
    return { titles: r.length, units: r.reduce((sum, x) => sum + x.units, 0) };
  };

  return {
    rows,
    summary: { open: tally("open"), stale: tally("stale"), resolved: tally("resolved") },
  };
}

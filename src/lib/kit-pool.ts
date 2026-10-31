/**
 * Shared kit pools.
 *
 * A kit is a bag of thread. When several designs call for the same thread, one
 * bag serves any of them, so counting them per design counts the same
 * interchangeable bags five times over — and reads as five shortages instead of
 * one pool. The five green street signs are the case this was built for: all of
 * Boylston, Comm Ave, Main Street, Mass Ave and Newbury Street take 2 skeins of
 * 909, 1 of BLANC and a 310 bobbin.
 *
 * Canvases are NOT shared. A Comm Ave sale needs a Comm Ave canvas; only the
 * thread is interchangeable.
 *
 * Where the stock lives:
 *   design.kitGroupId == null  ->  the design's own kitsReady/marketKitsReady/
 *                                  kitsAndover columns, as always
 *   design.kitGroupId != null  ->  the GROUP's columns. The design's own three
 *                                  are held at 0 on purpose, so any read that
 *                                  has not been taught about groups shows an
 *                                  obvious zero rather than a stale number that
 *                                  looks plausible.
 *
 * Every read and write of kit stock should come through here. Reaching for
 * design.kitsReady directly is right only when you specifically want the
 * design's own column and have already handled the group case.
 *
 * This module is the PURE half, deliberately free of any Prisma runtime
 * import so client components can use it. The writes live in kit-group.ts.
 */

export type KitLocation = "home" | "market" | "andover";

/** The column names, in one place, so a location is never spelled by hand. */
export const KIT_FIELDS: Record<KitLocation, "kitsReady" | "marketKitsReady" | "kitsAndover"> = {
  home: "kitsReady",
  market: "marketKitsReady",
  andover: "kitsAndover",
};

export const CANVAS_FIELDS: Record<KitLocation, "canvasPrinted" | "marketCanvasPrinted" | "canvasAndover"> = {
  home: "canvasPrinted",
  market: "marketCanvasPrinted",
  andover: "canvasAndover",
};

/** Include this on any design query whose result will report kit stock. */
export const KIT_GROUP_INCLUDE = {
  kitGroup: {
    select: {
      id: true, name: true, contents: true,
      kitsReady: true, marketKitsReady: true, kitsAndover: true,
      _count: { select: { designs: true } },
    },
  },
} as const;

export interface KitCounts {
  home: number;
  market: number;
  andover: number;
  total: number;
}

export interface KitStock extends KitCounts {
  /** True when these numbers are a pool shared with other designs. */
  shared: boolean;
  groupId: string | null;
  groupName: string | null;
  /** How many designs draw on the pool, including this one. */
  memberCount: number;
  /** What one bag holds, for whoever is packing. */
  contents: string | null;
}

type WithKits = {
  kitsReady: number;
  marketKitsReady: number;
  kitsAndover: number;
  kitGroupId?: string | null;
  kitGroup?: {
    id: string;
    name: string;
    contents?: string | null;
    kitsReady: number;
    marketKitsReady: number;
    kitsAndover: number;
    _count?: { designs: number };
  } | null;
};

/**
 * The kit stock available to a design, from wherever it actually lives.
 *
 * Note the deliberate asymmetry: a design in a group reports the WHOLE pool,
 * not a fifth of it. Splitting it would be a fiction — any one of the five can
 * use every bag — and a per-design share would make each design look short
 * while the shelf is full.
 */
export function kitStockOf(design: WithKits): KitStock {
  const g = design.kitGroup;
  if (design.kitGroupId && g) {
    return {
      home: g.kitsReady,
      market: g.marketKitsReady,
      andover: g.kitsAndover,
      total: g.kitsReady + g.marketKitsReady + g.kitsAndover,
      shared: true,
      groupId: g.id,
      groupName: g.name,
      memberCount: g._count?.designs ?? 0,
      contents: g.contents ?? null,
    };
  }
  return {
    home: design.kitsReady,
    market: design.marketKitsReady,
    andover: design.kitsAndover,
    total: design.kitsReady + design.marketKitsReady + design.kitsAndover,
    shared: false,
    groupId: null,
    groupName: null,
    memberCount: 1,
    contents: null,
  };
}

/**
 * Sum kit stock over a list of designs without counting a shared pool twice.
 *
 * This is the whole reason a pool cannot just be mirrored onto its members: any
 * total across designs would multiply it by the membership. Each group is
 * counted once, however many of its members are in the list.
 */
export function totalKitStock(designs: WithKits[]): KitCounts {
  const seen = new Set<string>();
  const out: KitCounts = { home: 0, market: 0, andover: 0, total: 0 };
  for (const d of designs) {
    const s = kitStockOf(d);
    if (s.shared) {
      if (seen.has(s.groupId!)) continue;
      seen.add(s.groupId!);
    }
    out.home += s.home;
    out.market += s.market;
    out.andover += s.andover;
  }
  out.total = out.home + out.market + out.andover;
  return out;
}

/**
 * A design's even share of a shared pool, for arithmetic that must not count
 * the pool once per member.
 *
 * Buying thread is the case. `kitStockOf` reports the whole pool, which is
 * right for "what can this design ship" — any bag fits it. It is wrong for
 * "how much thread is already spent", because crediting all five street signs
 * with the same eleven bags claims fifty-five bags' worth of thread.
 *
 * An even split treats pooling as no help when ordering: total demand comes out
 * as `members * target - pool`, the same as if nothing were shared. That
 * over-orders a little, since the point of a pool is to hold less for the same
 * service level — but how much less depends on demand variance, and guessing
 * that in a thread order risks running out mid-season. Erring high is cheap and
 * reversible; erring low loses sales.
 */
export function sharedKitShare(design: WithKits): number {
  const s = kitStockOf(design);
  const onHand = s.home + s.market;
  return s.shared && s.memberCount > 0 ? onHand / s.memberCount : onHand;
}


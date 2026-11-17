/**
 * What she physically pulls off the shelf, aggregated across the open orders.
 *
 * Three lists, one per tab on the Orders page: canvases, kit bags, supplies.
 * They are the picking list — "fetch 6 Fenway Frank canvases" — so every one of
 * them must count exactly the orders being packed today and nothing else.
 *
 * This lives here, pure and tested, because it was written inline in the page
 * three times and all three copies iterated EVERY order. An order already
 * deducted, or deliberately ticked off as "not today", stayed in all three
 * lists: unticking the 20-unit wholesale order dropped it out of the headline
 * counts (computed on the server, which did filter) but left its canvases and
 * kits on the lists she pulls against. Two places disagreeing about what is
 * owed is worse than either being wrong on its own.
 *
 * `onPickList` is the one filter. Never re-derive it with a bare
 * `!locallyFulfilled` — that is the shape of the bug it replaces.
 *
 * Pure and client-safe: no Prisma, no fetch, no React.
 */

import { onPickList, type PickListOrder } from "./order-pick-list";
import { kitBudgetKey } from "./order-allocation";

/** The parts of a line item the pull lists read. */
export interface PullItem {
  itemType: string;
  quantity: number;
  needsKit: boolean;
  designId: string | null;
  designName: string | null;
  productTitle: string;
  variantTitle: string | null;
  productType: string | null;
  previewImageUrl: string | null;
  /** Bags at home — the WHOLE pool for a pooled design. See kit-pool.ts. */
  kitsReady: number;
  kitGroupId: string | null;
  kitPool: { name: string; members: number; contents: string | null } | null;
  canvasPrinted: number;
  folderId: string | null;
  folderName: string | null;
  totalSold: number;
  supplyId: string | null;
  supplyName: string | null;
  supplyQuantity: number;
}

export interface PullOrder extends PickListOrder {
  items: PullItem[];
}

// ---------------------------------------------------------------- canvases

export interface CanvasPullRow {
  designId: string | null;
  designName: string | null;
  productTitle: string;
  previewImageUrl: string | null;
  /** Canvases owed for this design across every order being packed. */
  quantity: number;
  /** Printed canvases at home. */
  canvasPrinted: number;
  /** How many of those canvases also go out with a kit. */
  kitsNeeded: number;
}

/**
 * Canvases to pull, one row per design, most-needed first.
 *
 * Keyed by design throughout: a canvas is not interchangeable, so a Newbury
 * sale needs a Newbury canvas however many bags of thread it shares.
 */
export function canvasPullList(orders: readonly PullOrder[]): CanvasPullRow[] {
  const byDesign = new Map<string, CanvasPullRow>();

  for (const order of onPickList(orders)) {
    for (const item of order.items) {
      if (item.itemType !== "canvas") continue;
      const key = item.designId || item.productTitle;
      const row = byDesign.get(key);
      if (row) {
        row.quantity += item.quantity;
        if (item.needsKit) row.kitsNeeded += item.quantity;
      } else {
        byDesign.set(key, {
          designId: item.designId,
          designName: item.designName,
          productTitle: item.productTitle,
          previewImageUrl: item.previewImageUrl,
          quantity: item.quantity,
          canvasPrinted: item.canvasPrinted,
          kitsNeeded: item.needsKit ? item.quantity : 0,
        });
      }
    }
  }

  return [...byDesign.values()].sort((a, b) => b.quantity - a.quantity);
}

// -------------------------------------------------------------------- kits

export interface KitPullRow {
  designId: string | null;
  designName: string | null;
  productTitle: string;
  previewImageUrl: string | null;
  /** THIS design's own bags owed — what this row is telling you to pull. */
  quantity: number;
  /** Bags on hand: the whole pool when `poolKey` is set. */
  kitsReady: number;
  folderId: string | null;
  folderName: string | null;
  totalSold: number;
  poolKey: string | null;
  poolName: string | null;
  /**
   * Bags owed across the WHOLE pool, which is the only figure comparable with
   * the pooled `kitsReady` beside it. Equal to `quantity` when unpooled.
   */
  bagsNeeded: number;
  /** Every design drawing on the pool that has demand here; [] when unpooled. */
  sharedWith: string[];
}

/**
 * Kit bags to pull, one row per DESIGN.
 *
 * Pooled designs are deliberately not merged. The bags are interchangeable but
 * the canvases are not, so one Boylston and one Newbury are two different
 * things to fetch — merged, the list read "2 x Boylston St" for one of each.
 *
 * What is shared is the count: `kitsReady` on every member is the whole pool.
 * Comparing it with one design's demand is the invitation to hand the pool out
 * once per member, so `bagsNeeded` carries the pool's total demand instead.
 */
export function kitPullList(orders: readonly PullOrder[]): KitPullRow[] {
  const byDesign = new Map<string, KitPullRow>();
  const poolNeed = new Map<string, number>();
  const poolFor = new Map<string, string[]>();

  for (const order of onPickList(orders)) {
    for (const item of order.items) {
      if (!item.needsKit || item.itemType !== "canvas") continue;

      const poolKey = item.kitPool ? kitBudgetKey(item) : null;
      if (poolKey) {
        poolNeed.set(poolKey, (poolNeed.get(poolKey) ?? 0) + item.quantity);
        const names = poolFor.get(poolKey) ?? [];
        const label = item.designName ?? item.productTitle;
        if (!names.includes(label)) names.push(label);
        poolFor.set(poolKey, names);
      }

      const key = item.designId || item.productTitle;
      const row = byDesign.get(key);
      if (row) {
        row.quantity += item.quantity;
      } else {
        byDesign.set(key, {
          designId: item.designId,
          designName: item.designName,
          productTitle: item.productTitle,
          previewImageUrl: item.previewImageUrl,
          quantity: item.quantity,
          kitsReady: item.kitsReady,
          folderId: item.folderId,
          folderName: item.folderName,
          totalSold: item.totalSold,
          poolKey,
          poolName: item.kitPool?.name ?? null,
          bagsNeeded: 0,
          sharedWith: [],
        });
      }
    }
  }

  // Filled in afterwards: the pool total is only known once every order has
  // been walked, and a row created early would otherwise freeze a partial sum.
  for (const row of byDesign.values()) {
    row.bagsNeeded = row.poolKey ? poolNeed.get(row.poolKey) ?? row.quantity : row.quantity;
    row.sharedWith = row.poolKey ? poolFor.get(row.poolKey) ?? [] : [];
  }

  return [...byDesign.values()];
}

/** Kit rows grouped by folder, folders alphabetical with Uncategorized last. */
export function groupKitRowsByFolder(rows: readonly KitPullRow[]): [string, KitPullRow[]][] {
  const byFolder = new Map<string, KitPullRow[]>();
  for (const row of rows) {
    const key = row.folderId || "__uncategorized__";
    const list = byFolder.get(key) ?? [];
    list.push(row);
    byFolder.set(key, list);
  }
  for (const list of byFolder.values()) list.sort((a, b) => b.quantity - a.quantity);

  return [...byFolder.entries()].sort((a, b) => {
    if (a[0] === "__uncategorized__") return 1;
    if (b[0] === "__uncategorized__") return -1;
    return (a[1][0]?.folderName || "").localeCompare(b[1][0]?.folderName || "");
  });
}

// ---------------------------------------------------------------- supplies

export interface SupplyPullRow {
  supplyId: string | null;
  /** What to call it on the list: the resolved supply, not the raw title. */
  name: string;
  productType: string | null;
  quantity: number;
  inStock: number;
  /** Variant (colour/style) breakdown, e.g. Project Bag colours. */
  variants: Map<string, number>;
}

/** Shopify's label for a product with only one variant — not a real variant. */
const DEFAULT_VARIANT = /^default(\s*title)?$/i;

/**
 * Supplies to pull, one row per supply, most-ordered first.
 *
 * The row is named after the matched SUPPLY rather than the line item's
 * product title. Several supplies arrive under one title — "Needle Minder"
 * with the colour in the variant — so titling by the line item gave two rows
 * both reading "Needle Minder", which is not a thing you can go and fetch.
 */
export function supplyPullList(orders: readonly PullOrder[]): SupplyPullRow[] {
  const byKey = new Map<string, SupplyPullRow>();

  for (const order of onPickList(orders)) {
    for (const item of order.items) {
      if (item.itemType !== "supply") continue;

      const key = item.supplyId || item.productTitle;
      let row = byKey.get(key);
      if (!row) {
        row = {
          supplyId: item.supplyId,
          name: item.supplyName || item.productTitle,
          productType: item.productType,
          quantity: 0,
          inStock: item.supplyQuantity,
          variants: new Map<string, number>(),
        };
        byKey.set(key, row);
      }
      row.quantity += item.quantity;

      // Keep a variant that also appears in the product name: dropping those
      // wrongly hid "Silver"/"Gold" on "Silver/Gold Embroidery Scissors".
      const variant = (item.variantTitle || "").trim();
      if (variant && !DEFAULT_VARIANT.test(variant)) {
        row.variants.set(variant, (row.variants.get(variant) || 0) + item.quantity);
      }
    }
  }

  return [...byKey.values()].sort((a, b) => b.quantity - a.quantity);
}

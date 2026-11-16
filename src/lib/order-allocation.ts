/**
 * Handing out the stock on the shelf to the orders waiting for it.
 *
 * Two questions, both answered here so they cannot answer differently:
 *
 *  1. **Which orders can actually be packed right now** — oldest first, express
 *     first, each order eating the inventory it uses so the ones behind it see
 *     what is really left (`calculateFulfillableOrders`).
 *  2. **How much is owed per design** across every order still to be pulled,
 *     which is the `X/Y` on each row (`calculateDemandByDesign`).
 *
 * Both have to respect [shared kit pools], and that is the reason this is a
 * tested module rather than two closures inside the page. A kit is a bag of
 * thread; when several designs take the same thread one bag serves any of them,
 * so the API reports the WHOLE pool to every member — a per-design share would
 * be a fiction, since any member can use every bag. The consequence is that
 * `kitsReady` is safe to compare against one pool's demand and catastrophic to
 * add up or budget per design: the five green street signs would each spend the
 * same three bags, and five orders would read as packable when one is.
 *
 * So every kit figure here is keyed by `kitBudgetKey` and totalled before it is
 * compared. Canvases are NOT pooled — a Newbury sale needs a Newbury canvas —
 * and stay keyed by design throughout.
 *
 * Pure and client-safe: no Prisma, no fetch.
 */

import { onPickList, type PickListOrder } from "./order-pick-list";

/** The parts of a line item that bear on allocation. */
export interface AllocatableItem {
  itemType: string;
  quantity: number;
  needsKit: boolean;
  designId: string | null;
  /** Set when `kitsReady` is a pool shared with other designs. */
  kitGroupId: string | null;
  /** Kit bags available at home — the WHOLE pool for a pooled design. */
  kitsReady: number;
  canvasPrinted: number;
  supplyId: string | null;
  supplyQuantity: number;
}

export interface AllocatableOrder extends PickListOrder {
  shopifyOrderId: string;
  createdAt: string;
  isExpress: boolean;
  items: AllocatableItem[];
}

export interface DesignDemand {
  totalKitsNeeded: number;
  totalCanvasesNeeded: number;
}

/**
 * The key an item's KIT stock is budgeted and totalled under: its pool if it
 * has one, otherwise the design itself.
 *
 * Null only for an item with no design, which has no kit stock to budget.
 */
export function kitBudgetKey(item: Pick<AllocatableItem, "designId" | "kitGroupId">): string | null {
  return item.kitGroupId ?? item.designId;
}

/**
 * Aggregated demand per design across the orders still to be pulled.
 *
 * `onPickList` drops both the already-deducted and the deliberately skipped:
 * one 30-unit wholesale order left in here reports "need 25" on every OTHER
 * order's row for the same design.
 *
 * `totalKitsNeeded` is the demand on the design's whole POOL, written back to
 * every member, because that is the only figure comparable with the pooled
 * `kitsReady` the row shows beside it. Per design, two members needing 3 and 2
 * bags would each read "enough" against a pool of 3.
 */
export function calculateDemandByDesign(orders: readonly AllocatableOrder[]): Map<string, DesignDemand> {
  const demand = new Map<string, DesignDemand>();
  const kitsByPool = new Map<string, number>();
  const poolOfDesign = new Map<string, string>();

  for (const order of onPickList(orders)) {
    for (const item of order.items) {
      if (!item.designId || item.itemType !== "canvas") continue;

      const existing = demand.get(item.designId) ?? { totalKitsNeeded: 0, totalCanvasesNeeded: 0 };
      existing.totalCanvasesNeeded += item.quantity;
      demand.set(item.designId, existing);

      const key = kitBudgetKey(item);
      if (key) {
        poolOfDesign.set(item.designId, key);
        if (item.needsKit) kitsByPool.set(key, (kitsByPool.get(key) ?? 0) + item.quantity);
      }
    }
  }

  for (const [designId, entry] of demand) {
    entry.totalKitsNeeded = kitsByPool.get(poolOfDesign.get(designId) ?? designId) ?? 0;
  }

  return demand;
}

/**
 * The orders that can be packed from what is on the shelf, as a set of ids.
 *
 * Walked in priority order with a running balance, so the answer for any one
 * order already accounts for everything ahead of it taking its stock first.
 * Express orders go first (they paid for speed), then oldest first.
 */
export function calculateFulfillableOrders(orders: readonly AllocatableOrder[]): Set<string> {
  const fulfillable = new Set<string>();

  // Already-deducted orders are out because they have consumed their
  // inventory; skipped ones are out because they have not and must not — left
  // in, an old wholesale order sits at the front of this queue and starves
  // every order behind it of canvases that are actually on the shelf.
  const queue = onPickList(orders).sort((a, b) => {
    if (a.isExpress !== b.isExpress) return a.isExpress ? -1 : 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const remainingKits = new Map<string, number>();
  const remainingCanvases = new Map<string, number>();
  const remainingSupplies = new Map<string, number>();

  for (const order of queue) {
    for (const item of order.items) {
      if (item.designId) {
        const key = kitBudgetKey(item);
        // Keyed by POOL. Give Boylston and Newbury a key each and the same
        // three bags are handed out twice over.
        if (key && !remainingKits.has(key)) remainingKits.set(key, item.kitsReady);
        if (!remainingCanvases.has(item.designId)) remainingCanvases.set(item.designId, item.canvasPrinted);
      }
      if (item.supplyId && !remainingSupplies.has(item.supplyId)) {
        remainingSupplies.set(item.supplyId, item.supplyQuantity);
      }
    }
  }

  for (const order of queue) {
    const canvasItems = order.items.filter((i) => i.itemType === "canvas");

    // Needs are totalled across the order BEFORE anything is checked. Item by
    // item, an order for two Boylston and two Newbury passes twice against the
    // same untouched pool of three and then deducts four. The same goes for
    // canvases: one design can appear as two line items in one order (a
    // "+ kit" variant and a canvas-only one).
    const kitNeed = new Map<string, number>();
    const canvasNeed = new Map<string, number>();
    for (const item of canvasItems) {
      if (!item.designId) continue;
      canvasNeed.set(item.designId, (canvasNeed.get(item.designId) ?? 0) + item.quantity);
      if (item.needsKit) {
        const key = kitBudgetKey(item)!;
        kitNeed.set(key, (kitNeed.get(key) ?? 0) + item.quantity);
      }
    }

    const supplyNeed = new Map<string, number>();
    for (const item of order.items) {
      if (item.itemType !== "supply" || !item.supplyId) continue;
      supplyNeed.set(item.supplyId, (supplyNeed.get(item.supplyId) ?? 0) + item.quantity);
    }

    const covered =
      [...kitNeed].every(([k, n]) => (remainingKits.get(k) ?? 0) >= n) &&
      [...canvasNeed].every(([d, n]) => (remainingCanvases.get(d) ?? 0) >= n);

    if (!covered) continue;

    fulfillable.add(order.shopifyOrderId);
    for (const [k, n] of kitNeed) remainingKits.set(k, (remainingKits.get(k) ?? 0) - n);
    for (const [d, n] of canvasNeed) remainingCanvases.set(d, (remainingCanvases.get(d) ?? 0) - n);
    for (const [s, n] of supplyNeed) remainingSupplies.set(s, (remainingSupplies.get(s) ?? 0) - n);
  }

  return fulfillable;
}

/**
 * Inventory costing.
 *
 * Two numbers, arrived at two different ways, and it matters which is which.
 *
 * WHAT WE STILL HAVE is valued by FIFO over cost layers. Quantities come from
 * the existing columns on Design/Supply/InventoryItem, which are what the app
 * has always counted; layers supply the price.
 *
 * WHAT WE USED is measured periodically: received minus remaining. It is NOT
 * the sum of recorded movements, because stock leaves this business without a
 * record — a canvas handed over at a sip-and-stitch, a raffle prize, a sample
 * posted to a shop. A perpetual ledger understates consumption every time
 * someone forgets, and silently. Purchases are evidenced by supplier invoices
 * and the remaining count is a real number, so their difference is right
 * whether or not anybody wrote the removal down. It is also the shape
 * Form 1125-A wants: opening + purchases - ending.
 *
 * The price of that choice is that the TOTAL is sound and the BREAKDOWN is
 * not. Shopify sales are known exactly (OrderDeduction), and some manual
 * removals carry a reason. Whatever is left is reported as `unaccounted`
 * rather than folded into retail COGS, because stock nobody recorded leaving
 * is not evidence of a sale. See `consumptionBreakdown`.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

export type Costed = "canvas" | "kit" | "supply" | "thread";

/** Identifies one costed thing. Exactly one of the ids is set. */
export interface ItemKey {
  kind: Costed;
  designId?: string | null;
  supplyId?: string | null;
  threadKey?: string | null;
}

export const keyOf = (k: ItemKey) =>
  `${k.kind}:${k.designId ?? k.supplyId ?? k.threadKey ?? ""}`;

/* -------------------------------------------------------------------------- */
/* Landed cost allocation                                                     */
/* -------------------------------------------------------------------------- */

export type AllocationMethod = "quantity" | "value" | "manual";

export interface AllocatableLine {
  id: string;
  quantity: number;
  unitCost: number;
  /** Only read when the method is "manual". */
  allocatedCost?: number;
}

/**
 * Spread freight, duty and the rest across the lines they arrived with.
 *
 * "value" (the default) splits in proportion to each line's extended cost, so
 * a $3.92 canvas carries more freight than a $3.20 one. "quantity" splits per
 * unit, which is closer to the truth when a shipment is priced by piece or
 * weight — Sanhome's air freight on 400 canvases, say.
 *
 * Rounding is settled by giving the remainder to the largest line, so the
 * allocated amounts always sum to exactly the cost being spread. Letting each
 * line round independently leaves a few cents unattached to anything, which
 * then fails reconciliation against the invoice for no useful reason.
 */
export function allocateCosts(
  lines: AllocatableLine[],
  totalToAllocate: number,
  method: AllocationMethod = "value",
): Map<string, number> {
  const out = new Map<string, number>();
  if (lines.length === 0) return out;

  if (method === "manual") {
    for (const l of lines) out.set(l.id, round2(l.allocatedCost ?? 0));
    return out;
  }

  const weight = (l: AllocatableLine) =>
    method === "quantity" ? l.quantity : l.quantity * l.unitCost;
  const total = lines.reduce((s, l) => s + weight(l), 0);

  // Nothing to weight by (a free sample order, or every line zero-priced):
  // fall back to an even split so the cost still lands somewhere.
  if (total <= 0) {
    const each = round2(totalToAllocate / lines.length);
    for (const l of lines) out.set(l.id, each);
  } else {
    for (const l of lines) out.set(l.id, round2((weight(l) / total) * totalToAllocate));
  }

  const drift = round2(totalToAllocate - sum([...out.values()]));
  if (drift !== 0) {
    const biggest = [...lines].sort((a, b) => weight(b) - weight(a))[0];
    out.set(biggest.id, round2((out.get(biggest.id) ?? 0) + drift));
  }
  return out;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Landed unit cost for one line, once its share of the extras is known. */
export function landedUnitCost(quantity: number, unitCost: number, allocated: number): number {
  if (quantity <= 0) return 0;
  return round2((quantity * unitCost + allocated) / quantity);
}

/**
 * Unit cost for a lot the supplier topped up at no charge — free extras, or a
 * reprint making good on a batch that printed badly.
 *
 * The money is unchanged and the units went up, so the rate goes down: the
 * paid line's whole landed cost is spread across every unit that arrived, paid
 * and free alike. Both lines then carry this same rate.
 *
 * The alternative is to cost the free units at zero and leave the paid ones
 * alone. That keeps the same total, but it reports the first canvases off a
 * reprinted batch as expensive and the rest as free, when the two are the same
 * canvas and sell for the same price. Pooling tells you what a unit of this
 * design actually cost, which is the number a margin is worth taking against.
 *
 * Pass freeUnits = 0 and this is just `landedUnitCost`.
 */
export function poolReplacementCost(
  paid: { quantity: number; unitCost: number; allocatedCost: number },
  freeUnits: number,
): number {
  const units = paid.quantity + Math.max(0, freeUnits);
  if (units <= 0) return 0;
  return round2((paid.quantity * paid.unitCost + paid.allocatedCost) / units);
}

/* -------------------------------------------------------------------------- */
/* FIFO valuation                                                             */
/* -------------------------------------------------------------------------- */

export interface Layer {
  id: string;
  quantity: number;
  remaining: number;
  landedUnitCost: number;
  receivedAt: Date;
  estimated: boolean;
}

export interface Valuation {
  /** Units the layers can still account for. */
  coveredUnits: number;
  /** Units on hand that no layer covers — bought before costing began, or
   *  never entered. Valued at nothing, and reported, never guessed at. */
  uncoveredUnits: number;
  value: number;
  /** True if any layer used was itself an estimate. */
  estimated: boolean;
}

/**
 * Value `onHand` units against layers, oldest first.
 *
 * Deliberately tolerates having fewer layer units than on-hand units: this
 * business ran for most of a year before any cost was recorded, so most
 * products will be partly uncovered for a long time. Reporting the shortfall
 * is honest; spreading an average over it to make the total look complete is
 * not.
 */
export function valueFifo(onHand: number, layers: Layer[]): Valuation {
  if (onHand <= 0) return { coveredUnits: 0, uncoveredUnits: 0, value: 0, estimated: false };

  const ordered = [...layers].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  let left = onHand;
  let value = 0;
  let estimated = false;

  for (const l of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, l.remaining);
    if (take <= 0) continue;
    value += take * l.landedUnitCost;
    if (l.estimated) estimated = true;
    left -= take;
  }

  return {
    coveredUnits: onHand - left,
    uncoveredUnits: left,
    value: round2(value),
    estimated,
  };
}

/**
 * Cost of a number of units consumed, oldest layers first.
 *
 * Returns which layers to decrement so the caller can do it in its own
 * transaction — this function does not write.
 */
export function consumeFifo(
  units: number,
  layers: Layer[],
): { cost: number; draws: { layerId: string; units: number; unitCost: number }[]; shortUnits: number } {
  const ordered = [...layers].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const draws: { layerId: string; units: number; unitCost: number }[] = [];
  let left = Math.max(0, units);
  let cost = 0;

  for (const l of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, l.remaining);
    if (take <= 0) continue;
    draws.push({ layerId: l.id, units: take, unitCost: l.landedUnitCost });
    cost += take * l.landedUnitCost;
    left -= take;
  }
  return { cost: round2(cost), draws, shortUnits: left };
}

/** Weighted average unit cost across layers — the same rows, read differently,
 *  so the costing method can change without a migration. */
export function weightedAverage(layers: Layer[]): number | null {
  const units = sum(layers.map((l) => l.remaining));
  if (units <= 0) return null;
  return round2(sum(layers.map((l) => l.remaining * l.landedUnitCost)) / units);
}

/* -------------------------------------------------------------------------- */
/* Periodic consumption                                                       */
/* -------------------------------------------------------------------------- */

export interface Consumption {
  received: number;
  onHand: number;
  /** received - onHand. Negative means we hold more than we ever bought,
   *  which is a data problem, not a negative sale — see `discrepancy`. */
  consumed: number;
  /** Set when onHand exceeds received: stock exists that no purchase explains
   *  (pre-costing stock, or a missing invoice). Flagged, never netted off. */
  discrepancy: number;
}

export function periodicConsumption(received: number, onHand: number): Consumption {
  const consumed = received - onHand;
  return {
    received,
    onHand,
    consumed: Math.max(0, consumed),
    discrepancy: consumed < 0 ? -consumed : 0,
  };
}

/**
 * Split consumption into what we can evidence and what we cannot.
 *
 * `shopifySold` comes from OrderDeduction, which is exact. `recordedManual` is
 * categorised removals. The remainder is `unaccounted` — real stock that left
 * with no record. It is reported on its own rather than assumed to be sales,
 * because calling it revenue-generating would overstate gross margin, and
 * calling it shrinkage would overstate waste. It is simply unknown.
 */
export function consumptionBreakdown(args: {
  consumed: number;
  shopifySold: number;
  recordedManual: number;
}): { shopifySold: number; recordedManual: number; unaccounted: number; overRecorded: number } {
  const known = args.shopifySold + args.recordedManual;
  return {
    shopifySold: args.shopifySold,
    recordedManual: args.recordedManual,
    unaccounted: Math.max(0, args.consumed - known),
    // More recorded than the count says left. Means a removal was logged that
    // never physically happened, or stock came back without being booked.
    overRecorded: Math.max(0, known - args.consumed),
  };
}

/* -------------------------------------------------------------------------- */
/* Loading layers                                                             */
/* -------------------------------------------------------------------------- */

type Db = PrismaClient | Prisma.TransactionClient;

export async function layersFor(db: Db, key: ItemKey, asOf?: Date): Promise<Layer[]> {
  const rows = await db.costLayer.findMany({
    where: {
      kind: key.kind,
      designId: key.designId ?? undefined,
      supplyId: key.supplyId ?? undefined,
      threadKey: key.threadKey ?? undefined,
      ...(asOf ? { receivedAt: { lte: asOf } } : {}),
    },
    orderBy: { receivedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    remaining: r.remaining,
    landedUnitCost: r.landedUnitCost,
    receivedAt: r.receivedAt,
    estimated: r.estimated,
  }));
}

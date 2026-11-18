/**
 * Taking supplies off the shelf for a sale, and putting them back on an undo.
 *
 * Canvases and kits have drawn on Andover bulk when their own bucket ran out
 * since `drawFrom` was written; supplies never did. All three deduction paths
 * (fulfil, webhook, sync) carried their own copy of
 *
 *     const avail = isPos ? supply.marketQuantity : supply.quantity;
 *     const actual = Math.max(0, Math.min(deduction, avail));
 *     if (actual > 0) { ...decrement... }
 *
 * which is exactly the shape `drawFrom` exists to replace: an empty bucket
 * deducts NOTHING and the sale leaves no trace. For canvases that produced 55
 * short deduction rows before it was fixed. For supplies it was worse, because
 * there was no SupplyDeduction table to come up short IN — the units simply
 * never moved, `suppliesDeducted` came back lower than asked, and nothing
 * displayed it. Found on 18 Nov 2026 while checking the new project bags: 15 of
 * 33 supplies had sold more through a bucket than that bucket could ever have
 * held, with hundreds sitting at Andover the whole time.
 *
 * So this module does two things the loops it replaces could not:
 *
 *  1. Falls through to Andover, via the same `drawFrom` canvases use. A draw
 *     from Andover does not mean anyone fetched anything — that shelf is only
 *     right again after the next pickup — but a count that silently diverges
 *     from reality is worse, because nothing ever flags it.
 *  2. Writes a SupplyDeduction row EVERY time, including when the draw took
 *     zero. A missing row has to mean "this order never ran", not "this order
 *     ran and took nothing"; `planSupplyRestore` depends on telling those apart.
 *
 * A POS sale still does not fall back to home. Market stock is a deliberate
 * physical separation — it moves to the tote as an explicit transfer — so the
 * tote falls through to Andover and skips home entirely, exactly as canvases do.
 */

import { Prisma } from "@prisma/client";
import { drawFrom } from "./stock-draw";

export interface SupplyDeductContext {
  shopifyOrderId: string;
  orderNumber: string;
  sourceName: string | null;
  /** POS sales draw on the market tote; everything else on home stock. */
  isPos: boolean;
  via: "fulfill" | "webhook" | "sync";
  /** Omitted by the webhook path, which has no order kind in scope and leans
   *  on the column default exactly as its OrderDeduction rows do. */
  kind?: string;
}

/**
 * Deduct every supply an order wants, bucket first then Andover, and audit it.
 *
 * Returns the total units actually taken. Call inside the transaction, after
 * `lockSupplies` — this is a read-modify-write and the order lock does not
 * cover it.
 */
export async function deductSupplies(
  tx: Prisma.TransactionClient,
  requests: Map<string, number>,
  ctx: SupplyDeductContext,
): Promise<number> {
  let totalDeducted = 0;

  for (const [supplyId, requested] of requests) {
    const supply = await tx.supply.findUnique({
      where: { id: supplyId },
      select: { name: true, quantity: true, marketQuantity: true, andoverQuantity: true },
    });
    if (!supply) continue;

    const draw = drawFrom(
      requested,
      ctx.isPos ? supply.marketQuantity : supply.quantity,
      supply.andoverQuantity,
    );

    // Short now means short EVERYWHERE, Andover included — a genuine oversell
    // rather than merely an empty tote, which is why it is worth a warning.
    if (draw.short > 0) {
      console.warn(
        `${ctx.via}: order ${ctx.orderNumber} exceeded ${ctx.isPos ? "market tote" : "online"} ` +
          `and Andover stock for supply "${supply.name}" (${supplyId}): ` +
          `wanted ${requested}, took ${draw.total}`,
      );
    }

    if (draw.total > 0) {
      await tx.supply.update({
        where: { id: supplyId },
        data: {
          ...(draw.fromPrimary > 0
            ? ctx.isPos
              ? { marketQuantity: { decrement: draw.fromPrimary } }
              : { quantity: { decrement: draw.fromPrimary } }
            : {}),
          ...(draw.fromAndover > 0 ? { andoverQuantity: { decrement: draw.fromAndover } } : {}),
        },
      });
    }

    // Unconditional: a zero-unit row is the evidence that this order ran and
    // this supply had nothing to give. See the header.
    await tx.supplyDeduction.create({
      data: {
        shopifyOrderId: ctx.shopifyOrderId,
        orderNumber: ctx.orderNumber,
        sourceName: ctx.sourceName,
        bucket: ctx.isPos ? "market" : "online",
        via: ctx.via,
        kind: ctx.kind ?? "retail",
        supplyId,
        supplyName: supply.name,
        requested,
        deducted: draw.total,
        fromAndover: draw.fromAndover,
      },
    });

    totalDeducted += draw.total;
  }

  return totalDeducted;
}

/** One SupplyDeduction row, as the undo path reads it back. */
export interface SupplyAuditRow {
  supplyId: string;
  deducted: number;
  fromAndover: number;
  /** "market" | "online" — the bucket this draw came out of. */
  bucket: string;
}

/** What to put back, and where. */
export interface SupplyRestore {
  supplyId: string;
  /** Units back to the order's own bucket (tote if `toMarket`, else home). */
  toBucket: number;
  /** Units back to Andover bulk, because that is where they came from. */
  toAndover: number;
  toMarket: boolean;
}

/**
 * Work out what an undo should return to each supply.
 *
 * Mirrors the design-side logic in the fulfil route's undo, and is pure so the
 * three cases it has to keep apart can be tested rather than reasoned about:
 *
 *  - **Audited.** Put back exactly what the row says was taken, to the bucket
 *    the row says it came from — NOT the line-item quantity, and not today's
 *    `isPos`. A sale that fell through to Andover must credit Andover, or the
 *    undo quietly moves stock between two real places.
 *  - **Audited order, no row for this supply.** Nothing was deducted for it, so
 *    it gets nothing back. This is the case that needs the zero-unit rows: an
 *    order that took nothing still has a row, so its absence is meaningful.
 *  - **Unaudited order.** Everything predating the SupplyDeduction table, where
 *    the line-item quantity is the only figure there is. Falls back to it and
 *    credits today's bucket — i.e. exactly the old behaviour, unchanged.
 *
 * `auditRows` must be newest-first. Only the newest row per supply is used:
 * fulfil -> undo -> fulfil leaves two sets of rows for one order and summing
 * them would restore both fulfilments' worth.
 *
 * The result covers the union of the two inputs. A supply that was deducted but
 * is no longer in the line-item expansion — a bundle whose components changed
 * since — must still be put back, and a stale expansion must not invent one.
 */
export function planSupplyRestore(
  fallback: Map<string, number>,
  auditRows: readonly SupplyAuditRow[],
  isPos: boolean,
): SupplyRestore[] {
  const newest = new Map<string, SupplyAuditRow>();
  for (const row of auditRows) {
    if (!newest.has(row.supplyId)) newest.set(row.supplyId, row);
  }
  const orderWasAudited = newest.size > 0;

  const supplyIds = new Set<string>([...fallback.keys(), ...newest.keys()]);
  const plans: SupplyRestore[] = [];

  for (const supplyId of supplyIds) {
    const audited = newest.get(supplyId);

    // No row on an audited order means nothing was taken for this supply.
    const total = audited
      ? Math.max(0, audited.deducted)
      : orderWasAudited
        ? 0
        : Math.max(0, fallback.get(supplyId) ?? 0);

    if (total === 0) continue;

    const toAndover = Math.min(Math.max(0, audited?.fromAndover ?? 0), total);
    plans.push({
      supplyId,
      toBucket: total - toAndover,
      toAndover,
      toMarket: audited ? audited.bucket === "market" : isPos,
    });
  }

  return plans;
}

/** Apply a restore plan. Returns the total units put back. */
export async function restoreSupplies(
  tx: Prisma.TransactionClient,
  plans: readonly SupplyRestore[],
): Promise<number> {
  let restored = 0;
  for (const plan of plans) {
    await tx.supply.update({
      where: { id: plan.supplyId },
      data: {
        ...(plan.toBucket > 0
          ? plan.toMarket
            ? { marketQuantity: { increment: plan.toBucket } }
            : { quantity: { increment: plan.toBucket } }
          : {}),
        ...(plan.toAndover > 0 ? { andoverQuantity: { increment: plan.toAndover } } : {}),
      },
    });
    restored += plan.toBucket + plan.toAndover;
  }
  return restored;
}

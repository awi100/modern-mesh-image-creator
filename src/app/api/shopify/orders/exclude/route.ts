import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { toOrderKind } from "@/lib/order-kind";

/**
 * Leave an order off the pick list, or put it back.
 *
 * This moves no stock and changes nothing in Shopify. It only says "not this
 * one, not today", so the canvases and kits it wants stop being counted into
 * what you pull from the shelf, and stop being allocated ahead of the orders
 * you are actually packing. See src/lib/order-pick-list.ts for why both of
 * those matter.
 *
 * Two things make this trickier than the `kind` route next door.
 *
 * **An unpacked order usually has no local row.** `kind` can 404 in that case
 * because an unprocessed order carries a computed guess and gets its row when
 * it is fulfilled. Skipping cannot: the whole point is to skip an order BEFORE
 * packing it, which is precisely when no row exists. So this creates one.
 *
 * **A bare row has to be built carefully**, because two separate guards read
 * these rows and both can be fooled:
 *
 *  - Sync treats an order as already processed when `fulfilledAt` is set OR it
 *    has line items. This row sets neither, so a skipped order that really does
 *    ship is still synced and deducted normally. Setting `fulfilledAt` here
 *    would silently swallow the sale.
 *  - Undo falls back to line-item quantities when an order has no audit rows,
 *    so fabricating items would let one Undo click invent stock. There are
 *    none, deliberately.
 *
 * **The kind has to be carried in on create.** `kind` defaults to "retail", and
 * sync's update deliberately never overwrites it — a human correction must
 * survive a re-sync. Those two together mean a bare row created here with the
 * default would pin a wholesale order to "retail" for good, and one 30-unit
 * wholesale order read as retail demand is 2.3 units/week of phantom sales rate
 * for a year. So the client sends the kind it is displaying (its own guess or a
 * stored correction) and it is stored on create only.
 */
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const shopifyOrderId: unknown = body?.shopifyOrderId;
    const excluded: unknown = body?.excluded;
    const orderNumber: unknown = body?.orderNumber;
    const reasonRaw: unknown = body?.reason;

    if (typeof shopifyOrderId !== "string" || !shopifyOrderId) {
      return NextResponse.json({ error: "Missing shopifyOrderId" }, { status: 400 });
    }
    if (typeof excluded !== "boolean") {
      return NextResponse.json({ error: "excluded must be true or false" }, { status: 400 });
    }
    const reason =
      typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim().slice(0, 300) : null;

    const existing = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
      select: { id: true, excludedAt: true, fulfilledAt: true },
    });

    // Already deducted: its canvases and kits have left the building, so it is
    // off the pick list anyway and skipping it would only be confusing.
    if (existing?.fulfilledAt) {
      return NextResponse.json(
        { error: "That order has already been deducted — undo it first if you need to change it." },
        { status: 409 }
      );
    }

    if (!excluded) {
      if (!existing || !existing.excludedAt) {
        return NextResponse.json({ success: true, excluded: false, changed: false });
      }
      await prisma.shopifyOrder.update({
        where: { shopifyOrderId },
        data: { excludedAt: null, excludedReason: null },
      });
      return NextResponse.json({ success: true, excluded: false, changed: true });
    }

    if (existing?.excludedAt) {
      return NextResponse.json({ success: true, excluded: true, changed: false });
    }

    if (existing) {
      await prisma.shopifyOrder.update({
        where: { shopifyOrderId },
        data: { excludedAt: new Date(), excludedReason: reason },
      });
      return NextResponse.json({ success: true, excluded: true, changed: true });
    }

    // No row yet — the common case, since skipping happens before packing.
    if (typeof orderNumber !== "string" || !orderNumber) {
      return NextResponse.json(
        { error: "Missing orderNumber (needed to record an order that hasn't been packed yet)" },
        { status: 400 }
      );
    }
    await prisma.shopifyOrder.create({
      data: {
        shopifyOrderId,
        orderNumber,
        // Carried in so a later sync, which never overwrites kind, cannot pin a
        // wholesale order to the "retail" default. See the note above.
        kind: toOrderKind(body?.kind),
        excludedAt: new Date(),
        excludedReason: reason,
        // fulfilledAt stays null and no items are created, on purpose.
      },
    });
    return NextResponse.json({ success: true, excluded: true, changed: true, created: true });
  } catch (error) {
    console.error("Error updating order exclusion:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}

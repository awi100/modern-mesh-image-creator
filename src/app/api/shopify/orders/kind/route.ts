import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { isOrderKind, ORDER_KINDS } from "@/lib/order-kind";

/**
 * Correct why an order exists: retail, wholesale, donation or replacement.
 *
 * This moves no stock. The units left the building whatever the reason, so the
 * deduction stands — the kind only decides whether the order counts as retail
 * demand in the sales rate that sizes reorders, stock alerts and the kit order.
 * That is exactly why it has to be editable: the app can tell a hand-built $0
 * order isn't a sale, but it cannot tell a donation from a replacement for a
 * badly printed canvas, and guessing wrong there should cost a dropdown rather
 * than a wrong purchase.
 *
 * The historical `OrderDeduction` rows keep the kind they were written with.
 * They record what was decided at the time, like the rest of that table.
 */
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const shopifyOrderId: unknown = body?.shopifyOrderId;
    const kind: unknown = body?.kind;

    if (typeof shopifyOrderId !== "string" || !shopifyOrderId) {
      return NextResponse.json({ error: "Missing shopifyOrderId" }, { status: 400 });
    }
    if (!isOrderKind(kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${ORDER_KINDS.join(", ")}` },
        { status: 400 }
      );
    }

    // Only an order we've already processed has a row to label. An unsynced
    // order carries the computed guess and gets its kind when it's fulfilled,
    // so there is nothing to store yet — say so rather than creating a bare row
    // with no items, which the sync guards treat as still-unprocessed.
    const existing = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
      select: { id: true, kind: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Order hasn't been processed yet — set its type when you deduct it." },
        { status: 404 }
      );
    }

    if (existing.kind === kind) {
      return NextResponse.json({ success: true, kind, changed: false });
    }

    await prisma.shopifyOrder.update({ where: { shopifyOrderId }, data: { kind } });

    return NextResponse.json({ success: true, kind, changed: true, previousKind: existing.kind });
  } catch (error) {
    console.error("Error updating order kind:", error);
    return NextResponse.json({ error: "Failed to update order type" }, { status: 500 });
  }
}

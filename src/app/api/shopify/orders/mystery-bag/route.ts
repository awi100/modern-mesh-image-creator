import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { isMysteryBagTitle, picksRequiredForItems } from "@/lib/mystery-bag";

// GET ?shopifyOrderId=... — return the saved picks for a Mystery Bag order,
// plus how many picks the order needs.
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const shopifyOrderId = searchParams.get("shopifyOrderId");
    if (!shopifyOrderId) {
      return NextResponse.json({ error: "Missing shopifyOrderId" }, { status: 400 });
    }

    const order = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
      include: {
        items: { select: { productTitle: true, quantity: true } },
        mysteryBagPicks: {
          orderBy: { createdAt: "asc" },
          include: {
            design: {
              select: {
                id: true,
                name: true,
                meshCount: true,
                misprintCount: true,
                kitsReady: true,
                previewImageUrl: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const required = picksRequiredForItems(order.items);

    return NextResponse.json({
      shopifyOrderId,
      required,
      picks: order.mysteryBagPicks.map((p) => ({
        id: p.id,
        designId: p.designId,
        design: p.design,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching mystery bag picks:", error);
    return NextResponse.json(
      { error: "Failed to fetch mystery bag picks" },
      { status: 500 }
    );
  }
}

// PUT — replace all picks for an order.
// Body: { shopifyOrderId, orderNumber, customerName?, items?, designIds }
// designIds may contain duplicates (same design can appear twice if
// misprintCount >= 2). Length must equal the required count derived from the
// order's Mystery Bag line items. The local ShopifyOrder row is created on
// demand when it does not exist yet (picks are typically saved before
// fulfillment, which is when the local row would otherwise be created).
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { shopifyOrderId, orderNumber, customerName, items, designIds } = body as {
      shopifyOrderId?: string;
      orderNumber?: string;
      customerName?: string | null;
      items?: { productTitle: string; quantity: number }[];
      designIds?: string[];
    };

    if (!shopifyOrderId || !Array.isArray(designIds)) {
      return NextResponse.json(
        { error: "shopifyOrderId and designIds[] are required" },
        { status: 400 }
      );
    }

    let order = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
      include: { items: { select: { productTitle: true, quantity: true } } },
    });

    if (!order) {
      if (!orderNumber || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { error: "Order not found locally; orderNumber and items are required to create it" },
          { status: 400 }
        );
      }
      order = await prisma.shopifyOrder.create({
        data: {
          shopifyOrderId,
          orderNumber,
          customerName: customerName || null,
        },
        include: { items: { select: { productTitle: true, quantity: true } } },
      });
    }

    if (order.fulfilledAt) {
      return NextResponse.json(
        { error: "Order already fulfilled; cannot change picks" },
        { status: 400 }
      );
    }

    // Use stored items if present (post-fulfillment); otherwise trust the
    // caller's Shopify view (used when the local row was just created).
    const itemsForCount = order.items.length > 0 ? order.items : items ?? [];
    const hasMysteryBag = itemsForCount.some((i) => isMysteryBagTitle(i.productTitle));
    if (!hasMysteryBag) {
      return NextResponse.json(
        { error: "Order has no Mystery Misprint Bag items" },
        { status: 400 }
      );
    }

    const required = picksRequiredForItems(itemsForCount);
    if (designIds.length !== required) {
      return NextResponse.json(
        { error: `Expected ${required} picks, got ${designIds.length}` },
        { status: 400 }
      );
    }

    // Verify all design IDs exist (cheap sanity check). We don't enforce
    // misprintCount > 0 here because picks may be entered before / during
    // misprint count edits; the actual deduction is floored at 0 on fulfill.
    const uniqueIds = Array.from(new Set(designIds));
    const designs = await prisma.design.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (designs.length !== uniqueIds.length) {
      const found = new Set(designs.map((d) => d.id));
      const missing = uniqueIds.filter((id) => !found.has(id));
      return NextResponse.json(
        { error: `Unknown design IDs: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const picks = await prisma.$transaction(async (tx) => {
      await tx.mysteryBagPick.deleteMany({ where: { shopifyOrderId: order.id } });
      if (designIds.length > 0) {
        await tx.mysteryBagPick.createMany({
          data: designIds.map((designId) => ({
            shopifyOrderId: order.id,
            designId,
          })),
        });
      }
      return tx.mysteryBagPick.findMany({
        where: { shopifyOrderId: order.id },
        orderBy: { createdAt: "asc" },
        include: {
          design: {
            select: {
              id: true,
              name: true,
              meshCount: true,
              misprintCount: true,
              kitsReady: true,
              previewImageUrl: true,
            },
          },
        },
      });
    });

    return NextResponse.json({
      shopifyOrderId,
      required,
      picks: picks.map((p) => ({
        id: p.id,
        designId: p.designId,
        design: p.design,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error saving mystery bag picks:", error);
    return NextResponse.json(
      { error: "Failed to save mystery bag picks" },
      { status: 500 }
    );
  }
}

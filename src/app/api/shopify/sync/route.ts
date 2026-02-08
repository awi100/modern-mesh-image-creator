import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import {
  fetchRecentlyFulfilledOrders,
  parseNeedsKit,
  normalizeTitle,
} from "@/lib/shopify";

export interface SyncResult {
  processedOrders: number;
  kitsDeducted: number;
  canvasesDeducted: number;
  errors: string[];
}

// POST - Sync fulfilled orders and deduct inventory
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if Shopify is configured
    if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_TOKEN) {
      return NextResponse.json(
        { error: "Shopify not configured" },
        { status: 500 }
      );
    }

    // Fetch all designs for matching
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
      },
    });

    const designMap = new Map<string, string>();
    for (const design of designs) {
      designMap.set(normalizeTitle(design.name), design.id);
    }

    // Get already processed order IDs
    const processedOrders = await prisma.shopifyOrder.findMany({
      where: { fulfilledAt: { not: null } },
      select: { shopifyOrderId: true },
    });
    const processedIds = new Set(processedOrders.map(o => o.shopifyOrderId));

    // Fetch recently fulfilled orders from Shopify
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const shopifyData = await fetchRecentlyFulfilledOrders(thirtyDaysAgo);
    const fulfilledOrders = shopifyData.orders.nodes;

    let kitsDeducted = 0;
    let canvasesDeducted = 0;
    let ordersProcessed = 0;
    const errors: string[] = [];

    for (const shopifyOrder of fulfilledOrders) {
      // Skip if already processed
      if (processedIds.has(shopifyOrder.id)) {
        continue;
      }

      try {
        // Process this order in a transaction
        await prisma.$transaction(async (tx) => {
          // Create or update the ShopifyOrder record
          const order = await tx.shopifyOrder.upsert({
            where: { shopifyOrderId: shopifyOrder.id },
            create: {
              shopifyOrderId: shopifyOrder.id,
              orderNumber: shopifyOrder.name,
              customerName: shopifyOrder.billingAddress?.name || "Guest",
              fulfilledAt: new Date(),
            },
            update: {
              fulfilledAt: new Date(),
            },
          });

          // Process each line item
          for (const lineItem of shopifyOrder.lineItems.nodes) {
            const productTitle = lineItem.product?.title || lineItem.title;
            const needsKit = parseNeedsKit(lineItem.variantTitle);
            const designId = designMap.get(normalizeTitle(productTitle)) || null;

            // Check if this item was already processed
            const existingItem = await tx.shopifyOrderItem.findFirst({
              where: {
                shopifyOrderId: order.id,
                productTitle,
                variantTitle: lineItem.variantTitle,
              },
            });

            if (existingItem?.processed) {
              continue; // Already processed
            }

            // Create or update the order item
            await tx.shopifyOrderItem.upsert({
              where: { id: existingItem?.id || "" },
              create: {
                shopifyOrderId: order.id,
                designId,
                productTitle,
                variantTitle: lineItem.variantTitle,
                quantity: lineItem.quantity,
                needsKit,
                processed: true,
              },
              update: {
                processed: true,
              },
            });

            // Deduct inventory if we have a matching design
            if (designId) {
              // Always deduct canvasPrinted
              await tx.design.update({
                where: { id: designId },
                data: {
                  canvasPrinted: { decrement: lineItem.quantity },
                },
              });
              canvasesDeducted += lineItem.quantity;

              // Deduct kitsReady if kit was ordered
              if (needsKit) {
                await tx.design.update({
                  where: { id: designId },
                  data: {
                    kitsReady: { decrement: lineItem.quantity },
                  },
                });
                kitsDeducted += lineItem.quantity;
              }
            }
          }
        });

        ordersProcessed++;
      } catch (orderError) {
        errors.push(`Order ${shopifyOrder.name}: ${orderError instanceof Error ? orderError.message : "Unknown error"}`);
      }
    }

    const result: SyncResult = {
      processedOrders: ordersProcessed,
      kitsDeducted,
      canvasesDeducted,
      errors,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error syncing Shopify orders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync orders" },
      { status: 500 }
    );
  }
}

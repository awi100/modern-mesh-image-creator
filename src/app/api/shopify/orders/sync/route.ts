import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import {
  fetchRecentlyFulfilledOrders,
  parseNeedsKit,
  normalizeTitle,
} from "@/lib/shopify";

interface SyncResult {
  synced: number;
  alreadyProcessed: number;
  errors: string[];
  syncedOrders: { orderNumber: string; itemCount: number }[];
}

// POST - Sync fulfilled orders from Shopify
// Finds orders that are fulfilled in Shopify but not yet processed locally
export async function POST() {
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

    // Fetch fulfilled orders from Shopify (last 60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const shopifyData = await fetchRecentlyFulfilledOrders(sixtyDaysAgo);
    const fulfilledOrders = shopifyData.orders.nodes;

    if (fulfilledOrders.length === 0) {
      return NextResponse.json({
        synced: 0,
        alreadyProcessed: 0,
        errors: [],
        syncedOrders: [],
      } as SyncResult);
    }

    // Get all Shopify order IDs that we've already processed
    const processedOrders = await prisma.shopifyOrder.findMany({
      where: {
        shopifyOrderId: {
          in: fulfilledOrders.map((o) => o.id),
        },
        fulfilledAt: { not: null },
      },
      select: { shopifyOrderId: true },
    });

    const processedIds = new Set(processedOrders.map((o) => o.shopifyOrderId));

    // Find orders that need to be synced
    const ordersToSync = fulfilledOrders.filter(
      (order) => !processedIds.has(order.id)
    );

    if (ordersToSync.length === 0) {
      return NextResponse.json({
        synced: 0,
        alreadyProcessed: fulfilledOrders.length,
        errors: [],
        syncedOrders: [],
      } as SyncResult);
    }

    // Fetch all designs and supplies for matching
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        kitsReady: true,
        canvasPrinted: true,
      },
    });

    const supplies = await prisma.supply.findMany({
      select: {
        id: true,
        name: true,
        quantity: true,
      },
    });

    const designMap = new Map<string, typeof designs[0]>();
    for (const design of designs) {
      designMap.set(normalizeTitle(design.name), design);
    }

    const supplyMap = new Map<string, typeof supplies[0]>();
    for (const supply of supplies) {
      supplyMap.set(normalizeTitle(supply.name), supply);
    }

    // Process each order
    const result: SyncResult = {
      synced: 0,
      alreadyProcessed: processedIds.size,
      errors: [],
      syncedOrders: [],
    };

    for (const shopifyOrder of ordersToSync) {
      try {
        // Build items list with design/supply matching
        const items: {
          designId: string | null;
          supplyId: string | null;
          productTitle: string;
          variantTitle: string | null;
          quantity: number;
          needsKit: boolean;
        }[] = [];

        for (const lineItem of shopifyOrder.lineItems.nodes) {
          const productTitle = lineItem.product?.title || lineItem.title;
          const lowerTitle = productTitle.toLowerCase();
          const isIntroProduct = lowerTitle.includes("intro") || lowerTitle.includes("beginner");
          const needsKit = isIntroProduct || parseNeedsKit(lineItem.variantTitle);

          const normalizedTitle = normalizeTitle(productTitle);
          const matchedDesign = designMap.get(normalizedTitle);
          const matchedSupply = supplyMap.get(normalizedTitle);

          items.push({
            designId: matchedDesign?.id || null,
            supplyId: matchedSupply?.id || null,
            productTitle,
            variantTitle: lineItem.variantTitle,
            quantity: lineItem.quantity,
            needsKit: matchedDesign ? needsKit : false,
          });
        }

        // Aggregate updates by designId
        const designUpdatesMap = new Map<string, {
          canvasDeduction: number;
          kitDeduction: number;
          totalSold: number;
          totalKitsSold: number;
        }>();
        const supplyUpdatesMap = new Map<string, number>();

        for (const item of items) {
          if (item.designId) {
            const existing = designUpdatesMap.get(item.designId) || {
              canvasDeduction: 0,
              kitDeduction: 0,
              totalSold: 0,
              totalKitsSold: 0,
            };
            existing.canvasDeduction += item.quantity;
            existing.totalSold += item.quantity;
            if (item.needsKit) {
              existing.kitDeduction += item.quantity;
              existing.totalKitsSold += item.quantity;
            }
            designUpdatesMap.set(item.designId, existing);
          }

          if (item.supplyId) {
            const existing = supplyUpdatesMap.get(item.supplyId) || 0;
            supplyUpdatesMap.set(item.supplyId, existing + item.quantity);
          }
        }

        // Process in transaction
        await prisma.$transaction(async (tx) => {
          // Create ShopifyOrder record
          const order = await tx.shopifyOrder.upsert({
            where: { shopifyOrderId: shopifyOrder.id },
            create: {
              shopifyOrderId: shopifyOrder.id,
              orderNumber: shopifyOrder.name,
              customerName: shopifyOrder.billingAddress?.name || null,
              fulfilledAt: new Date(),
            },
            update: {
              fulfilledAt: new Date(),
            },
          });

          // Create ShopifyOrderItem records
          for (const item of items) {
            await tx.shopifyOrderItem.create({
              data: {
                shopifyOrderId: order.id,
                designId: item.designId,
                productTitle: item.productTitle,
                variantTitle: item.variantTitle,
                quantity: item.quantity,
                needsKit: item.needsKit,
                processed: true,
              },
            });
          }

          // Process design updates
          for (const [designId, updates] of designUpdatesMap) {
            const design = await tx.design.findUnique({
              where: { id: designId },
              select: { kitsReady: true, canvasPrinted: true },
            });

            if (design) {
              const actualCanvasDeduction = Math.min(updates.canvasDeduction, design.canvasPrinted);
              const actualKitDeduction = Math.min(updates.kitDeduction, design.kitsReady);

              await tx.design.update({
                where: { id: designId },
                data: {
                  canvasPrinted: actualCanvasDeduction > 0 ? { decrement: actualCanvasDeduction } : undefined,
                  kitsReady: actualKitDeduction > 0 ? { decrement: actualKitDeduction } : undefined,
                  totalSold: { increment: updates.totalSold },
                  totalKitsSold: updates.totalKitsSold > 0 ? { increment: updates.totalKitsSold } : undefined,
                },
              });
            }
          }

          // Process supply updates
          for (const [supplyId, deduction] of supplyUpdatesMap) {
            const supply = await tx.supply.findUnique({
              where: { id: supplyId },
              select: { quantity: true },
            });

            if (supply) {
              const actualDeduction = Math.min(deduction, supply.quantity);
              if (actualDeduction > 0) {
                await tx.supply.update({
                  where: { id: supplyId },
                  data: { quantity: { decrement: actualDeduction } },
                });
              }
            }
          }
        });

        result.synced++;
        result.syncedOrders.push({
          orderNumber: shopifyOrder.name,
          itemCount: items.length,
        });
      } catch (error) {
        console.error(`Error syncing order ${shopifyOrder.name}:`, error);
        result.errors.push(`${shopifyOrder.name}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error syncing orders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync orders" },
      { status: 500 }
    );
  }
}

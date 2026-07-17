import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import {
  fetchRecentlyFulfilledOrders,
  fetchCompletedDraftLinks,
  parseNeedsKit,
  normalizeTitle,
  visibleCustomAttributes,
  isPosSource,
} from "@/lib/shopify";
import { isMysteryBagTitle } from "@/lib/mystery-bag";

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

    // Get all Shopify order IDs that we've already processed. An order counts
    // as processed if it was fulfilled locally OR if it already has line-item
    // rows — the latter catches orders that were fulfilled and then
    // deliberately UNDONE (undo clears fulfilledAt but keeps the items).
    // Re-syncing an undone order would silently re-deduct inventory and undo
    // the undo. A pre-fulfillment Mystery-Bag row has no items, so it stays
    // eligible for a real sync.
    const processedOrders = await prisma.shopifyOrder.findMany({
      where: {
        shopifyOrderId: {
          in: fulfilledOrders.map((o) => o.id),
        },
        OR: [
          { fulfilledAt: { not: null } },
          { items: { some: {} } },
        ],
      },
      select: { shopifyOrderId: true },
    });

    const processedIds = new Set(processedOrders.map((o) => o.shopifyOrderId));

    // Draft reconciliation: a draft order fulfilled in-app carries the DRAFT's
    // id locally, but once completed in Shopify it becomes a real order with a
    // NEW id that would deduct again here. Map completed drafts -> their order
    // and, if we already fulfilled the draft locally, treat that order as
    // processed so it isn't double-deducted.
    try {
      const draftLinks = await fetchCompletedDraftLinks(sixtyDaysAgo);
      if (draftLinks.length > 0) {
        const fulfilledDrafts = await prisma.shopifyOrder.findMany({
          where: { shopifyOrderId: { in: draftLinks.map((l) => l.draftId) }, items: { some: {} } },
          select: { shopifyOrderId: true },
        });
        const fulfilledDraftSet = new Set(fulfilledDrafts.map((d) => d.shopifyOrderId));
        for (const link of draftLinks) {
          if (fulfilledDraftSet.has(link.draftId)) processedIds.add(link.orderId);
        }
      }
    } catch (e) {
      console.error("Draft reconciliation failed (continuing without it):", e);
    }

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
        // POS (in-person/craft market) sales deduct from the market tote;
        // online orders deduct from main/online stock.
        const isPos = isPosSource(shopifyOrder.sourceName);

        // Build items list with design/supply matching
        const items: {
          designId: string | null;
          supplyId: string | null;
          productTitle: string;
          variantTitle: string | null;
          quantity: number;
          needsKit: boolean;
          customAttributes: { key: string; value: string }[];
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
            customAttributes: visibleCustomAttributes(lineItem.customAttributes),
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
          // Mystery Bag line items never auto-deduct on sync — they require
          // explicit picks via the orders UI. Sync records them as-is so the
          // app can surface a "pick designs" prompt to the user.
          if (isMysteryBagTitle(item.productTitle)) continue;

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
              sourceName: shopifyOrder.sourceName || null,
              fulfilledAt: new Date(),
            },
            update: {
              sourceName: shopifyOrder.sourceName || null,
              fulfilledAt: new Date(),
            },
          });

          // Create ShopifyOrderItem records
          for (const item of items) {
            await tx.shopifyOrderItem.create({
              data: {
                shopifyOrderId: order.id,
                designId: item.designId,
                supplyId: item.supplyId,
                productTitle: item.productTitle,
                variantTitle: item.variantTitle,
                quantity: item.quantity,
                needsKit: item.needsKit,
                processed: true,
                customAttributes: item.customAttributes.length > 0 ? item.customAttributes : undefined,
              },
            });
          }

          // Process design updates. POS sales draw down the market tote;
          // online sales draw down main/online stock. totalSold/totalKitsSold
          // always increment regardless of channel.
          for (const [designId, updates] of designUpdatesMap) {
            const design = await tx.design.findUnique({
              where: { id: designId },
              select: { name: true, kitsReady: true, canvasPrinted: true, marketKitsReady: true, marketCanvasPrinted: true },
            });

            if (design) {
              const availCanvas = isPos ? design.marketCanvasPrinted : design.canvasPrinted;
              const availKit = isPos ? design.marketKitsReady : design.kitsReady;
              const actualCanvasDeduction = Math.min(updates.canvasDeduction, availCanvas);
              const actualKitDeduction = Math.min(updates.kitDeduction, availKit);

              if (isPos && (actualCanvasDeduction < updates.canvasDeduction || actualKitDeduction < updates.kitDeduction)) {
                console.warn(`Sync: POS order ${shopifyOrder.name} exceeded market stock for design ${designId} (market tote count likely drifted)`);
              }

              await tx.design.update({
                where: { id: designId },
                data: {
                  ...(isPos
                    ? {
                        marketCanvasPrinted: actualCanvasDeduction > 0 ? { decrement: actualCanvasDeduction } : undefined,
                        marketKitsReady: actualKitDeduction > 0 ? { decrement: actualKitDeduction } : undefined,
                      }
                    : {
                        canvasPrinted: actualCanvasDeduction > 0 ? { decrement: actualCanvasDeduction } : undefined,
                        kitsReady: actualKitDeduction > 0 ? { decrement: actualKitDeduction } : undefined,
                      }),
                  totalSold: { increment: updates.totalSold },
                  totalKitsSold: updates.totalKitsSold > 0 ? { increment: updates.totalKitsSold } : undefined,
                },
              });

              await tx.orderDeduction.create({
                data: {
                  shopifyOrderId: shopifyOrder.id, orderNumber: shopifyOrder.name, sourceName: shopifyOrder.sourceName || null,
                  bucket: isPos ? "market" : "online", via: "sync",
                  designId, designName: design.name,
                  kitsRequested: updates.kitDeduction, kitsDeducted: actualKitDeduction,
                  canvasRequested: updates.canvasDeduction, canvasDeducted: actualCanvasDeduction,
                },
              });
            }
          }

          // Process supply updates. POS sales draw down the market tote;
          // online sales draw down main/online stock.
          for (const [supplyId, deduction] of supplyUpdatesMap) {
            const supply = await tx.supply.findUnique({
              where: { id: supplyId },
              select: { quantity: true, marketQuantity: true },
            });

            if (supply) {
              const avail = isPos ? supply.marketQuantity : supply.quantity;
              const actualDeduction = Math.min(deduction, avail);
              if (isPos && actualDeduction < deduction) {
                console.warn(`Sync: POS order ${shopifyOrder.name} exceeded market supply stock for supply ${supplyId}`);
              }
              if (actualDeduction > 0) {
                await tx.supply.update({
                  where: { id: supplyId },
                  data: isPos
                    ? { marketQuantity: { decrement: actualDeduction } }
                    : { quantity: { decrement: actualDeduction } },
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

interface FulfillItem {
  designId?: string;
  supplyId?: string;
  productTitle: string;
  variantTitle?: string | null;
  quantity: number;
  needsKit: boolean;
}

interface FulfillRequest {
  shopifyOrderId: string;
  orderNumber: string;
  customerName?: string;
  items: FulfillItem[];
}

// Aggregated updates per design
interface DesignUpdates {
  canvasDeduction: number;
  kitDeduction: number;
  totalSold: number;
  totalKitsSold: number;
}

// POST - Fulfill an order (deduct kitsReady and canvasPrinted, record local fulfillment)
// Consolidates all updates per design into a single atomic operation
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: FulfillRequest = await request.json();
    const { shopifyOrderId, orderNumber, customerName, items } = body;

    if (!shopifyOrderId || !orderNumber) {
      return NextResponse.json({ error: "Missing shopifyOrderId or orderNumber" }, { status: 400 });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    // Check if already locally fulfilled
    const existingOrder = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
    });

    if (existingOrder?.fulfilledAt) {
      return NextResponse.json(
        { error: "Order already fulfilled locally", fulfilledAt: existingOrder.fulfilledAt },
        { status: 400 }
      );
    }

    // Aggregate updates by designId to consolidate into single updates
    const designUpdatesMap = new Map<string, DesignUpdates>();
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

    let kitsDeducted = 0;
    let canvasesDeducted = 0;
    let suppliesDeducted = 0;

    // Process all updates in a single transaction
    await prisma.$transaction(async (tx) => {
      // Create or update ShopifyOrder record
      const shopifyOrder = await tx.shopifyOrder.upsert({
        where: { shopifyOrderId },
        create: {
          shopifyOrderId,
          orderNumber,
          customerName: customerName || null,
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
            shopifyOrderId: shopifyOrder.id,
            designId: item.designId || null,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle || null,
            quantity: item.quantity,
            needsKit: item.needsKit,
            processed: true,
          },
        });
      }

      // Process design updates - ONE update per design
      for (const [designId, updates] of designUpdatesMap) {
        const design = await tx.design.findUnique({
          where: { id: designId },
          select: { kitsReady: true, canvasPrinted: true },
        });

        if (design) {
          // Calculate safe deductions (don't go below 0)
          const actualCanvasDeduction = Math.min(updates.canvasDeduction, design.canvasPrinted);
          const actualKitDeduction = Math.min(updates.kitDeduction, design.kitsReady);

          // Single consolidated update per design
          await tx.design.update({
            where: { id: designId },
            data: {
              canvasPrinted: actualCanvasDeduction > 0 ? { decrement: actualCanvasDeduction } : undefined,
              kitsReady: actualKitDeduction > 0 ? { decrement: actualKitDeduction } : undefined,
              totalSold: { increment: updates.totalSold },
              totalKitsSold: updates.totalKitsSold > 0 ? { increment: updates.totalKitsSold } : undefined,
            },
          });

          canvasesDeducted += actualCanvasDeduction;
          kitsDeducted += actualKitDeduction;
        }
      }

      // Process supply updates - ONE update per supply
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
            suppliesDeducted += actualDeduction;
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      kitsDeducted,
      canvasesDeducted,
      suppliesDeducted,
    });
  } catch (error) {
    console.error("Error fulfilling order:", error);
    return NextResponse.json(
      { error: "Failed to fulfill order" },
      { status: 500 }
    );
  }
}

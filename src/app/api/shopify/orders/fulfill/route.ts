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

    // Process all updates in a single transaction with idempotency check
    const result = await prisma.$transaction(async (tx) => {
      // Check again inside transaction to prevent race conditions with webhook
      const existingInTx = await tx.shopifyOrder.findUnique({
        where: { shopifyOrderId },
      });

      if (existingInTx?.fulfilledAt) {
        // Already processed (possibly by webhook)
        return { alreadyProcessed: true, kitsDeducted: 0, canvasesDeducted: 0, suppliesDeducted: 0 };
      }

      let kitsDeducted = 0;
      let canvasesDeducted = 0;
      let suppliesDeducted = 0;

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
            supplyId: item.supplyId || null,
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

      return { alreadyProcessed: false, kitsDeducted, canvasesDeducted, suppliesDeducted };
    });

    if (result.alreadyProcessed) {
      return NextResponse.json({
        success: true,
        message: "Order already processed (possibly by webhook)",
        kitsDeducted: 0,
        canvasesDeducted: 0,
        suppliesDeducted: 0,
      });
    }

    return NextResponse.json({
      success: true,
      kitsDeducted: result.kitsDeducted,
      canvasesDeducted: result.canvasesDeducted,
      suppliesDeducted: result.suppliesDeducted,
    });
  } catch (error) {
    console.error("Error fulfilling order:", error);
    return NextResponse.json(
      { error: "Failed to fulfill order" },
      { status: 500 }
    );
  }
}

// DELETE - Undo a local fulfillment (restore inventory)
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const shopifyOrderId = searchParams.get("shopifyOrderId");

    if (!shopifyOrderId) {
      return NextResponse.json({ error: "Missing shopifyOrderId" }, { status: 400 });
    }

    // Find the local order record with its items
    const localOrder = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
      include: {
        items: true,
      },
    });

    if (!localOrder) {
      return NextResponse.json({ error: "Order not found locally" }, { status: 404 });
    }

    if (!localOrder.fulfilledAt) {
      return NextResponse.json({ error: "Order was not fulfilled locally" }, { status: 400 });
    }

    // Aggregate what needs to be restored by designId and supplyId
    const designRestoreMap = new Map<string, {
      canvasRestore: number;
      kitRestore: number;
      totalSoldRestore: number;
      totalKitsSoldRestore: number;
    }>();
    const supplyRestoreMap = new Map<string, number>();

    for (const item of localOrder.items) {
      if (item.designId && item.processed) {
        const existing = designRestoreMap.get(item.designId) || {
          canvasRestore: 0,
          kitRestore: 0,
          totalSoldRestore: 0,
          totalKitsSoldRestore: 0,
        };
        existing.canvasRestore += item.quantity;
        existing.totalSoldRestore += item.quantity;
        if (item.needsKit) {
          existing.kitRestore += item.quantity;
          existing.totalKitsSoldRestore += item.quantity;
        }
        designRestoreMap.set(item.designId, existing);
      }

      // Restore supply inventory using stored supplyId
      if (item.supplyId && item.processed) {
        const existing = supplyRestoreMap.get(item.supplyId) || 0;
        supplyRestoreMap.set(item.supplyId, existing + item.quantity);
      }
    }

    let kitsRestored = 0;
    let canvasesRestored = 0;
    let suppliesRestored = 0;

    // Restore inventory in a transaction
    await prisma.$transaction(async (tx) => {
      // Restore design inventory
      for (const [designId, restore] of designRestoreMap) {
        await tx.design.update({
          where: { id: designId },
          data: {
            canvasPrinted: { increment: restore.canvasRestore },
            kitsReady: restore.kitRestore > 0 ? { increment: restore.kitRestore } : undefined,
            totalSold: { decrement: restore.totalSoldRestore },
            totalKitsSold: restore.totalKitsSoldRestore > 0 ? { decrement: restore.totalKitsSoldRestore } : undefined,
          },
        });

        canvasesRestored += restore.canvasRestore;
        kitsRestored += restore.kitRestore;
      }

      // Restore supply inventory
      for (const [supplyId, quantity] of supplyRestoreMap) {
        await tx.supply.update({
          where: { id: supplyId },
          data: {
            quantity: { increment: quantity },
          },
        });
        suppliesRestored += quantity;
      }

      // Clear fulfillment status (but keep the record for history)
      await tx.shopifyOrder.update({
        where: { shopifyOrderId },
        data: {
          fulfilledAt: null,
        },
      });

      // Mark items as not processed
      await tx.shopifyOrderItem.updateMany({
        where: { shopifyOrderId: localOrder.id },
        data: { processed: false },
      });
    });

    return NextResponse.json({
      success: true,
      kitsRestored,
      canvasesRestored,
      suppliesRestored,
      message: "Fulfillment undone, inventory restored",
    });
  } catch (error) {
    console.error("Error undoing fulfillment:", error);
    return NextResponse.json(
      { error: "Failed to undo fulfillment" },
      { status: 500 }
    );
  }
}

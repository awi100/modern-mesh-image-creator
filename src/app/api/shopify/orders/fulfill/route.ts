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

// POST - Fulfill an order (deduct kitsReady and canvasPrinted, record local fulfillment)
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

    let kitsDeducted = 0;
    let canvasesDeducted = 0;
    let suppliesDeducted = 0;

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

    // Process each item in a transaction and record local fulfillment
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

      for (const item of items) {
        // Create ShopifyOrderItem record
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

        // Handle design items (canvases/kits)
        if (item.designId) {
          // Get current counts
          const design = await tx.design.findUnique({
            where: { id: item.designId },
            select: { kitsReady: true, canvasPrinted: true },
          });

          if (design) {
            // Always deduct canvasPrinted (but not below 0)
            const canvasDeduction = Math.min(item.quantity, design.canvasPrinted);
            if (canvasDeduction > 0) {
              await tx.design.update({
                where: { id: item.designId },
                data: { canvasPrinted: { decrement: canvasDeduction } },
              });
              canvasesDeducted += canvasDeduction;
            }

            // Deduct kitsReady if kit was needed (but not below 0)
            if (item.needsKit) {
              const kitDeduction = Math.min(item.quantity, design.kitsReady);
              if (kitDeduction > 0) {
                await tx.design.update({
                  where: { id: item.designId },
                  data: { kitsReady: { decrement: kitDeduction } },
                });
                kitsDeducted += kitDeduction;
              }
            }

            // Increment sales counts
            await tx.design.update({
              where: { id: item.designId },
              data: {
                totalSold: { increment: item.quantity },
                totalKitsSold: item.needsKit ? { increment: item.quantity } : undefined,
              },
            });
          }
        }

        // Handle supply items
        if (item.supplyId) {
          const supply = await tx.supply.findUnique({
            where: { id: item.supplyId },
            select: { quantity: true },
          });

          if (supply) {
            const supplyDeduction = Math.min(item.quantity, supply.quantity);
            if (supplyDeduction > 0) {
              await tx.supply.update({
                where: { id: item.supplyId },
                data: { quantity: { decrement: supplyDeduction } },
              });
              suppliesDeducted += supplyDeduction;
            }
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

interface FulfillItem {
  designId: string;
  quantity: number;
  needsKit: boolean;
}

// POST - Fulfill an order (deduct kitsReady and canvasPrinted)
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { items } = body as { items: FulfillItem[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    let kitsDeducted = 0;
    let canvasesDeducted = 0;

    // Process each item in a transaction
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (!item.designId) continue;

        // Get current counts
        const design = await tx.design.findUnique({
          where: { id: item.designId },
          select: { kitsReady: true, canvasPrinted: true },
        });

        if (!design) continue;

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
    });

    return NextResponse.json({
      success: true,
      kitsDeducted,
      canvasesDeducted,
    });
  } catch (error) {
    console.error("Error fulfilling order:", error);
    return NextResponse.json(
      { error: "Failed to fulfill order" },
      { status: 500 }
    );
  }
}

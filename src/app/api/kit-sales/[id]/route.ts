import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// DELETE - Reverse a kit sale and restore inventory
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Get the sale with items and design info
    const sale = await prisma.kitSale.findUnique({
      where: { id },
      include: {
        items: true,
        design: { select: { meshCount: true } },
      },
    });

    if (!sale) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }

    const threadSize = sale.design.meshCount === 14 ? 5 : 8;

    // Atomic transaction: restore inventory + delete sale
    await prisma.$transaction(async (tx) => {
      // Restore inventory for each item
      for (const item of sale.items) {
        await tx.inventoryItem.upsert({
          where: {
            dmcNumber_size: {
              dmcNumber: item.dmcNumber,
              size: threadSize,
            },
          },
          update: {
            skeins: { increment: item.skeins },
          },
          create: {
            dmcNumber: item.dmcNumber,
            size: threadSize,
            skeins: item.skeins,
          },
        });
      }

      // Decrement kitsReady on the design
      await tx.design.update({
        where: { id: sale.designId },
        data: { kitsReady: { decrement: 1 } },
      });

      // Delete the sale (cascade deletes items)
      await tx.kitSale.delete({
        where: { id },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reversing kit sale:", error);
    return NextResponse.json(
      { error: "Failed to reverse kit sale" },
      { status: 500 }
    );
  }
}

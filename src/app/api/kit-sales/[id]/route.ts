import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// DELETE - Reverse a kit assembly (decrement kitsReady)
// Note: Thread inventory is managed manually, so we don't restore it here
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Get the sale
    const sale = await prisma.kitSale.findUnique({
      where: { id },
      select: {
        id: true,
        designId: true,
        quantity: true,
      },
    });

    if (!sale) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }

    // Atomic transaction: decrement kitsReady + delete sale
    await prisma.$transaction(async (tx) => {
      // Decrement kitsReady by the quantity that was assembled
      await tx.design.update({
        where: { id: sale.designId },
        data: { kitsReady: { decrement: sale.quantity ?? 1 } },
      });

      // Delete the sale (cascade deletes items if any)
      await tx.kitSale.delete({
        where: { id },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reversing kit assembly:", error);
    return NextResponse.json(
      { error: "Failed to reverse kit assembly" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// POST - Record kit assembly (increments kitsReady)
// Note: Thread inventory is managed manually via the inventory page
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { note, quantity = 1 } = body;

    // Validate quantity
    const qty = Math.max(1, Math.min(100, Math.floor(quantity)));

    const design = await prisma.design.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
      },
    });

    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Create sale record and increment kitsReady in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create kit sale record for tracking history
      const sale = await tx.kitSale.create({
        data: {
          designId: design.id,
          quantity: qty,
          note: note || null,
        },
        select: {
          id: true,
          createdAt: true,
          quantity: true,
          note: true,
        },
      });

      // Increment kitsReady
      const updated = await tx.design.update({
        where: { id: design.id },
        data: { kitsReady: { increment: qty } },
        select: {
          id: true,
          name: true,
          kitsReady: true,
        },
      });

      return { sale, design: updated };
    });

    return NextResponse.json({
      success: true,
      saleId: result.sale.id,
      designId: result.design.id,
      designName: result.design.name,
      kitsAdded: qty,
      newKitsReady: result.design.kitsReady,
      note: result.sale.note,
    }, { status: 201 });
  } catch (error) {
    console.error("Error recording kit assembly:", error);
    return NextResponse.json(
      { error: "Failed to record kit assembly" },
      { status: 500 }
    );
  }
}

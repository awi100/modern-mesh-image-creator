import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// POST - Transfer ALL canvases from Maddie to main for ALL designs
export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Read each row's Maddie count with SELECT FOR UPDATE so the transfer is
    // atomic — prevents the race where two concurrent bulk transfers each see
    // the same canvasPrintedMaddie value and double-credit canvasPrinted.
    const result = await prisma.$transaction(async (tx) => {
      const candidates = await tx.design.findMany({
        where: { canvasPrintedMaddie: { gt: 0 }, deletedAt: null },
        select: { id: true },
      });

      if (candidates.length === 0) {
        return { totalTransferred: 0, designs: [] };
      }

      const updated: { id: string; name: string; canvasPrinted: number; canvasPrintedMaddie: number }[] = [];
      let totalTransferred = 0;

      for (const { id } of candidates) {
        // Lock the row before reading the qty so a concurrent transfer for
        // the same design has to wait for this transaction to commit.
        const locked = await tx.$queryRaw<{ canvasPrintedMaddie: number }[]>`
          SELECT "canvasPrintedMaddie" FROM designs WHERE id = ${id} FOR UPDATE
        `;
        const qty = locked[0]?.canvasPrintedMaddie ?? 0;
        if (qty <= 0) continue;

        const updatedDesign = await tx.design.update({
          where: { id },
          data: {
            canvasPrinted: { increment: qty },
            canvasPrintedMaddie: 0,
          },
          select: { id: true, name: true, canvasPrinted: true, canvasPrintedMaddie: true },
        });
        totalTransferred += qty;
        updated.push(updatedDesign);
      }

      return { totalTransferred, designs: updated };
    });

    return NextResponse.json({
      success: true,
      totalTransferred: result.totalTransferred,
      designCount: result.designs.length,
      designs: result.designs,
    });
  } catch (error) {
    console.error("Error bulk transferring canvases:", error);
    return NextResponse.json(
      { error: "Failed to transfer canvases" },
      { status: 500 }
    );
  }
}

// PUT - Transfer ALL canvases from Maddie to main for a specific design
// Uses transaction with atomic operations to prevent race conditions
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { designId } = body;

    if (!designId) {
      return NextResponse.json(
        { error: "designId is required" },
        { status: 400 }
      );
    }

    // Use transaction with SELECT FOR UPDATE so concurrent transfers for the
    // same design can't both read the same canvasPrintedMaddie and double-credit.
    const result = await prisma.$transaction(async (tx) => {
      // Lock the row and read the qty atomically.
      const locked = await tx.$queryRaw<{ canvasPrintedMaddie: number }[]>`
        SELECT "canvasPrintedMaddie" FROM designs WHERE id = ${designId} FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("Design not found");
      }

      const quantity = locked[0].canvasPrintedMaddie;
      if (quantity <= 0) {
        throw new Error("No canvases at Maddie's location to transfer");
      }

      // Atomic transfer: increment main, set Maddie's to 0
      const updatedDesign = await tx.design.update({
        where: { id: designId },
        data: {
          canvasPrinted: { increment: quantity },
          canvasPrintedMaddie: 0,
        },
        select: {
          id: true,
          name: true,
          canvasPrinted: true,
          canvasPrintedMaddie: true,
        },
      });

      return { quantity, design: updatedDesign };
    });

    return NextResponse.json({
      success: true,
      transferred: result.quantity,
      design: result.design,
    });
  } catch (error) {
    console.error("Error transferring canvases:", error);

    // Handle specific error messages
    if (error instanceof Error) {
      if (error.message === "Design not found") {
        return NextResponse.json({ error: "Design not found" }, { status: 404 });
      }
      if (error.message === "No canvases at Maddie's location to transfer") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json(
      { error: "Failed to transfer canvases" },
      { status: 500 }
    );
  }
}

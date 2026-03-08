import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

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

    // Use transaction for atomic transfer
    const result = await prisma.$transaction(async (tx) => {
      // Get current design within transaction
      const design = await tx.design.findUnique({
        where: { id: designId },
        select: { canvasPrinted: true, canvasPrintedMaddie: true },
      });

      if (!design) {
        throw new Error("Design not found");
      }

      if (design.canvasPrintedMaddie === 0) {
        throw new Error("No canvases at Maddie's location to transfer");
      }

      const quantity = design.canvasPrintedMaddie;

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

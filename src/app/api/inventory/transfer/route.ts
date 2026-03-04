import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// PUT - Transfer ALL canvases from Maddie to main for a specific design
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

    // Get current design
    const design = await prisma.design.findUnique({
      where: { id: designId },
      select: { canvasPrinted: true, canvasPrintedMaddie: true },
    });

    if (!design) {
      return NextResponse.json(
        { error: "Design not found" },
        { status: 404 }
      );
    }

    if (design.canvasPrintedMaddie === 0) {
      return NextResponse.json(
        { error: "No canvases at Maddie's location to transfer" },
        { status: 400 }
      );
    }

    const quantity = design.canvasPrintedMaddie;

    // Transfer: add to main, set Maddie's to 0
    const updatedDesign = await prisma.design.update({
      where: { id: designId },
      data: {
        canvasPrinted: design.canvasPrinted + quantity,
        canvasPrintedMaddie: 0,
      },
      select: {
        id: true,
        name: true,
        canvasPrinted: true,
        canvasPrintedMaddie: true,
      },
    });

    return NextResponse.json({
      success: true,
      transferred: quantity,
      design: updatedDesign,
    });
  } catch (error) {
    console.error("Error transferring canvases:", error);
    return NextResponse.json(
      { error: "Failed to transfer canvases" },
      { status: 500 }
    );
  }
}

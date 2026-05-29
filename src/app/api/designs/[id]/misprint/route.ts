import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// PATCH - Adjust a design's misprintCount by a signed delta.
// Atomic and clamped at 0 (won't go negative).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { delta } = body;

    if (typeof delta !== "number" || !Number.isInteger(delta)) {
      return NextResponse.json(
        { error: "delta must be an integer" },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const design = await tx.design.findUnique({
        where: { id },
        select: { misprintCount: true },
      });
      if (!design) {
        return null;
      }

      const next = design.misprintCount + delta;
      if (next < 0) {
        return tx.design.update({
          where: { id },
          data: { misprintCount: 0 },
          select: { id: true, misprintCount: true },
        });
      }
      return tx.design.update({
        where: { id },
        data: { misprintCount: { increment: delta } },
        select: { id: true, misprintCount: true },
      });
    });

    if (!updated) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating misprint count:", error);
    return NextResponse.json(
      { error: "Failed to update misprint count" },
      { status: 500 }
    );
  }
}

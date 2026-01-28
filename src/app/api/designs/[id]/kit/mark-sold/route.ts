import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// POST - Mark a kit as sold (decrement kitsReady)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const design = await prisma.design.findUnique({
      where: { id },
      select: { id: true, kitsReady: true },
    });

    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    if (design.kitsReady <= 0) {
      return NextResponse.json(
        { error: "No assembled kits to sell" },
        { status: 400 }
      );
    }

    const updated = await prisma.design.update({
      where: { id },
      data: { kitsReady: { decrement: 1 } },
      select: { id: true, kitsReady: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error marking kit sold:", error);
    return NextResponse.json(
      { error: "Failed to mark kit sold" },
      { status: 500 }
    );
  }
}

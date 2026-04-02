import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET /api/finishing/orders - List all finishing orders across all finishers
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }

    const orders = await prisma.finisherOrder.findMany({
      where,
      include: {
        finisher: { select: { id: true, name: true } },
        design: { select: { id: true, name: true, previewImageUrl: true } },
      },
      orderBy: { sentAt: "desc" },
    });

    return NextResponse.json(orders);
  } catch (error) {
    console.error("[GET /api/finishing/orders] Error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

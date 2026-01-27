import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET - List kit sales
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const designId = searchParams.get("designId");

    const where: Record<string, unknown> = {};
    if (designId) {
      where.designId = designId;
    }

    const sales = await prisma.kitSale.findMany({
      where,
      include: {
        design: { select: { id: true, name: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(sales);
  } catch (error) {
    console.error("Error fetching kit sales:", error);
    return NextResponse.json(
      { error: "Failed to fetch kit sales" },
      { status: 500 }
    );
  }
}

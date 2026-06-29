import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET - Recent inventory deduction log (audit of what each order pulled).
// Optional filters: ?search=<design name> and ?bucket=market|online.
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const bucket = searchParams.get("bucket");
    const limit = Math.min(parseInt(searchParams.get("limit") || "300", 10) || 300, 1000);

    const where: Record<string, unknown> = {};
    if (search) where.designName = { contains: search, mode: "insensitive" };
    if (bucket === "market" || bucket === "online") where.bucket = bucket;

    const rows = await prisma.orderDeduction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching deduction log:", error);
    return NextResponse.json({ error: "Failed to fetch deduction log" }, { status: 500 });
  }
}

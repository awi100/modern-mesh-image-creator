import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET - all bobbin inventory rows
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await prisma.bobbinInventory.findMany({
    orderBy: { dmcNumber: "asc" },
  });
  return NextResponse.json(items);
}

// POST - upsert a count for a (DMC color, length) bobbin
// Body: { dmcNumber: string, length: number, count: number }
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { dmcNumber, length, count } = await request.json();
    if (!dmcNumber || typeof length !== "number" || length <= 0 || typeof count !== "number" || count < 0) {
      return NextResponse.json({ error: "dmcNumber, positive length, and non-negative count required" }, { status: 400 });
    }
    const item = await prisma.bobbinInventory.upsert({
      where: { dmcNumber_length: { dmcNumber, length } },
      create: { dmcNumber, length, count },
      update: { count },
    });
    return NextResponse.json(item);
  } catch (error) {
    console.error("[POST bobbins] Error:", error);
    return NextResponse.json({ error: "Failed to save bobbin count" }, { status: 500 });
  }
}

// PATCH - increment/decrement
// Body: { dmcNumber: string, length: number, delta: number }
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { dmcNumber, length, delta } = await request.json();
    if (!dmcNumber || typeof length !== "number" || length <= 0 || typeof delta !== "number") {
      return NextResponse.json({ error: "dmcNumber, length, and delta required" }, { status: 400 });
    }
    const existing = await prisma.bobbinInventory.findUnique({ where: { dmcNumber_length: { dmcNumber, length } } });
    const newCount = Math.max(0, (existing?.count || 0) + delta);
    const item = await prisma.bobbinInventory.upsert({
      where: { dmcNumber_length: { dmcNumber, length } },
      create: { dmcNumber, length, count: newCount },
      update: { count: newCount },
    });
    return NextResponse.json(item);
  } catch (error) {
    console.error("[PATCH bobbins] Error:", error);
    return NextResponse.json({ error: "Failed to update bobbin count" }, { status: 500 });
  }
}

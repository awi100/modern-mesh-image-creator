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

// POST - upsert a count for a (DMC color, length, threadSize) bobbin
// Body: { dmcNumber: string, length: number, threadSize?: number, count: number }
// threadSize defaults to 5 (used by 14/18ct designs). 13ct designs use threadSize 3.
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { dmcNumber, length, threadSize = 5, count } = await request.json();
    if (!dmcNumber || typeof length !== "number" || length <= 0 ||
        (threadSize !== 3 && threadSize !== 5) ||
        typeof count !== "number" || count < 0) {
      return NextResponse.json(
        { error: "dmcNumber, positive length, threadSize (3 or 5), and non-negative count required" },
        { status: 400 }
      );
    }
    const item = await prisma.bobbinInventory.upsert({
      where: { dmcNumber_length_threadSize: { dmcNumber, length, threadSize } },
      create: { dmcNumber, length, threadSize, count },
      update: { count },
    });
    return NextResponse.json(item);
  } catch (error) {
    console.error("[POST bobbins] Error:", error);
    return NextResponse.json({ error: "Failed to save bobbin count" }, { status: 500 });
  }
}

// PATCH - increment/decrement
// Body: { dmcNumber: string, length: number, threadSize?: number, delta: number }
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { dmcNumber, length, threadSize = 5, delta } = await request.json();
    if (!dmcNumber || typeof length !== "number" || length <= 0 ||
        (threadSize !== 3 && threadSize !== 5) ||
        typeof delta !== "number") {
      return NextResponse.json(
        { error: "dmcNumber, length, threadSize (3 or 5), and delta required" },
        { status: 400 }
      );
    }
    // Atomic read-modify-write inside a transaction with an atomic increment,
    // so concurrent +/- clicks can't lose an update.
    const item = await prisma.$transaction(async (tx) => {
      const key = { dmcNumber_length_threadSize: { dmcNumber, length, threadSize } };
      const existing = await tx.bobbinInventory.findUnique({ where: key });
      if (!existing) {
        return tx.bobbinInventory.create({
          data: { dmcNumber, length, threadSize, count: Math.max(0, delta) },
        });
      }
      if (existing.count + delta < 0) {
        return tx.bobbinInventory.update({ where: key, data: { count: 0 } });
      }
      return tx.bobbinInventory.update({ where: key, data: { count: { increment: delta } } });
    });
    return NextResponse.json(item);
  } catch (error) {
    console.error("[PATCH bobbins] Error:", error);
    return NextResponse.json({ error: "Failed to update bobbin count" }, { status: 500 });
  }
}

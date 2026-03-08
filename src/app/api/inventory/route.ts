import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET - List all inventory items
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const size = searchParams.get("size");
    const search = searchParams.get("search");

    const where: Record<string, unknown> = {};

    if (size) {
      where.size = Number(size);
    }

    if (search) {
      where.dmcNumber = { contains: search, mode: "insensitive" };
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      orderBy: { dmcNumber: "asc" },
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}

// POST - Add or update an inventory item
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { dmcNumber, size, skeins } = body;

    if (!dmcNumber || !size || skeins === undefined) {
      return NextResponse.json(
        { error: "dmcNumber, size, and skeins are required" },
        { status: 400 }
      );
    }

    if (size !== 5 && size !== 8) {
      return NextResponse.json(
        { error: "Size must be 5 or 8" },
        { status: 400 }
      );
    }

    // Upsert: create or update if already exists
    const item = await prisma.inventoryItem.upsert({
      where: {
        dmcNumber_size: { dmcNumber, size: Number(size) },
      },
      update: {
        skeins: Number(skeins),
      },
      create: {
        dmcNumber,
        size: Number(size),
        skeins: Number(skeins),
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error("Error creating inventory item:", error);
    return NextResponse.json(
      { error: "Failed to create inventory item" },
      { status: 500 }
    );
  }
}

// PATCH - Increment/decrement an inventory item by delta
// Uses transaction with atomic operations to prevent race conditions
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { dmcNumber, size, delta } = body;

    if (!dmcNumber || !size || delta === undefined) {
      return NextResponse.json(
        { error: "dmcNumber, size, and delta are required" },
        { status: 400 }
      );
    }

    if (size !== 5 && size !== 8) {
      return NextResponse.json(
        { error: "Size must be 5 or 8" },
        { status: 400 }
      );
    }

    const numDelta = Number(delta);
    const numSize = Number(size);

    // Use transaction for atomic update with floor check
    const item = await prisma.$transaction(async (tx) => {
      // Check if item exists
      const existing = await tx.inventoryItem.findUnique({
        where: { dmcNumber_size: { dmcNumber, size: numSize } },
      });

      if (existing) {
        // Item exists - use atomic increment if result would be >= 0
        const newSkeins = existing.skeins + numDelta;
        if (newSkeins < 0) {
          // Would go negative, clamp to 0
          return tx.inventoryItem.update({
            where: { dmcNumber_size: { dmcNumber, size: numSize } },
            data: { skeins: 0 },
          });
        } else {
          // Safe to use atomic increment
          return tx.inventoryItem.update({
            where: { dmcNumber_size: { dmcNumber, size: numSize } },
            data: { skeins: { increment: numDelta } },
          });
        }
      } else {
        // Item doesn't exist - create with delta (clamped to 0 minimum)
        return tx.inventoryItem.create({
          data: {
            dmcNumber,
            size: numSize,
            skeins: Math.max(0, numDelta),
          },
        });
      }
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating inventory item:", error);
    return NextResponse.json(
      { error: "Failed to update inventory item" },
      { status: 500 }
    );
  }
}

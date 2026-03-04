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

    // Find existing inventory or create with 0
    const existing = await prisma.inventoryItem.findUnique({
      where: {
        dmcNumber_size: { dmcNumber, size: Number(size) },
      },
    });

    const currentSkeins = existing?.skeins ?? 0;
    const newSkeins = Math.max(0, currentSkeins + Number(delta));

    const item = await prisma.inventoryItem.upsert({
      where: {
        dmcNumber_size: { dmcNumber, size: Number(size) },
      },
      update: {
        skeins: newSkeins,
      },
      create: {
        dmcNumber,
        size: Number(size),
        skeins: newSkeins,
      },
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

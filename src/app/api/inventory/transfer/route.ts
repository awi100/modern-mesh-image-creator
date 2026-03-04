import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// POST - Transfer inventory from one location to another
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { dmcNumber, size, quantity, from = "maddie", to = "main" } = body;

    if (!dmcNumber || !size || !quantity) {
      return NextResponse.json(
        { error: "dmcNumber, size, and quantity are required" },
        { status: 400 }
      );
    }

    if (quantity <= 0) {
      return NextResponse.json(
        { error: "Quantity must be positive" },
        { status: 400 }
      );
    }

    // Get source inventory
    const sourceItem = await prisma.inventoryItem.findUnique({
      where: {
        dmcNumber_size_location: { dmcNumber, size: Number(size), location: from },
      },
    });

    if (!sourceItem || sourceItem.skeins < quantity) {
      return NextResponse.json(
        { error: `Insufficient inventory at ${from} location` },
        { status: 400 }
      );
    }

    // Transfer: subtract from source, add to destination
    const [updatedSource, updatedDest] = await prisma.$transaction([
      // Subtract from source
      prisma.inventoryItem.update({
        where: {
          dmcNumber_size_location: { dmcNumber, size: Number(size), location: from },
        },
        data: {
          skeins: sourceItem.skeins - quantity,
        },
      }),
      // Add to destination
      prisma.inventoryItem.upsert({
        where: {
          dmcNumber_size_location: { dmcNumber, size: Number(size), location: to },
        },
        update: {
          skeins: { increment: quantity },
        },
        create: {
          dmcNumber,
          size: Number(size),
          skeins: quantity,
          location: to,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      transferred: quantity,
      source: updatedSource,
      destination: updatedDest,
    });
  } catch (error) {
    console.error("Error transferring inventory:", error);
    return NextResponse.json(
      { error: "Failed to transfer inventory" },
      { status: 500 }
    );
  }
}

// POST - Transfer ALL inventory from maddie to main for a specific color
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { dmcNumber, size, from = "maddie", to = "main" } = body;

    if (!dmcNumber || !size) {
      return NextResponse.json(
        { error: "dmcNumber and size are required" },
        { status: 400 }
      );
    }

    // Get source inventory
    const sourceItem = await prisma.inventoryItem.findUnique({
      where: {
        dmcNumber_size_location: { dmcNumber, size: Number(size), location: from },
      },
    });

    if (!sourceItem || sourceItem.skeins === 0) {
      return NextResponse.json(
        { error: `No inventory at ${from} location` },
        { status: 400 }
      );
    }

    const quantity = sourceItem.skeins;

    // Transfer all: set source to 0, add to destination
    const [updatedSource, updatedDest] = await prisma.$transaction([
      // Set source to 0
      prisma.inventoryItem.update({
        where: {
          dmcNumber_size_location: { dmcNumber, size: Number(size), location: from },
        },
        data: {
          skeins: 0,
        },
      }),
      // Add to destination
      prisma.inventoryItem.upsert({
        where: {
          dmcNumber_size_location: { dmcNumber, size: Number(size), location: to },
        },
        update: {
          skeins: { increment: quantity },
        },
        create: {
          dmcNumber,
          size: Number(size),
          skeins: quantity,
          location: to,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      transferred: quantity,
      source: updatedSource,
      destination: updatedDest,
    });
  } catch (error) {
    console.error("Error transferring all inventory:", error);
    return NextResponse.json(
      { error: "Failed to transfer inventory" },
      { status: 500 }
    );
  }
}

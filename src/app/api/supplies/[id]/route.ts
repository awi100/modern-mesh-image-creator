import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET - Fetch a single supply
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const supply = await prisma.supply.findUnique({
      where: { id },
    });

    if (!supply) {
      return NextResponse.json({ error: "Supply not found" }, { status: 404 });
    }

    return NextResponse.json(supply);
  } catch (error) {
    console.error("Error fetching supply:", error);
    return NextResponse.json(
      { error: "Failed to fetch supply" },
      { status: 500 }
    );
  }
}

// PATCH - Update a supply
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

    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      updateData.name = body.name.trim();
    }
    if (body.sku !== undefined) {
      updateData.sku = body.sku?.trim() || null;
    }
    if (body.description !== undefined) {
      updateData.description = body.description?.trim() || null;
    }
    if (body.imageUrl !== undefined) {
      updateData.imageUrl = body.imageUrl?.trim() || null;
    }
    if (body.quantity !== undefined) {
      updateData.quantity = Math.max(0, Math.floor(body.quantity));
    }
    if (body.quantityDelta !== undefined) {
      // Increment/decrement quantity
      const delta = Math.floor(body.quantityDelta);
      const current = await prisma.supply.findUnique({
        where: { id },
        select: { quantity: true },
      });
      if (current) {
        updateData.quantity = Math.max(0, current.quantity + delta);
      }
    }
    if (body.marketQuantity !== undefined) {
      updateData.marketQuantity = Math.max(0, Math.floor(body.marketQuantity));
    }
    // Market transfer: move stock between main and the market tote, conserving
    // the total. Positive = main -> market; negative = market -> main. Clamped
    // so neither side goes below 0.
    if (body.marketTransferDelta !== undefined) {
      const requested = Math.trunc(body.marketTransferDelta);
      const current = await prisma.supply.findUnique({
        where: { id },
        select: { quantity: true, marketQuantity: true },
      });
      if (current) {
        const moved = requested >= 0
          ? Math.min(requested, current.quantity)
          : -Math.min(-requested, current.marketQuantity);
        if (moved !== 0) {
          updateData.quantity = Math.max(0, current.quantity - moved);
          updateData.marketQuantity = Math.max(0, current.marketQuantity + moved);
        }
      }
    }

    const supply = await prisma.supply.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(supply);
  } catch (error) {
    console.error("Error updating supply:", error);

    if (error instanceof Error && error.message.includes("Record to update not found")) {
      return NextResponse.json({ error: "Supply not found" }, { status: 404 });
    }

    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A supply with this name already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update supply" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a supply
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    await prisma.supply.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting supply:", error);

    if (error instanceof Error && error.message.includes("Record to delete does not exist")) {
      return NextResponse.json({ error: "Supply not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to delete supply" },
      { status: 500 }
    );
  }
}

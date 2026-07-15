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

    // Validate numeric fields up front (a string/NaN would corrupt the count).
    for (const field of ["quantity", "quantityDelta", "marketQuantity", "marketTransferDelta"] as const) {
      if (body[field] !== undefined && !Number.isFinite(Number(body[field]))) {
        return NextResponse.json({ error: `${field} must be a number` }, { status: 400 });
      }
    }

    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
      }
      updateData.name = body.name.trim();
    }
    if (body.sku !== undefined) {
      updateData.sku = typeof body.sku === "string" ? (body.sku.trim() || null) : null;
    }
    if (body.description !== undefined) {
      updateData.description = typeof body.description === "string" ? (body.description.trim() || null) : null;
    }
    if (body.imageUrl !== undefined) {
      updateData.imageUrl = typeof body.imageUrl === "string" ? (body.imageUrl.trim() || null) : null;
    }
    if (body.quantity !== undefined) {
      updateData.quantity = Math.max(0, Math.floor(Number(body.quantity)));
    }
    if (body.marketQuantity !== undefined) {
      updateData.marketQuantity = Math.max(0, Math.floor(Number(body.marketQuantity)));
    }

    // Delta / transfer operations depend on the current row, so read and write
    // them inside a transaction to avoid lost updates under concurrency.
    const hasDelta = body.quantityDelta !== undefined || body.marketTransferDelta !== undefined;

    const supply = await prisma.$transaction(async (tx) => {
      if (hasDelta) {
        const current = await tx.supply.findUnique({
          where: { id },
          select: { quantity: true, marketQuantity: true },
        });
        if (!current) {
          throw new Error("Record to update not found");
        }
        if (body.quantityDelta !== undefined) {
          const delta = Math.floor(Number(body.quantityDelta));
          updateData.quantity = Math.max(0, current.quantity + delta);
        }
        // Market transfer: move stock between main and the market tote,
        // conserving the total; clamped so neither side goes below 0.
        if (body.marketTransferDelta !== undefined) {
          const requested = Math.trunc(Number(body.marketTransferDelta));
          const base = updateData.quantity !== undefined ? (updateData.quantity as number) : current.quantity;
          const moved = requested >= 0
            ? Math.min(requested, base)
            : -Math.min(-requested, current.marketQuantity);
          if (moved !== 0) {
            updateData.quantity = Math.max(0, base - moved);
            updateData.marketQuantity = Math.max(0, current.marketQuantity + moved);
          }
        }
      }
      return tx.supply.update({ where: { id }, data: updateData });
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

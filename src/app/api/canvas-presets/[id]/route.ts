import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// DELETE - Delete a canvas preset
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    await prisma.canvasPreset.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting canvas preset:", error);
    return NextResponse.json(
      { error: "Failed to delete preset" },
      { status: 500 }
    );
  }
}

// PATCH - Update a canvas preset
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

    // Whitelist updatable fields and validate types — never pass the raw body
    // to Prisma (mass-assignment).
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
      }
      data.name = body.name.trim();
    }
    if (body.widthInches !== undefined) {
      const w = Number(body.widthInches);
      if (!Number.isFinite(w) || w <= 0) {
        return NextResponse.json({ error: "widthInches must be a positive number" }, { status: 400 });
      }
      data.widthInches = w;
    }
    if (body.heightInches !== undefined) {
      const h = Number(body.heightInches);
      if (!Number.isFinite(h) || h <= 0) {
        return NextResponse.json({ error: "heightInches must be a positive number" }, { status: 400 });
      }
      data.heightInches = h;
    }
    if (body.description !== undefined) {
      data.description = typeof body.description === "string" ? body.description : null;
    }
    if (body.sortOrder !== undefined) {
      const s = Number(body.sortOrder);
      if (!Number.isFinite(s) || !Number.isInteger(s)) {
        return NextResponse.json({ error: "sortOrder must be an integer" }, { status: 400 });
      }
      data.sortOrder = s;
    }

    const preset = await prisma.canvasPreset.update({
      where: { id },
      data,
    });

    return NextResponse.json(preset);
  } catch (error) {
    console.error("Error updating canvas preset:", error);
    return NextResponse.json(
      { error: "Failed to update preset" },
      { status: 500 }
    );
  }
}

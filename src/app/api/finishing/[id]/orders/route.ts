import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET /api/finishing/[id]/orders - List orders for a finisher
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const orders = await prisma.finisherOrder.findMany({
      where: { finisherId: id },
      include: {
        design: { select: { id: true, name: true, previewImageUrl: true } },
      },
      orderBy: { sentAt: "desc" },
    });

    return NextResponse.json(orders);
  } catch (error) {
    console.error("[GET /api/finishing/[id]/orders] Error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

// POST /api/finishing/[id]/orders - Create a new finishing order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const order = await prisma.finisherOrder.create({
      data: {
        finisherId: id,
        designId: body.designId || null,
        sentAt: body.sentAt ? new Date(body.sentAt) : new Date(),
        cost: body.cost ? parseFloat(body.cost) : null,
        status: body.status || "sent",
        productType: body.productType || null,
        notes: body.notes || null,
      },
      include: {
        design: { select: { id: true, name: true, previewImageUrl: true } },
      },
    });

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("[POST /api/finishing/[id]/orders] Error:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}

// PATCH /api/finishing/[id]/orders - Update a finishing order
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { id, ...updates } = body;
    if (updates.sentAt) updates.sentAt = new Date(updates.sentAt);
    if (updates.receivedAt) updates.receivedAt = new Date(updates.receivedAt);
    if (updates.cost !== undefined) updates.cost = updates.cost ? parseFloat(updates.cost) : null;

    const updated = await prisma.finisherOrder.update({
      where: { id },
      data: updates,
      include: {
        design: { select: { id: true, name: true, previewImageUrl: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/finishing/[id]/orders] Error:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}

// DELETE /api/finishing/[id]/orders - Delete a finishing order
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.finisherOrder.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/finishing/[id]/orders] Error:", error);
    return NextResponse.json({ error: "Failed to delete order" }, { status: 500 });
  }
}

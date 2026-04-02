import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET /api/finishing - List all finishers with computed stats
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const finishers = await prisma.finisher.findMany({
      include: {
        orders: {
          select: { id: true, status: true, cost: true, sentAt: true, receivedAt: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const enriched = finishers.map((f) => {
      const completedOrders = f.orders.filter((o) => o.receivedAt && o.sentAt);
      const avgTurnaround =
        completedOrders.length > 0
          ? Math.round(
              completedOrders.reduce(
                (sum, o) =>
                  sum +
                  (new Date(o.receivedAt!).getTime() - new Date(o.sentAt).getTime()) / 86400000,
                0
              ) / completedOrders.length
            )
          : null;
      const totalSpent = f.orders.reduce((sum, o) => sum + (o.cost || 0), 0);
      const activeOrders = f.orders.filter((o) => o.status !== "finished").length;

      return {
        ...f,
        avgTurnaround,
        totalSpent,
        activeOrders,
        orderCount: f.orders.length,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("[GET /api/finishing] Error:", error);
    return NextResponse.json({ error: "Failed to fetch finishers" }, { status: 500 });
  }
}

// POST /api/finishing - Create a new finisher
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const finisher = await prisma.finisher.create({
      data: {
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        website: body.website || null,
        turnaroundDays: body.turnaroundDays ? parseInt(body.turnaroundDays) : null,
        rating: body.rating ? parseInt(body.rating) : null,
        notes: body.notes || null,
      },
    });

    return NextResponse.json(finisher, { status: 201 });
  } catch (error) {
    console.error("[POST /api/finishing] Error:", error);
    return NextResponse.json({ error: "Failed to create finisher" }, { status: 500 });
  }
}

// PATCH /api/finishing - Update a finisher
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
    if (updates.turnaroundDays) updates.turnaroundDays = parseInt(updates.turnaroundDays);
    if (updates.rating) updates.rating = parseInt(updates.rating);

    const updated = await prisma.finisher.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/finishing] Error:", error);
    return NextResponse.json({ error: "Failed to update finisher" }, { status: 500 });
  }
}

// DELETE /api/finishing - Delete a finisher and all their orders
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.finisher.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/finishing] Error:", error);
    return NextResponse.json({ error: "Failed to delete finisher" }, { status: 500 });
  }
}

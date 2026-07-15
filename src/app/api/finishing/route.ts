import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET /api/finishing - List all finishing projects
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const projects = await prisma.finishingProject.findMany({
      where,
      include: {
        design: {
          select: { id: true, name: true, previewImageUrl: true, meshCount: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error("[GET /api/finishing] Error:", error);
    return NextResponse.json({ error: "Failed to fetch finishing projects" }, { status: 500 });
  }
}

// POST /api/finishing - Create a new finishing project
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.designId) {
      return NextResponse.json({ error: "designId is required" }, { status: 400 });
    }
    if (!body.person) {
      return NextResponse.json({ error: "person is required" }, { status: 400 });
    }

    const project = await prisma.finishingProject.create({
      data: {
        designId: body.designId,
        person: body.person,
        status: body.status || "wip",
        productType: body.productType || null,
        startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
        finishedAt: body.finishedAt ? new Date(body.finishedAt) : null,
        notes: body.notes || null,
      },
      include: {
        design: {
          select: { id: true, name: true, previewImageUrl: true, meshCount: true },
        },
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("[POST /api/finishing] Error:", error);
    return NextResponse.json({ error: "Failed to create finishing project" }, { status: 500 });
  }
}

// PATCH /api/finishing - Update a finishing project
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Allow-list updatable fields — never pass the raw body to Prisma
    // (mass-assignment would let a caller repoint designId, overwrite
    // createdAt, etc).
    const { id } = body;
    const updates: {
      person?: string;
      status?: string;
      productType?: string | null;
      notes?: string | null;
      startedAt?: Date;
      finishedAt?: Date | null;
    } = {};
    if (typeof body.person === "string") updates.person = body.person;
    if (typeof body.status === "string") updates.status = body.status;
    if (body.productType !== undefined) updates.productType = body.productType || null;
    if (body.notes !== undefined) updates.notes = body.notes || null;
    if (body.startedAt !== undefined) {
      const d = new Date(body.startedAt);
      if (isNaN(d.getTime())) return NextResponse.json({ error: "Invalid startedAt" }, { status: 400 });
      updates.startedAt = d;
    }
    if (body.finishedAt !== undefined) {
      if (body.finishedAt === null) {
        updates.finishedAt = null;
      } else {
        const d = new Date(body.finishedAt);
        if (isNaN(d.getTime())) return NextResponse.json({ error: "Invalid finishedAt" }, { status: 400 });
        updates.finishedAt = d;
      }
    }

    const updated = await prisma.finishingProject.update({
      where: { id },
      data: updates,
      include: {
        design: {
          select: { id: true, name: true, previewImageUrl: true, meshCount: true },
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/finishing] Error:", error);
    return NextResponse.json({ error: "Failed to update finishing project" }, { status: 500 });
  }
}

// DELETE /api/finishing - Delete a finishing project
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.finishingProject.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/finishing] Error:", error);
    return NextResponse.json({ error: "Failed to delete finishing project" }, { status: 500 });
  }
}

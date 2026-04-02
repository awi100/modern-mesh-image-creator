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

    const { id, ...updates } = body;
    if (updates.startedAt) updates.startedAt = new Date(updates.startedAt);
    if (updates.finishedAt) updates.finishedAt = new Date(updates.finishedAt);

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

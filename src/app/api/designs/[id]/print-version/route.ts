import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, MeshCount } from "@/lib/yarn-calculator";
import pako from "pako";

// GET /api/designs/[id]/print-version - Check if a print version exists
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    let printVersion = await prisma.design.findUnique({
      where: { printVersionOf: id },
      select: {
        id: true,
        name: true,
        colorsUsed: true,
        updatedAt: true,
      },
    });

    // Auto-create if it doesn't exist yet (backfill for older designs)
    if (!printVersion) {
      const original = await prisma.design.findUnique({ where: { id } });
      if (original && !original.printVersionOf) {
        const created = await prisma.design.create({
          data: {
            name: `${original.name} (Print)`,
            widthInches: original.widthInches,
            heightInches: original.heightInches,
            meshCount: original.meshCount,
            gridWidth: original.gridWidth,
            gridHeight: original.gridHeight,
            pixelData: original.pixelData,
            stitchType: original.stitchType,
            bufferPercent: original.bufferPercent,
            kitColorCount: original.kitColorCount,
            kitSkeinCount: original.kitSkeinCount,
            colorsUsed: original.colorsUsed,
            totalStitches: original.totalStitches,
            folderId: original.folderId,
            isDraft: original.isDraft,
            printVersionOf: id,
          },
        });
        printVersion = {
          id: created.id,
          name: created.name,
          colorsUsed: created.colorsUsed,
          updatedAt: created.updatedAt,
        };
      }
    }

    return NextResponse.json({ printVersion });
  } catch (error) {
    console.error("[GET print-version] Error:", error);
    return NextResponse.json({ error: "Failed to check print version" }, { status: 500 });
  }
}

// POST /api/designs/[id]/print-version - Create a print version copy
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Check if print version already exists
    const existing = await prisma.design.findUnique({
      where: { printVersionOf: id },
    });

    if (existing) {
      return NextResponse.json({ error: "Print version already exists", id: existing.id }, { status: 409 });
    }

    // Get the original design
    const original = await prisma.design.findUnique({
      where: { id },
      include: { tags: true },
    });

    if (!original) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Don't create a print version of a print version
    if (original.printVersionOf) {
      return NextResponse.json({ error: "Cannot create print version of a print version" }, { status: 400 });
    }

    // Create print version with same grid data
    const printVersion = await prisma.design.create({
      data: {
        name: `${original.name} (Print)`,
        widthInches: original.widthInches,
        heightInches: original.heightInches,
        meshCount: original.meshCount,
        gridWidth: original.gridWidth,
        gridHeight: original.gridHeight,
        pixelData: original.pixelData,
        stitchType: original.stitchType,
        bufferPercent: original.bufferPercent,
        folderId: original.folderId,
        isDraft: original.isDraft,
        skillLevel: original.skillLevel,
        sizeCategory: original.sizeCategory,
        kitColorCount: original.kitColorCount,
        kitSkeinCount: original.kitSkeinCount,
        colorsUsed: original.colorsUsed,
        totalStitches: original.totalStitches,
        printVersionOf: id,
      },
    });

    // Copy tags
    if (original.tags.length > 0) {
      await prisma.designTag.createMany({
        data: original.tags.map((dt) => ({
          designId: printVersion.id,
          tagId: dt.tagId,
        })),
      });
    }

    return NextResponse.json({
      id: printVersion.id,
      name: printVersion.name,
    });
  } catch (error) {
    console.error("[POST print-version] Error:", error);
    return NextResponse.json({ error: "Failed to create print version" }, { status: 500 });
  }
}

// DELETE /api/designs/[id]/print-version - Delete the print version
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const printVersion = await prisma.design.findUnique({
      where: { printVersionOf: id },
    });

    if (!printVersion) {
      return NextResponse.json({ error: "No print version found" }, { status: 404 });
    }

    await prisma.design.delete({
      where: { id: printVersion.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE print-version] Error:", error);
    return NextResponse.json({ error: "Failed to delete print version" }, { status: 500 });
  }
}

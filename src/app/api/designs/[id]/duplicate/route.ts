import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Get the original design
    const original = await prisma.design.findUnique({
      where: { id },
      include: {
        tags: true,
      },
    });

    if (!original) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Create duplicate with "(Copy)" appended to name
    const duplicate = await prisma.design.create({
      data: {
        name: `${original.name} (Copy)`,
        widthInches: original.widthInches,
        heightInches: original.heightInches,
        meshCount: original.meshCount,
        gridWidth: original.gridWidth,
        gridHeight: original.gridHeight,
        pixelData: original.pixelData,
        referenceImageUrl: original.referenceImageUrl,
        referenceImageOpacity: original.referenceImageOpacity,
        stitchType: original.stitchType,
        bufferPercent: original.bufferPercent,
        folderId: original.folderId,
        // Don't copy preview images - they'll be regenerated
      },
    });

    // Copy tags
    if (original.tags.length > 0) {
      await prisma.designTag.createMany({
        data: original.tags.map((dt) => ({
          designId: duplicate.id,
          tagId: dt.tagId,
        })),
      });
    }

    return NextResponse.json(duplicate);
  } catch (error) {
    console.error("Error duplicating design:", error);
    return NextResponse.json(
      { error: "Failed to duplicate design" },
      { status: 500 }
    );
  }
}

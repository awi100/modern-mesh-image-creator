import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import pako from "pako";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const design = await prisma.design.findUnique({
      where: { id },
      include: {
        folder: true,
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Decompress pixel data
    let grid: (string | null)[][] = [];
    if (design.pixelData) {
      try {
        const decompressed = pako.inflate(design.pixelData);
        const jsonStr = new TextDecoder().decode(decompressed);
        grid = JSON.parse(jsonStr);
      } catch {
        // If decompression fails, it might be stored as plain JSON
        const jsonStr = design.pixelData.toString();
        grid = JSON.parse(jsonStr);
      }
    }

    return NextResponse.json({
      ...design,
      pixelData: undefined,
      grid,
      tags: design.tags.map((dt) => dt.tag),
    });
  } catch (error) {
    console.error("Error fetching design:", error);
    return NextResponse.json(
      { error: "Failed to fetch design" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const {
      name,
      widthInches,
      heightInches,
      meshCount,
      gridWidth,
      gridHeight,
      pixelData,
      stitchType,
      bufferPercent,
      referenceImageUrl,
      referenceImageOpacity,
      folderId,
      tagIds,
      previewImageUrl,
    } = body;

    // Convert base64 to Buffer
    const pixelDataBuffer = pixelData
      ? Buffer.from(pixelData, "base64")
      : undefined;

    // Update design
    const design = await prisma.design.update({
      where: { id },
      data: {
        name,
        widthInches,
        heightInches,
        meshCount,
        gridWidth,
        gridHeight,
        pixelData: pixelDataBuffer,
        stitchType,
        bufferPercent,
        referenceImageUrl,
        referenceImageOpacity,
        folderId,
        previewImageUrl,
      },
      include: {
        folder: true,
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    // Update tags if provided
    if (tagIds !== undefined) {
      // Remove existing tags
      await prisma.designTag.deleteMany({
        where: { designId: id },
      });

      // Add new tags
      if (tagIds.length > 0) {
        await prisma.designTag.createMany({
          data: tagIds.map((tagId: string) => ({ designId: id, tagId })),
        });
      }
    }

    return NextResponse.json({
      ...design,
      pixelData: undefined,
      tags: design.tags.map((dt) => dt.tag),
    });
  } catch (error) {
    console.error("Error updating design:", error);
    return NextResponse.json(
      { error: "Failed to update design" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    await prisma.design.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting design:", error);
    return NextResponse.json(
      { error: "Failed to delete design" },
      { status: 500 }
    );
  }
}

// PATCH for partial updates (e.g., moving to folder)
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

    const design = await prisma.design.update({
      where: { id },
      data: {
        folderId: body.folderId,
      },
      include: {
        folder: true,
      },
    });

    return NextResponse.json(design);
  } catch (error) {
    console.error("Error updating design:", error);
    return NextResponse.json(
      { error: "Failed to update design" },
      { status: 500 }
    );
  }
}

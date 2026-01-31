import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
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
      isDraft,
      tagIds,
      previewImageUrl,
    } = body;

    // Convert base64 to Buffer
    const pixelDataBuffer = pixelData
      ? Buffer.from(pixelData, "base64")
      : undefined;

    // Precompute kit summary from pixel data
    let kitColorCount: number | undefined;
    let kitSkeinCount: number | undefined;
    let colorsUsed: string | undefined;
    let totalStitches: number | undefined;
    if (pixelDataBuffer) {
      try {
        const decompressed = pako.inflate(pixelDataBuffer, { to: "string" });
        const grid: (string | null)[][] = JSON.parse(decompressed);
        const stitchCounts = countStitchesByColor(grid);
        // Calculate total stitches
        totalStitches = 0;
        for (const count of stitchCounts.values()) {
          totalStitches += count;
        }
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          (meshCount || 14) as 14 | 18,
          (stitchType || "continental") as "continental" | "basketweave",
          bufferPercent ?? 20
        );
        kitColorCount = yarnUsage.length;
        kitSkeinCount = yarnUsage.reduce((sum, u) => sum + u.skeinsNeeded, 0);
        // Store the DMC numbers used
        colorsUsed = JSON.stringify(Object.keys(stitchCounts));
      } catch (e) {
        console.error("Error computing kit summary:", e);
      }
    }

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
        isDraft,
        previewImageUrl,
        kitColorCount,
        kitSkeinCount,
        colorsUsed,
        totalStitches,
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
    const { searchParams } = new URL(request.url);
    const permanent = searchParams.get("permanent") === "true";

    if (permanent) {
      // Permanent delete - actually remove from database
      await prisma.design.delete({
        where: { id },
      });
    } else {
      // Soft delete - move to trash
      await prisma.design.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting design:", error);
    return NextResponse.json(
      { error: "Failed to delete design" },
      { status: 500 }
    );
  }
}

// PATCH for partial updates (folder, canvas printed counter, kits ready, restore from trash)
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

    const data: Record<string, unknown> = {};

    // Restore from trash
    if (body.restore === true) {
      data.deletedAt = null;
    }

    if (body.folderId !== undefined) {
      data.folderId = body.folderId;
    }

    if (body.skillLevel !== undefined) {
      data.skillLevel = body.skillLevel || null;
    }

    if (body.sizeCategory !== undefined) {
      data.sizeCategory = body.sizeCategory || null;
    }

    // Handle delta updates for counters
    if (body.canvasPrintedDelta !== undefined || body.kitsReadyDelta !== undefined) {
      const current = await prisma.design.findUnique({
        where: { id },
        select: { canvasPrinted: true, kitsReady: true },
      });

      if (body.canvasPrintedDelta !== undefined) {
        const newVal = (current?.canvasPrinted ?? 0) + body.canvasPrintedDelta;
        data.canvasPrinted = Math.max(0, newVal);
      }

      if (body.kitsReadyDelta !== undefined) {
        const newVal = (current?.kitsReady ?? 0) + body.kitsReadyDelta;
        data.kitsReady = Math.max(0, newVal);
      }
    }

    const design = await prisma.design.update({
      where: { id },
      data,
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, MeshCount } from "@/lib/yarn-calculator";
import pako from "pako";

const VALID_MESH_COUNTS: MeshCount[] = [13, 14, 18];

// POST /api/designs/[id]/mesh-variant - Create a new design resampled to a different mesh count
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { targetMeshCount, name: customName } = await request.json();

    if (!targetMeshCount || !VALID_MESH_COUNTS.includes(targetMeshCount)) {
      return NextResponse.json(
        { error: "targetMeshCount must be 13, 14, or 18" },
        { status: 400 }
      );
    }

    // Get the original design
    const original = await prisma.design.findUnique({
      where: { id },
      include: {
        tags: true,
      },
    });

    if (!original || original.deletedAt) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    if (original.meshCount === targetMeshCount) {
      return NextResponse.json(
        { error: "Target mesh count is the same as the original" },
        { status: 400 }
      );
    }

    // Decompress the pixel data
    const compressed = Buffer.from(original.pixelData);
    const decompressed = pako.inflate(compressed, { to: "string" });
    const oldGrid: (string | null)[][] = JSON.parse(decompressed);

    const oldGridHeight = oldGrid.length;
    const oldGridWidth = oldGridHeight > 0 ? oldGrid[0].length : 0;

    // Calculate new grid dimensions based on same physical size
    const newGridWidth = Math.round(original.widthInches * targetMeshCount);
    const newGridHeight = Math.round(original.heightInches * targetMeshCount);

    // Resample grid using nearest-neighbor
    const newGrid: (string | null)[][] = [];
    for (let y = 0; y < newGridHeight; y++) {
      const row: (string | null)[] = [];
      for (let x = 0; x < newGridWidth; x++) {
        const sourceX = Math.floor(x * oldGridWidth / newGridWidth);
        const sourceY = Math.floor(y * oldGridHeight / newGridHeight);
        row.push(oldGrid[sourceY]?.[sourceX] ?? null);
      }
      newGrid.push(row);
    }

    // Compress the resampled grid
    const newPixelData = Buffer.from(pako.deflate(JSON.stringify(newGrid)));

    // Compute kit summary from the new grid
    const stitchCounts = countStitchesByColor(newGrid);
    let totalStitches = 0;
    for (const count of stitchCounts.values()) {
      totalStitches += count;
    }

    const stitchType = original.stitchType as "continental" | "basketweave";
    const yarnUsage = calculateYarnUsage(
      stitchCounts,
      targetMeshCount as MeshCount,
      stitchType,
      original.bufferPercent
    );

    const kitColorCount = yarnUsage.length;
    const kitSkeinCount = yarnUsage.reduce((sum, u) => sum + (u.usesFullSkein ? u.skeinsNeeded : 0), 0);
    const colorsUsed = JSON.stringify(Array.from(stitchCounts.keys()));

    // Generate the variant name
    const variantName = customName || `${original.name} (${targetMeshCount}ct)`;

    // Create the new design with resampled grid
    const variant = await prisma.design.create({
      data: {
        name: variantName,
        widthInches: original.widthInches,
        heightInches: original.heightInches,
        meshCount: targetMeshCount,
        gridWidth: newGridWidth,
        gridHeight: newGridHeight,
        pixelData: newPixelData,
        referenceImageUrl: original.referenceImageUrl,
        referenceImageOpacity: original.referenceImageOpacity,
        stitchType: original.stitchType,
        bufferPercent: original.bufferPercent,
        folderId: original.folderId,
        isDraft: original.isDraft,
        kitsReady: 0,
        canvasPrinted: 0,
        canvasPrintedMaddie: 0,
        kitColorCount,
        kitSkeinCount,
        colorsUsed,
        totalStitches,
        // Don't copy preview images - they'll be regenerated when opened
      },
    });

    // Copy tags from original
    if (original.tags.length > 0) {
      await prisma.designTag.createMany({
        data: original.tags.map((dt) => ({
          designId: variant.id,
          tagId: dt.tagId,
        })),
      });
    }

    // Auto-create print version for the mesh variant
    try {
      await prisma.design.create({
        data: {
          name: `${variantName} (Print)`,
          widthInches: original.widthInches,
          heightInches: original.heightInches,
          meshCount: targetMeshCount,
          gridWidth: newGridWidth,
          gridHeight: newGridHeight,
          pixelData: newPixelData,
          stitchType: original.stitchType,
          bufferPercent: original.bufferPercent,
          folderId: original.folderId,
          kitColorCount,
          kitSkeinCount,
          colorsUsed,
          totalStitches,
          printVersionOf: variant.id,
        },
      });
    } catch (e) {
      console.error("Error auto-creating print version for mesh variant:", e);
    }

    return NextResponse.json({
      id: variant.id,
      name: variant.name,
      originalMeshCount: original.meshCount,
      targetMeshCount,
      originalDimensions: { width: oldGridWidth, height: oldGridHeight },
      newDimensions: { width: newGridWidth, height: newGridHeight },
    });
  } catch (error) {
    console.error("[POST /api/designs/[id]/mesh-variant] Error:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to create mesh variant" },
      { status: 500 }
    );
  }
}

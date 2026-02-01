import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import pako from "pako";

interface ColorMapping {
  from: string;
  to: string;
}

// POST /api/designs/[id]/color-variant - Create a new design with swapped colors
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { colorMappings, name: customName } = await request.json();

    if (!colorMappings || !Array.isArray(colorMappings) || colorMappings.length === 0) {
      return NextResponse.json(
        { error: "colorMappings array is required" },
        { status: 400 }
      );
    }

    // Validate color mappings
    for (const mapping of colorMappings) {
      if (!mapping.from || typeof mapping.from !== "string") {
        return NextResponse.json(
          { error: "Each mapping must have a 'from' color" },
          { status: 400 }
        );
      }
      if (!mapping.to || typeof mapping.to !== "string") {
        return NextResponse.json(
          { error: "Each mapping must have a 'to' color" },
          { status: 400 }
        );
      }
    }

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

    // Decompress the pixel data
    const compressed = Buffer.from(original.pixelData);
    const decompressed = pako.inflate(compressed, { to: "string" });
    let grid: (string | null)[][] = JSON.parse(decompressed);

    // Build a mapping lookup for efficiency
    const mappingLookup = new Map<string, string>();
    for (const mapping of colorMappings as ColorMapping[]) {
      mappingLookup.set(mapping.from, mapping.to);
    }

    // Apply color swaps to the grid
    grid = grid.map(row =>
      row.map(cell => {
        if (cell !== null && mappingLookup.has(cell)) {
          return mappingLookup.get(cell)!;
        }
        return cell;
      })
    );

    // Compress the modified grid
    const newPixelData = Buffer.from(pako.deflate(JSON.stringify(grid)));

    // Compute kit summary from the new grid
    const stitchCounts = countStitchesByColor(grid);
    let totalStitches = 0;
    for (const count of stitchCounts.values()) {
      totalStitches += count;
    }

    const meshCount = original.meshCount as 14 | 18;
    const stitchType = original.stitchType as "continental" | "basketweave";
    const yarnUsage = calculateYarnUsage(
      stitchCounts,
      meshCount,
      stitchType,
      original.bufferPercent
    );

    const kitColorCount = yarnUsage.length;
    const kitSkeinCount = yarnUsage.reduce((sum, u) => sum + u.skeinsNeeded, 0);
    const colorsUsed = JSON.stringify(Array.from(stitchCounts.keys()));

    // Generate the variant name
    const variantName = customName || `${original.name} (Color Variant)`;

    // Create the new design with swapped colors
    const variant = await prisma.design.create({
      data: {
        name: variantName,
        widthInches: original.widthInches,
        heightInches: original.heightInches,
        meshCount: original.meshCount,
        gridWidth: original.gridWidth,
        gridHeight: original.gridHeight,
        pixelData: newPixelData,
        referenceImageUrl: original.referenceImageUrl,
        referenceImageOpacity: original.referenceImageOpacity,
        stitchType: original.stitchType,
        bufferPercent: original.bufferPercent,
        folderId: original.folderId,
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

    return NextResponse.json({
      id: variant.id,
      name: variant.name,
      colorMappingsApplied: colorMappings.length,
    });
  } catch (error) {
    console.error("[POST /api/designs/[id]/color-variant] Error:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to create color variant" },
      { status: 500 }
    );
  }
}

// GET /api/designs/[id]/color-variant - Get colors used in a design for the swap dialog
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
      select: {
        id: true,
        name: true,
        meshCount: true,
        pixelData: true,
        colorsUsed: true,
      },
    });

    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Decompress the pixel data to count stitches per color
    const compressed = Buffer.from(design.pixelData);
    const decompressed = pako.inflate(compressed, { to: "string" });
    const grid: (string | null)[][] = JSON.parse(decompressed);

    const stitchCounts = countStitchesByColor(grid);

    // Build color info array
    const colors = Array.from(stitchCounts.entries()).map(([dmcNumber, stitchCount]) => ({
      dmcNumber,
      stitchCount,
    }));

    // Sort by stitch count descending (most used first)
    colors.sort((a, b) => b.stitchCount - a.stitchCount);

    return NextResponse.json({
      designId: design.id,
      designName: design.name,
      meshCount: design.meshCount,
      colors,
    });
  } catch (error) {
    console.error("[GET /api/designs/[id]/color-variant] Error:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to get design colors" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, MeshCount } from "@/lib/yarn-calculator";
import pako from "pako";

// PUT /api/designs/[id]/color-swap - Save print color hex overrides
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { overrides } = await request.json();

    const design = await prisma.design.findUnique({ where: { id }, select: { printVersionOf: true } });
    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }
    if (!design.printVersionOf) {
      return NextResponse.json({ error: "Can only set overrides on print versions" }, { status: 400 });
    }

    await prisma.design.update({
      where: { id },
      data: { printColorOverrides: JSON.stringify(overrides) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PUT color-swap] Error:", error);
    return NextResponse.json({ error: "Failed to save overrides" }, { status: 500 });
  }
}

// POST /api/designs/[id]/color-swap - Swap a color across the entire grid
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { fromDmc, toDmc } = await request.json();

    if (!fromDmc || !toDmc) {
      return NextResponse.json({ error: "fromDmc and toDmc are required" }, { status: 400 });
    }

    const design = await prisma.design.findUnique({ where: { id } });
    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Only allow color swaps on print versions to protect original kit colors
    if (!design.printVersionOf) {
      return NextResponse.json({ error: "Color swaps can only be made on print versions" }, { status: 400 });
    }

    // Decompress grid
    const compressed = Buffer.from(design.pixelData);
    const decompressed = pako.inflate(compressed, { to: "string" });
    let grid: (string | null)[][] = JSON.parse(decompressed);

    // Swap color
    let swapCount = 0;
    grid = grid.map(row =>
      row.map(cell => {
        if (cell === fromDmc) {
          swapCount++;
          return toDmc;
        }
        return cell;
      })
    );

    if (swapCount === 0) {
      return NextResponse.json({ error: `Color ${fromDmc} not found in design` }, { status: 400 });
    }

    // Recompress
    const newPixelData = Buffer.from(pako.deflate(JSON.stringify(grid)));

    // Recompute kit summary
    const stitchCounts = countStitchesByColor(grid);
    let totalStitches = 0;
    for (const count of stitchCounts.values()) totalStitches += count;

    const stitchType = design.stitchType as "continental" | "basketweave";
    const yarnUsage = calculateYarnUsage(
      stitchCounts,
      (design.meshCount || 14) as MeshCount,
      stitchType,
      design.bufferPercent
    );

    const kitColorCount = yarnUsage.length;
    const kitSkeinCount = yarnUsage.reduce((sum, u) => sum + (u.usesFullSkein ? u.skeinsNeeded : 0), 0);
    const colorsUsed = JSON.stringify(Array.from(stitchCounts.keys()));

    // Update design
    await prisma.design.update({
      where: { id },
      data: {
        pixelData: newPixelData,
        kitColorCount,
        kitSkeinCount,
        colorsUsed,
        totalStitches,
        previewImageUrl: null, // Clear preview so it regenerates
      },
    });

    return NextResponse.json({
      success: true,
      swapCount,
      fromDmc,
      toDmc,
    });
  } catch (error) {
    console.error("[POST color-swap] Error:", error);
    return NextResponse.json({ error: "Failed to swap color" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import pako from "pako";

// GET - Compute kit contents for a design
export async function GET(
  _request: NextRequest,
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
        stitchType: true,
        bufferPercent: true,
        pixelData: true,
        widthInches: true,
        heightInches: true,
      },
    });

    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Decompress pixel data
    const compressed = Buffer.from(design.pixelData);
    const decompressed = pako.inflate(compressed, { to: "string" });
    const grid: (string | null)[][] = JSON.parse(decompressed);

    // Count stitches per color
    const stitchCounts = countStitchesByColor(grid);

    // Calculate yarn usage
    const meshCount = design.meshCount as 14 | 18;
    const stitchType = design.stitchType as "continental" | "basketweave";
    const yarnUsage = calculateYarnUsage(
      stitchCounts,
      meshCount,
      stitchType,
      design.bufferPercent
    );

    // Get inventory for the correct thread size
    const threadSize = meshCount === 14 ? 5 : 8;
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { size: threadSize },
    });
    const inventoryMap = new Map(
      inventoryItems.map((item) => [item.dmcNumber, item.skeins])
    );

    // Build kit contents
    const kitContents = yarnUsage.map((usage) => {
      const dmcColor = getDmcColorByNumber(usage.dmcNumber);
      const inventorySkeins = inventoryMap.get(usage.dmcNumber) ?? 0;

      return {
        dmcNumber: usage.dmcNumber,
        colorName: dmcColor?.name ?? "Unknown",
        hex: dmcColor?.hex ?? "#888888",
        stitchCount: usage.stitchCount,
        skeinsNeeded: usage.skeinsNeeded,
        yardsNeeded: Math.round(usage.withBuffer * 10) / 10,
        inventorySkeins,
        inStock: inventorySkeins >= usage.skeinsNeeded,
      };
    });

    return NextResponse.json({
      design: {
        id: design.id,
        name: design.name,
        meshCount: design.meshCount,
        stitchType: design.stitchType,
        bufferPercent: design.bufferPercent,
        widthInches: design.widthInches,
        heightInches: design.heightInches,
      },
      kitContents,
      totals: {
        colors: kitContents.length,
        skeins: kitContents.reduce((sum, c) => sum + c.skeinsNeeded, 0),
        allInStock: kitContents.every((c) => c.inStock),
      },
    });
  } catch (error) {
    console.error("Error computing kit contents:", error);
    return NextResponse.json(
      { error: "Failed to compute kit contents" },
      { status: 500 }
    );
  }
}

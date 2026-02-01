import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import pako from "pako";

const SKEIN_YARDS = 27;
const BOBBIN_ONLY_MAX = 5;
const LEFTOVER_THRESHOLD = 5;

interface KitItem {
  dmcNumber: string;
  colorName: string;
  hex: string;
  stitchCount: number;
  skeinsNeeded: number;
  yardsWithBuffer: number;
  fullSkeins: number;
  bobbinYards: number;
  inventorySkeins: number;
  inStock: boolean;
  usedInDesigns: string[]; // Which designs use this color
}

// POST /api/designs/batch/kits - Get combined kit requirements for multiple designs
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { designIds } = await request.json();

    if (!designIds || !Array.isArray(designIds) || designIds.length === 0) {
      return NextResponse.json(
        { error: "designIds array is required" },
        { status: 400 }
      );
    }

    if (designIds.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 designs per batch" },
        { status: 400 }
      );
    }

    // Fetch all designs
    const designs = await prisma.design.findMany({
      where: { id: { in: designIds } },
      select: {
        id: true,
        name: true,
        meshCount: true,
        stitchType: true,
        bufferPercent: true,
        pixelData: true,
      },
    });

    if (designs.length === 0) {
      return NextResponse.json(
        { error: "No designs found" },
        { status: 404 }
      );
    }

    // Get all inventory for both thread sizes
    const inventoryItems = await prisma.inventoryItem.findMany();
    const inventoryMap5 = new Map<string, number>();
    const inventoryMap8 = new Map<string, number>();
    for (const item of inventoryItems) {
      if (item.size === 5) {
        inventoryMap5.set(item.dmcNumber, item.skeins);
      } else {
        inventoryMap8.set(item.dmcNumber, item.skeins);
      }
    }

    // Aggregate kit contents across all designs
    const aggregatedColors = new Map<string, {
      stitchCount: number;
      yardsWithBuffer: number;
      usedInDesigns: string[];
      meshCounts: Set<number>;
    }>();

    const designSummaries: Array<{
      id: string;
      name: string;
      meshCount: number;
      colorCount: number;
      totalSkeins: number;
    }> = [];

    for (const design of designs) {
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

      let designTotalSkeins = 0;

      for (const usage of yarnUsage) {
        const existing = aggregatedColors.get(usage.dmcNumber);
        if (existing) {
          existing.stitchCount += usage.stitchCount;
          existing.yardsWithBuffer += usage.withBuffer;
          existing.usedInDesigns.push(design.name);
          existing.meshCounts.add(meshCount);
        } else {
          aggregatedColors.set(usage.dmcNumber, {
            stitchCount: usage.stitchCount,
            yardsWithBuffer: usage.withBuffer,
            usedInDesigns: [design.name],
            meshCounts: new Set([meshCount]),
          });
        }
        designTotalSkeins += usage.skeinsNeeded;
      }

      designSummaries.push({
        id: design.id,
        name: design.name,
        meshCount: design.meshCount,
        colorCount: yarnUsage.length,
        totalSkeins: designTotalSkeins,
      });
    }

    // Build final kit contents
    const kitContents: KitItem[] = [];

    for (const [dmcNumber, data] of aggregatedColors.entries()) {
      const dmcColor = getDmcColorByNumber(dmcNumber);
      const yardsWithBuffer = Math.round(data.yardsWithBuffer * 10) / 10;

      // Determine inventory based on mesh count(s) used
      // If mixed mesh counts, show both inventories combined
      let inventorySkeins = 0;
      if (data.meshCounts.has(14)) {
        inventorySkeins += inventoryMap5.get(dmcNumber) ?? 0;
      }
      if (data.meshCounts.has(18)) {
        inventorySkeins += inventoryMap8.get(dmcNumber) ?? 0;
      }

      let fullSkeins = 0;
      let bobbinYards = 0;
      let skeinsNeeded = 0;

      if (yardsWithBuffer <= BOBBIN_ONLY_MAX) {
        fullSkeins = 0;
        bobbinYards = yardsWithBuffer;
        skeinsNeeded = 1; // Still need at least partial access to a skein
      } else {
        const baseSkeins = Math.floor(yardsWithBuffer / SKEIN_YARDS);
        const remainder = yardsWithBuffer - baseSkeins * SKEIN_YARDS;

        if (baseSkeins === 0) {
          fullSkeins = 1;
          bobbinYards = 0;
        } else if (remainder <= LEFTOVER_THRESHOLD) {
          fullSkeins = baseSkeins;
          bobbinYards = 0;
        } else {
          fullSkeins = baseSkeins + 1;
          bobbinYards = 0;
        }
        skeinsNeeded = fullSkeins;
      }

      kitContents.push({
        dmcNumber,
        colorName: dmcColor?.name ?? "Unknown",
        hex: dmcColor?.hex ?? "#888888",
        stitchCount: data.stitchCount,
        skeinsNeeded,
        yardsWithBuffer,
        fullSkeins,
        bobbinYards,
        inventorySkeins,
        inStock: inventorySkeins >= skeinsNeeded,
        usedInDesigns: data.usedInDesigns,
      });
    }

    // Sort by DMC number
    kitContents.sort((a, b) => {
      const numA = parseInt(a.dmcNumber, 10);
      const numB = parseInt(b.dmcNumber, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      if (!isNaN(numA)) return -1;
      if (!isNaN(numB)) return 1;
      return a.dmcNumber.localeCompare(b.dmcNumber);
    });

    return NextResponse.json({
      designs: designSummaries,
      kitContents,
      totals: {
        designCount: designs.length,
        colors: kitContents.length,
        skeins: kitContents.reduce((sum, c) => sum + c.skeinsNeeded, 0),
        bobbins: kitContents.filter((c) => c.bobbinYards > 0).length,
        allInStock: kitContents.every((c) => c.inStock),
        outOfStockCount: kitContents.filter((c) => !c.inStock).length,
      },
    });
  } catch (error) {
    console.error("[POST /api/designs/batch/kits] Error:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to compute batch kit contents" },
      { status: 500 }
    );
  }
}

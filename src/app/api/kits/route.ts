import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import pako from "pako";

const SKEIN_YARDS = 27;
const BOBBIN_ONLY_MAX = 5;
const LEFTOVER_THRESHOLD = 5;

// GET - Fetch all kits summary
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all non-draft designs with folder info
    const designs = await prisma.design.findMany({
      where: { isDraft: false, deletedAt: null },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        widthInches: true,
        heightInches: true,
        meshCount: true,
        stitchType: true,
        bufferPercent: true,
        pixelData: true,
        kitsReady: true,
        canvasPrinted: true,
        folder: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ folder: { name: "asc" } }, { name: "asc" }],
    });

    // Get all inventory
    const inventoryItems = await prisma.inventoryItem.findMany();
    const inventoryBySize: Record<number, Map<string, number>> = {
      5: new Map(),
      8: new Map(),
    };
    for (const item of inventoryItems) {
      inventoryBySize[item.size].set(item.dmcNumber, item.skeins);
    }

    const kits = [];

    for (const design of designs) {
      if (!design.pixelData) continue;

      try {
        // Decompress pixel data
        const compressed = Buffer.from(design.pixelData);
        const decompressed = pako.inflate(compressed, { to: "string" });
        const grid: (string | null)[][] = JSON.parse(decompressed);

        // Count stitches per color
        const stitchCounts = countStitchesByColor(grid);
        if (stitchCounts.size === 0) continue;

        // Calculate yarn usage
        const meshCount = design.meshCount as 14 | 18;
        const stitchType = design.stitchType as "continental" | "basketweave";
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          meshCount,
          stitchType,
          design.bufferPercent
        );

        // Get inventory for correct thread size
        const threadSize = meshCount === 14 ? 5 : 8;
        const inventoryMap = inventoryBySize[threadSize];

        // Build kit contents
        const kitContents = yarnUsage.map((usage) => {
          const dmcColor = getDmcColorByNumber(usage.dmcNumber);
          const inventorySkeins = inventoryMap.get(usage.dmcNumber) ?? 0;
          const yardsWithoutBuffer = Math.round(usage.yarnYards * 10) / 10;
          const yardsWithBuffer = Math.round(usage.withBuffer * 10) / 10;

          let fullSkeins = 0;
          let bobbinYards = 0;

          if (yardsWithBuffer <= BOBBIN_ONLY_MAX) {
            fullSkeins = 0;
            bobbinYards = yardsWithBuffer;
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
          }

          return {
            dmcNumber: usage.dmcNumber,
            colorName: dmcColor?.name ?? "Unknown",
            hex: dmcColor?.hex ?? "#888888",
            stitchCount: usage.stitchCount,
            skeinsNeeded: usage.skeinsNeeded,
            yardsWithoutBuffer,
            yardsWithBuffer,
            fullSkeins,
            bobbinYards,
            inventorySkeins,
            inStock: inventorySkeins >= usage.skeinsNeeded,
          };
        });

        const totalSkeins = kitContents.reduce((sum, c) => sum + (c.fullSkeins > 0 ? c.fullSkeins : 1), 0);

        kits.push({
          designId: design.id,
          designName: design.name,
          previewImageUrl: design.previewImageUrl,
          widthInches: design.widthInches,
          heightInches: design.heightInches,
          meshCount: design.meshCount,
          stitchType: design.stitchType,
          bufferPercent: design.bufferPercent,
          kitsReady: design.kitsReady ?? 0,
          canvasPrinted: design.canvasPrinted ?? 0,
          totalColors: kitContents.length,
          totalSkeins,
          allInStock: kitContents.every((c) => c.inStock),
          kitContents,
          folder: design.folder,
        });
      } catch (e) {
        console.error(`Error processing design ${design.id}:`, e);
        continue;
      }
    }

    return NextResponse.json(kits);
  } catch (error) {
    console.error("Error fetching kits:", error);
    return NextResponse.json(
      { error: "Failed to fetch kits" },
      { status: 500 }
    );
  }
}

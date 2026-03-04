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
        backupColors: true,
        folder: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ folder: { name: "asc" } }, { name: "asc" }],
    });

    // Get inventory from main location only (maddie's is just for tracking)
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { location: "main" },
    });
    const inventoryBySize: Record<number, Map<string, number>> = {
      5: new Map(),
      8: new Map(),
    };
    for (const item of inventoryItems) {
      inventoryBySize[item.size].set(item.dmcNumber, item.skeins);
    }

    // Fetch global backup colors
    const globalBackups = await prisma.colorBackup.findMany();
    const globalBackupMap: Record<string, string> = {};
    for (const backup of globalBackups) {
      // Bidirectional mapping
      globalBackupMap[backup.dmcNumber] = backup.backupDmcNumber;
      globalBackupMap[backup.backupDmcNumber] = backup.dmcNumber;
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

        // Calculate yarn usage (14 mesh / Size 5 only in internal app)
        const stitchType = design.stitchType as "continental" | "basketweave";
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          14,
          stitchType,
          design.bufferPercent
        );

        // Get inventory for Size 5 thread (14 mesh only)
        const inventoryMap = inventoryBySize[5];

        // Parse design-specific backup colors
        const designBackupColors: Record<string, string> = design.backupColors
          ? JSON.parse(design.backupColors)
          : {};

        // Merge: design-specific backups override global backups
        const backupColors: Record<string, string> = { ...globalBackupMap, ...designBackupColors };

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

          // Get backup color info if exists
          const backupDmcNumber = backupColors[usage.dmcNumber];
          let backup = null;
          if (backupDmcNumber) {
            const backupColor = getDmcColorByNumber(backupDmcNumber);
            const backupInventorySkeins = inventoryMap.get(backupDmcNumber) ?? 0;
            backup = {
              dmcNumber: backupDmcNumber,
              colorName: backupColor?.name ?? "Unknown",
              hex: backupColor?.hex ?? "#888888",
              inventorySkeins: backupInventorySkeins,
              inStock: backupInventorySkeins >= usage.skeinsNeeded,
            };
          }

          // Color is "in stock" if primary OR backup has enough
          const primaryInStock = inventorySkeins >= usage.skeinsNeeded;
          const backupInStock = backup?.inStock ?? false;
          const effectiveInStock = primaryInStock || backupInStock;

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
            inStock: effectiveInStock,
            primaryInStock,
            backup,
          };
        });

        // Sort kit contents by DMC number numerically
        kitContents.sort((a, b) => {
          const numA = parseInt(a.dmcNumber, 10);
          const numB = parseInt(b.dmcNumber, 10);
          // If both are valid numbers, sort numerically
          if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
          }
          // If only one is a number, numbers come first
          if (!isNaN(numA)) return -1;
          if (!isNaN(numB)) return 1;
          // Otherwise sort alphabetically
          return a.dmcNumber.localeCompare(b.dmcNumber);
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, MeshCount, threadSizeForMesh, skeinYardsForMesh, bobbinThresholdsForMesh } from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { meshCountWhere } from "@/lib/mesh-filter";
import pako from "pako";

const LEFTOVER_THRESHOLD = 5;

// GET - Fetch all kits summary
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const meshFilter = url.searchParams.get("meshCount");
    const meshWhere = meshCountWhere(meshFilter);
    // Opt-in: include archived designs (e.g. the 14-vs-18 compare page, where
    // many 14ct designs are archived but still need comparing to their 18ct
    // versions). Default keeps archived hidden for everyone else.
    const includeArchived = url.searchParams.get("includeArchived") === "true";

    // Fetch non-draft designs (filtered by mesh count if specified)
    const designs = await prisma.design.findMany({
      where: {
        isDraft: false,
        deletedAt: null,
        notLiveAt: null,
        printVersionOf: null,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...meshWhere,
      },
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
        archivedAt: true,
        kitsReady: true,
        canvasPrinted: true,
        marketKitsReady: true,
        marketCanvasPrinted: true,
        kitsAndover: true,
        canvasAndover: true,
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

    // Get inventory keyed by thread size (Size 3 for 13ct, Size 5 for 14/18ct)
    const inventoryItems = await prisma.inventoryItem.findMany();
    const inventoryBySize: Record<number, Map<string, number>> = {
      3: new Map(),
      5: new Map(),
      8: new Map(),
    };
    for (const item of inventoryItems) {
      if (!inventoryBySize[item.size]) inventoryBySize[item.size] = new Map();
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

        // Calculate yarn usage
        const meshCount = (design.meshCount || 14) as MeshCount;
        const threadSize = threadSizeForMesh(meshCount);
        const SKEIN_YARDS = skeinYardsForMesh(meshCount);
        const BOBBIN_ONLY_MAX = bobbinThresholdsForMesh(meshCount).max;

        const stitchType = design.stitchType as "continental" | "basketweave";
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          meshCount,
          stitchType,
          design.bufferPercent
        );

        // Get inventory for this design's thread size
        const inventoryMap = inventoryBySize[threadSize];

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

          // Skeins that must be on hand to make one kit of this color. Match the
          // displayed "Need N skeins" (fullSkeins) so the stock indicator can't
          // contradict the stated requirement; a bobbin color shows 0 full skeins
          // but still needs one skein opened to wind the bobbin.
          const skeinsToStock = fullSkeins > 0 ? fullSkeins : bobbinYards > 0 ? 1 : 0;

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
              inStock: backupInventorySkeins >= skeinsToStock,
              threadSize,
            };
          }

          // Color is "in stock" if primary OR backup has enough
          const primaryInStock = inventorySkeins >= skeinsToStock;
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
            threadSize,
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

        const totalSkeins = kitContents.reduce((sum, c) => sum + c.fullSkeins, 0);

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
          marketKitsReady: design.marketKitsReady ?? 0,
          marketCanvasPrinted: design.marketCanvasPrinted ?? 0,
          kitsAndover: design.kitsAndover ?? 0,
          canvasAndover: design.canvasAndover ?? 0,
          totalColors: kitContents.length,
          totalSkeins,
          allInStock: kitContents.every((c) => c.inStock),
          kitContents,
          folder: design.folder,
          archived: design.archivedAt != null,
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, MeshCount, threadSizeForMesh, fullSkeinsForColor } from "@/lib/yarn-calculator";
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
        kitsReady: true,
        canvasPrinted: true,
        totalSold: true,
        totalKitsSold: true,
        backupColors: true,
        deletedAt: true,
      },
    });

    if (!design || design.deletedAt) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Decompress pixel data
    const compressed = Buffer.from(design.pixelData);
    const decompressed = pako.inflate(compressed, { to: "string" });
    const grid: (string | null)[][] = JSON.parse(decompressed);

    // Count stitches per color
    const stitchCounts = countStitchesByColor(grid);

    // Thread size depends on mesh count
    const meshCount = (design.meshCount || 14) as MeshCount;
    const threadSize = threadSizeForMesh(meshCount);

    // Calculate yarn usage
    const stitchType = design.stitchType as "continental" | "basketweave";
    const yarnUsage = calculateYarnUsage(
      stitchCounts,
      meshCount,
      stitchType,
      design.bufferPercent
    );

    // Parse design-specific backup colors
    const designBackupColors: Record<string, string> = design.backupColors
      ? JSON.parse(design.backupColors)
      : {};

    // Fetch global backup colors
    const globalBackups = await prisma.colorBackup.findMany();
    const globalBackupMap: Record<string, string> = {};
    for (const backup of globalBackups) {
      // Bidirectional mapping
      globalBackupMap[backup.dmcNumber] = backup.backupDmcNumber;
      globalBackupMap[backup.backupDmcNumber] = backup.dmcNumber;
    }

    // Merge: design-specific backups override global backups
    const backupColors: Record<string, string> = { ...globalBackupMap, ...designBackupColors };

    // Get inventory for this design's thread size (Size 5 for 14/18ct, Size 3 for 13ct)
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
      const yardsWithoutBuffer = Math.round(usage.yarnYards * 10) / 10;
      const yardsWithBuffer = Math.round(usage.withBuffer * 10) / 10;

      // Full skeins (and whether it's a bobbin-only color) — shared with the
      // cached kit summary via fullSkeinsForColor so header and detail agree.
      const fullSkeins = fullSkeinsForColor(yardsWithBuffer, meshCount);
      const bobbinYards = fullSkeins === 0 ? yardsWithBuffer : 0;

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

    return NextResponse.json({
      design: {
        id: design.id,
        name: design.name,
        meshCount: design.meshCount,
        stitchType: design.stitchType,
        bufferPercent: design.bufferPercent,
        widthInches: design.widthInches,
        heightInches: design.heightInches,
        kitsReady: design.kitsReady,
        canvasPrinted: design.canvasPrinted,
        totalSold: design.totalSold,
        totalKitsSold: design.totalKitsSold,
      },
      kitContents,
      backupColors,
      totals: {
        colors: kitContents.length,
        skeins: kitContents.reduce((sum, c) => sum + c.fullSkeins, 0),
        bobbins: kitContents.filter((c) => c.bobbinYards > 0).length,
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

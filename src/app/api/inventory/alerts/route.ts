import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import pako from "pako";

interface ColorRequirement {
  dmcNumber: string;
  colorName: string;
  hex: string;
  skeinsNeeded: number;
  inventorySkeins: number;
  fulfillmentCapacity: number; // How many kits can be made with current inventory
}

interface DesignAlert {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  fulfillmentCapacity: number; // Minimum across all colors
  bottleneckColors: ColorRequirement[]; // Colors limiting capacity
  totalColors: number;
  totalSkeinsPerKit: number;
}

interface MostUsedColor {
  dmcNumber: string;
  colorName: string;
  hex: string;
  totalStitches: number;
  designCount: number;
  totalSkeinsNeeded: number; // Combined skeins needed for all designs
  inventorySkeins: number;
  skeinsReservedInKits: number; // Skeins already used in assembled kits
  effectiveInventory: number; // inventorySkeins - skeinsReservedInKits
  threadSize: 5 | 8;
}

// GET - Calculate stock alerts for all non-draft designs
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all non-draft designs with pixel data
    const designs = await prisma.design.findMany({
      where: { isDraft: false, deletedAt: null },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        meshCount: true,
        stitchType: true,
        bufferPercent: true,
        pixelData: true,
        kitsReady: true,
      },
    });

    // Fetch all inventory
    const inventoryItems = await prisma.inventoryItem.findMany();

    // Build inventory maps by size
    const inventoryBySize: Record<number, Map<string, number>> = {
      5: new Map(),
      8: new Map(),
    };
    for (const item of inventoryItems) {
      inventoryBySize[item.size].set(item.dmcNumber, item.skeins);
    }

    const alerts: DesignAlert[] = [];

    // Aggregate color usage tracking
    const colorUsageMap = new Map<string, {
      totalStitches: number;
      designIds: Set<string>;
      skeinsNeededBySize: { 5: number; 8: number };
      skeinsReservedInKits: { 5: number; 8: number }; // Skeins already used in assembled kits
    }>();

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

        // Track aggregate color usage
        const threadSize = meshCount === 14 ? 5 : 8;
        const kitsReady = design.kitsReady || 0;
        for (const [dmcNumber, stitchCount] of stitchCounts.entries()) {
          const existing = colorUsageMap.get(dmcNumber);
          const usage = yarnUsage.find((u) => u.dmcNumber === dmcNumber);
          const skeinsNeeded = usage?.skeinsNeeded ?? 0;
          const skeinsReserved = skeinsNeeded * kitsReady; // Skeins used in assembled kits

          if (existing) {
            existing.totalStitches += stitchCount;
            existing.designIds.add(design.id);
            existing.skeinsNeededBySize[threadSize] += skeinsNeeded;
            existing.skeinsReservedInKits[threadSize] += skeinsReserved;
          } else {
            colorUsageMap.set(dmcNumber, {
              totalStitches: stitchCount,
              designIds: new Set([design.id]),
              skeinsNeededBySize: {
                5: threadSize === 5 ? skeinsNeeded : 0,
                8: threadSize === 8 ? skeinsNeeded : 0,
              },
              skeinsReservedInKits: {
                5: threadSize === 5 ? skeinsReserved : 0,
                8: threadSize === 8 ? skeinsReserved : 0,
              },
            });
          }
        }

        // Get inventory for correct thread size
        const inventoryMap = inventoryBySize[threadSize];

        // Calculate fulfillment capacity for each color
        // Account for kitsReady - threads already used in assembled kits
        const colorRequirements: ColorRequirement[] = yarnUsage.map((usage) => {
          const dmcColor = getDmcColorByNumber(usage.dmcNumber);
          const inventorySkeins = inventoryMap.get(usage.dmcNumber) ?? 0;
          // Effective inventory = current inventory minus skeins already used in kits ready
          const effectiveInventory = Math.max(0, inventorySkeins - (usage.skeinsNeeded * kitsReady));
          const fulfillmentCapacity = usage.skeinsNeeded > 0
            ? Math.floor(effectiveInventory / usage.skeinsNeeded)
            : Infinity;

          return {
            dmcNumber: usage.dmcNumber,
            colorName: dmcColor?.name ?? "Unknown",
            hex: dmcColor?.hex ?? "#888888",
            skeinsNeeded: usage.skeinsNeeded,
            inventorySkeins,
            fulfillmentCapacity,
          };
        });

        // Overall fulfillment capacity is limited by the most constrained color
        const minCapacity = Math.min(...colorRequirements.map((c) => c.fulfillmentCapacity));

        // Find bottleneck colors (those at or near minimum capacity)
        const bottleneckColors = colorRequirements
          .filter((c) => c.fulfillmentCapacity <= minCapacity + 2) // Within 2 of minimum
          .sort((a, b) => a.fulfillmentCapacity - b.fulfillmentCapacity);

        alerts.push({
          id: design.id,
          name: design.name,
          previewImageUrl: design.previewImageUrl,
          meshCount: design.meshCount,
          fulfillmentCapacity: minCapacity === Infinity ? 999 : minCapacity,
          bottleneckColors: bottleneckColors.slice(0, 5), // Top 5 bottlenecks
          totalColors: colorRequirements.length,
          totalSkeinsPerKit: yarnUsage.reduce((sum, u) => sum + u.skeinsNeeded, 0),
        });
      } catch (e) {
        console.error(`Error processing design ${design.id}:`, e);
        continue;
      }
    }

    // Sort by fulfillment capacity (lowest first = most urgent)
    alerts.sort((a, b) => a.fulfillmentCapacity - b.fulfillmentCapacity);

    // Build most used colors list
    const mostUsedColors: MostUsedColor[] = [];
    for (const [dmcNumber, data] of colorUsageMap.entries()) {
      const dmcColor = getDmcColorByNumber(dmcNumber);
      // Determine primary thread size (the one with more skeins needed)
      const primarySize: 5 | 8 = data.skeinsNeededBySize[5] >= data.skeinsNeededBySize[8] ? 5 : 8;
      const totalSkeinsNeeded = data.skeinsNeededBySize[5] + data.skeinsNeededBySize[8];
      const inventorySkeins = (inventoryBySize[5].get(dmcNumber) ?? 0) + (inventoryBySize[8].get(dmcNumber) ?? 0);
      const skeinsReservedInKits = data.skeinsReservedInKits[5] + data.skeinsReservedInKits[8];
      const effectiveInventory = Math.max(0, inventorySkeins - skeinsReservedInKits);

      mostUsedColors.push({
        dmcNumber,
        colorName: dmcColor?.name ?? "Unknown",
        hex: dmcColor?.hex ?? "#888888",
        totalStitches: data.totalStitches,
        designCount: data.designIds.size,
        totalSkeinsNeeded,
        inventorySkeins,
        skeinsReservedInKits,
        effectiveInventory,
        threadSize: primarySize,
      });
    }

    // Sort by total stitches (most used first), then by design count
    mostUsedColors.sort((a, b) => {
      if (b.totalStitches !== a.totalStitches) {
        return b.totalStitches - a.totalStitches;
      }
      return b.designCount - a.designCount;
    });

    // Summary stats
    const summary = {
      totalDesigns: alerts.length,
      criticalCount: alerts.filter((a) => a.fulfillmentCapacity <= 3).length,
      lowCount: alerts.filter((a) => a.fulfillmentCapacity >= 4 && a.fulfillmentCapacity <= 6).length,
      healthyCount: alerts.filter((a) => a.fulfillmentCapacity >= 7).length,
    };

    return NextResponse.json({ alerts, summary, mostUsedColors: mostUsedColors.slice(0, 25) });
  } catch (error) {
    console.error("Error calculating stock alerts:", error);
    return NextResponse.json(
      { error: "Failed to calculate stock alerts" },
      { status: 500 }
    );
  }
}

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

// GET - Calculate stock alerts for all non-draft designs
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all non-draft designs with pixel data
    const designs = await prisma.design.findMany({
      where: { isDraft: false },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        meshCount: true,
        stitchType: true,
        bufferPercent: true,
        pixelData: true,
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

        // Calculate fulfillment capacity for each color
        const colorRequirements: ColorRequirement[] = yarnUsage.map((usage) => {
          const dmcColor = getDmcColorByNumber(usage.dmcNumber);
          const inventorySkeins = inventoryMap.get(usage.dmcNumber) ?? 0;
          const fulfillmentCapacity = usage.skeinsNeeded > 0
            ? Math.floor(inventorySkeins / usage.skeinsNeeded)
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

    // Summary stats
    const summary = {
      totalDesigns: alerts.length,
      criticalCount: alerts.filter((a) => a.fulfillmentCapacity <= 3).length,
      lowCount: alerts.filter((a) => a.fulfillmentCapacity >= 4 && a.fulfillmentCapacity <= 6).length,
      healthyCount: alerts.filter((a) => a.fulfillmentCapacity >= 7).length,
    };

    return NextResponse.json({ alerts, summary });
  } catch (error) {
    console.error("Error calculating stock alerts:", error);
    return NextResponse.json(
      { error: "Failed to calculate stock alerts" },
      { status: 500 }
    );
  }
}

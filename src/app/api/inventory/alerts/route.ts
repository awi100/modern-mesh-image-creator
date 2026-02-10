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

interface ColorDesignUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  stitchCount: number;
  yardsNeeded: number;
  skeinsNeeded: number;
}

interface MostUsedColor {
  dmcNumber: string;
  colorName: string;
  hex: string;
  totalStitches: number;
  designCount: number;
  totalSkeinsNeeded: number; // Combined skeins needed for all designs (1 kit each)
  totalYardsNeeded: number; // Combined yards needed for all designs
  inventorySkeins: number;
  skeinsReservedInKits: number; // Skeins already used in assembled kits
  effectiveInventory: number; // inventorySkeins - skeinsReservedInKits
  threadSize: 5 | 8;
  designs: ColorDesignUsage[]; // Which designs use this color with usage details
  // Aggregate demand metrics
  coverageRounds: number; // How many complete rounds (1 kit of each design) can be made
  skeinsToNextRound: number; // Skeins needed to complete one more round
  isCritical: boolean; // Coverage < 1 round
}

interface GlobalDemandSummary {
  totalColors: number;
  criticalColors: number; // Colors with < 1 round coverage
  lowColors: number; // Colors with 1-2 rounds coverage
  healthyColors: number; // Colors with 3+ rounds coverage
}

interface OrderSuggestion {
  dmcNumber: string;
  colorName: string;
  hex: string;
  threadSize: 5 | 8;
  currentStock: number;
  demandPerRound: number;
  skeinsToOrder: number; // To complete 1 round
  skeinsFor2Rounds: number; // To have 2 complete rounds
  skeinsFor3Rounds: number; // To have 3 complete rounds
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
      totalYards: number;
      designs: ColorDesignUsage[];
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
          const yardsNeeded = usage?.withBuffer ?? 0;
          const skeinsReserved = skeinsNeeded * kitsReady; // Skeins used in assembled kits

          const designUsage: ColorDesignUsage = {
            id: design.id,
            name: design.name,
            previewImageUrl: design.previewImageUrl,
            stitchCount,
            yardsNeeded: Math.round(yardsNeeded * 10) / 10, // Round to 1 decimal
            skeinsNeeded,
          };

          if (existing) {
            existing.totalStitches += stitchCount;
            existing.totalYards += yardsNeeded;
            existing.designs.push(designUsage);
            existing.skeinsNeededBySize[threadSize] += skeinsNeeded;
            existing.skeinsReservedInKits[threadSize] += skeinsReserved;
          } else {
            colorUsageMap.set(dmcNumber, {
              totalStitches: stitchCount,
              totalYards: yardsNeeded,
              designs: [designUsage],
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
        // Inventory already reflects deductions from assembled kits, so use it directly
        const colorRequirements: ColorRequirement[] = yarnUsage.map((usage) => {
          const dmcColor = getDmcColorByNumber(usage.dmcNumber);
          const inventorySkeins = inventoryMap.get(usage.dmcNumber) ?? 0;
          // Inventory is already reduced when kits are assembled, no need to subtract again
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

    // Build most used colors list with aggregate demand metrics
    const mostUsedColors: MostUsedColor[] = [];
    for (const [dmcNumber, data] of colorUsageMap.entries()) {
      const dmcColor = getDmcColorByNumber(dmcNumber);
      // Determine primary thread size (the one with more skeins needed)
      const primarySize: 5 | 8 = data.skeinsNeededBySize[5] >= data.skeinsNeededBySize[8] ? 5 : 8;
      const totalSkeinsNeeded = data.skeinsNeededBySize[5] + data.skeinsNeededBySize[8];
      const totalYardsNeeded = Math.round(data.totalYards * 10) / 10;
      const inventorySkeins = (inventoryBySize[5].get(dmcNumber) ?? 0) + (inventoryBySize[8].get(dmcNumber) ?? 0);
      // Note: skeinsReservedInKits is tracked for display purposes only
      // The inventory already reflects deductions from kit assembly, so we don't subtract again
      const skeinsReservedInKits = data.skeinsReservedInKits[5] + data.skeinsReservedInKits[8];
      // effectiveInventory = current inventory (already accounts for assembled kits)
      const effectiveInventory = inventorySkeins;

      // Calculate aggregate demand metrics
      // totalSkeinsNeeded = skeins needed to make 1 kit of EACH design using this color
      const coverageRounds = totalSkeinsNeeded > 0
        ? Math.floor(effectiveInventory / totalSkeinsNeeded)
        : Infinity;
      const remainder = totalSkeinsNeeded > 0
        ? effectiveInventory % totalSkeinsNeeded
        : 0;
      const skeinsToNextRound = totalSkeinsNeeded > 0
        ? totalSkeinsNeeded - remainder
        : 0;
      const isCritical = coverageRounds < 1;

      // Sort designs by skeins needed (highest first)
      const sortedDesigns = [...data.designs].sort((a, b) => b.skeinsNeeded - a.skeinsNeeded);

      mostUsedColors.push({
        dmcNumber,
        colorName: dmcColor?.name ?? "Unknown",
        hex: dmcColor?.hex ?? "#888888",
        totalStitches: data.totalStitches,
        designCount: data.designs.length,
        totalSkeinsNeeded,
        totalYardsNeeded,
        inventorySkeins,
        skeinsReservedInKits,
        effectiveInventory,
        threadSize: primarySize,
        designs: sortedDesigns,
        coverageRounds: coverageRounds === Infinity ? 999 : coverageRounds,
        skeinsToNextRound,
        isCritical,
      });
    }

    // Sort by coverage rounds (lowest/most critical first), then by design count
    mostUsedColors.sort((a, b) => {
      if (a.coverageRounds !== b.coverageRounds) {
        return a.coverageRounds - b.coverageRounds;
      }
      return b.designCount - a.designCount;
    });

    // Summary stats for per-design alerts
    const summary = {
      totalDesigns: alerts.length,
      criticalCount: alerts.filter((a) => a.fulfillmentCapacity <= 3).length,
      lowCount: alerts.filter((a) => a.fulfillmentCapacity >= 4 && a.fulfillmentCapacity <= 6).length,
      healthyCount: alerts.filter((a) => a.fulfillmentCapacity >= 7).length,
    };

    // Global demand summary
    const globalDemand: GlobalDemandSummary = {
      totalColors: mostUsedColors.length,
      criticalColors: mostUsedColors.filter((c) => c.coverageRounds < 1).length,
      lowColors: mostUsedColors.filter((c) => c.coverageRounds >= 1 && c.coverageRounds <= 2).length,
      healthyColors: mostUsedColors.filter((c) => c.coverageRounds >= 3).length,
    };

    // Generate order suggestions for colors that need ordering (coverage < 1 or low)
    const orderSuggestions: OrderSuggestion[] = mostUsedColors
      .filter((c) => c.coverageRounds < 3 && c.totalSkeinsNeeded > 0) // Only colors that need attention
      .map((c) => {
        const demandPerRound = c.totalSkeinsNeeded;
        const currentStock = c.effectiveInventory;
        // Calculate how many skeins needed for 1, 2, 3 complete rounds
        const skeinsFor1Round = Math.max(0, demandPerRound - currentStock);
        const skeinsFor2Rounds = Math.max(0, demandPerRound * 2 - currentStock);
        const skeinsFor3Rounds = Math.max(0, demandPerRound * 3 - currentStock);

        return {
          dmcNumber: c.dmcNumber,
          colorName: c.colorName,
          hex: c.hex,
          threadSize: c.threadSize,
          currentStock,
          demandPerRound,
          skeinsToOrder: skeinsFor1Round,
          skeinsFor2Rounds,
          skeinsFor3Rounds,
        };
      })
      .filter((s) => s.skeinsToOrder > 0) // Only include if actually needs ordering
      .sort((a, b) => b.skeinsToOrder - a.skeinsToOrder); // Sort by most needed first

    return NextResponse.json({
      alerts,
      summary,
      mostUsedColors: mostUsedColors.slice(0, 50), // Increased from 25
      globalDemand,
      orderSuggestions,
    });
  } catch (error) {
    console.error("Error calculating stock alerts:", error);
    return NextResponse.json(
      { error: "Failed to calculate stock alerts" },
      { status: 500 }
    );
  }
}

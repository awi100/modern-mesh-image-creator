import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import {
  calculateYarnUsage,
  MeshCount,
  threadSizeForMesh,
  effectiveYardsPerSkein,
  bobbinThresholdsForThread,
} from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { meshCountWhere } from "@/lib/mesh-filter";
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
  // Velocity-based metrics
  salesVelocity: number | null; // units per week
  velocityCategory: string | null; // "fast", "medium", "slow", "new"
  velocityCategoryOverride: string | null;
  kitsReady: number;
  weeksOfStock: number; // kitsReady / velocity
  targetWeeks: number; // target weeks of stock for this velocity category
  stockStatus: "critical" | "low" | "healthy"; // based on weeks vs target
}

interface ColorDesignUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  stitchCount: number;
  yardsNeeded: number;
  skeinsNeeded: number;
  usesFullSkein: boolean;
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
  threadSize: 3 | 5;
  designs: ColorDesignUsage[]; // Which designs use this color with usage details
  // Aggregate demand metrics
  coverageRounds: number; // How many complete rounds (1 kit of each design) can be made
  skeinsToNextRound: number; // Skeins needed to complete one more round
  isCritical: boolean; // Coverage < 1 round
  // Backup color info
  backupDmcNumber: string | null;
  backupColorName: string | null;
  backupHex: string | null;
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
  threadSize: 3 | 5;
  currentStock: number;
  demandPerRound: number;
  currentCoverage: number;
  skeinsFor10Rounds: number; // To reach 10 rounds
  skeinsFor20Rounds: number; // To reach 20 rounds
  skeinsFor30Rounds: number; // To reach 30 rounds
}

// GET - Calculate stock alerts for all non-draft designs
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const meshFilter = new URL(request.url).searchParams.get("meshCount");
    const meshWhere = meshCountWhere(meshFilter);

    // Fetch excluded designs (to show in UI for toggling)
    const excludedDesigns = await prisma.design.findMany({
      where: { isDraft: false, deletedAt: null, archivedAt: null, excludeFromStockAlerts: true, printVersionOf: null, ...meshWhere },
      select: { id: true, name: true, previewImageUrl: true },
      orderBy: { name: "asc" },
    });

    // Fetch all non-draft designs with pixel data and velocity info (excluding ones marked for exclusion)
    const designs = await prisma.design.findMany({
      where: { isDraft: false, deletedAt: null, archivedAt: null, excludeFromStockAlerts: false, printVersionOf: null, ...meshWhere },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        meshCount: true,
        stitchType: true,
        bufferPercent: true,
        pixelData: true,
        kitsReady: true,
        // Velocity fields
        salesVelocity: true,
        velocityCategory: true,
        velocityCategoryOverride: true,
        targetStockWeeks: true,
      },
    });

    // Fetch all inventory
    const inventoryItems = await prisma.inventoryItem.findMany();

    // Fetch all color backups (bidirectional)
    const colorBackups = await prisma.colorBackup.findMany();
    const backupMap = new Map<string, string>();
    for (const cb of colorBackups) {
      backupMap.set(cb.dmcNumber, cb.backupDmcNumber);
      backupMap.set(cb.backupDmcNumber, cb.dmcNumber); // Bidirectional
    }

    // Build inventory maps by thread size (3 for 13ct, 5 for 14/18ct)
    const inventoryBySize: Record<number, Map<string, number>> = {
      3: new Map(),
      5: new Map(),
    };
    for (const item of inventoryItems) {
      if (!inventoryBySize[item.size]) inventoryBySize[item.size] = new Map();
      inventoryBySize[item.size].set(item.dmcNumber, item.skeins);
    }

    const alerts: DesignAlert[] = [];

    // Aggregate color usage tracking
    // Keyed by "dmcNumber-threadSize" so 13ct (Size 3) and 14/18ct (Size 5)
    // demand for the same DMC color stays separate.
    const colorUsageMap = new Map<string, {
      dmcNumber: string;
      threadSize: 3 | 5;
      totalStitches: number;
      totalYards: number;
      designs: ColorDesignUsage[];
      skeinsNeeded: number;
      skeinsReservedInKits: number; // Skeins already used in assembled kits
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
        const meshCount = (design.meshCount || 14) as MeshCount;
        const threadSize = threadSizeForMesh(meshCount);
        const stitchType = design.stitchType as "continental" | "basketweave";
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          meshCount,
          stitchType,
          design.bufferPercent
        );

        // Track aggregate color usage keyed by (dmcNumber, threadSize)
        // — 13ct + Size 3 demand is separate from 14/18ct + Size 5 demand
        const kitsReady = design.kitsReady || 0;
        for (const [dmcNumber, stitchCount] of stitchCounts.entries()) {
          const aggKey = `${dmcNumber}-${threadSize}`;
          const existing = colorUsageMap.get(aggKey);
          const usage = yarnUsage.find((u) => u.dmcNumber === dmcNumber);
          const skeinsNeeded = usage?.skeinsNeeded ?? 0;
          const usesFullSkein = usage?.usesFullSkein ?? false;
          const yardsNeeded = usage?.withBuffer ?? 0;
          const skeinsReserved = usesFullSkein ? skeinsNeeded * kitsReady : 0;

          const designUsage: ColorDesignUsage = {
            id: design.id,
            name: design.name,
            previewImageUrl: design.previewImageUrl,
            stitchCount,
            yardsNeeded: Math.round(yardsNeeded * 10) / 10,
            skeinsNeeded: usesFullSkein ? skeinsNeeded : 0,
            usesFullSkein,
          };

          const fullSkeinsCount = usesFullSkein ? skeinsNeeded : 0;

          if (existing) {
            existing.totalStitches += stitchCount;
            existing.totalYards += yardsNeeded;
            existing.designs.push(designUsage);
            existing.skeinsNeeded += fullSkeinsCount;
            existing.skeinsReservedInKits += skeinsReserved;
          } else {
            colorUsageMap.set(aggKey, {
              dmcNumber,
              threadSize,
              totalStitches: stitchCount,
              totalYards: yardsNeeded,
              designs: [designUsage],
              skeinsNeeded: fullSkeinsCount,
              skeinsReservedInKits: skeinsReserved,
            });
          }
        }

        // Get inventory for THIS design's thread size
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

        // Calculate velocity-based metrics
        const velocity = design.salesVelocity ?? 0;
        const kitsReadyCount = design.kitsReady ?? 0;
        const weeksOfStock = velocity > 0 ? kitsReadyCount / velocity : (kitsReadyCount > 0 ? 999 : 0);

        // Determine target weeks based on velocity category
        let targetWeeks = design.targetStockWeeks;
        if (!targetWeeks) {
          switch (design.velocityCategory) {
            case "fast": targetWeeks = 6; break;
            case "medium": targetWeeks = 8; break;
            case "slow": targetWeeks = 12; break;
            case "new": targetWeeks = 4; break;
            default: targetWeeks = 8;
          }
        }

        // Determine stock status based on weeks vs target
        let stockStatus: "critical" | "low" | "healthy";
        const criticalThreshold = targetWeeks * 0.33; // 1/3 of target
        const lowThreshold = targetWeeks * 0.66; // 2/3 of target

        if (weeksOfStock < criticalThreshold) {
          stockStatus = "critical";
        } else if (weeksOfStock < lowThreshold) {
          stockStatus = "low";
        } else {
          stockStatus = "healthy";
        }

        alerts.push({
          id: design.id,
          name: design.name,
          previewImageUrl: design.previewImageUrl,
          meshCount: design.meshCount,
          fulfillmentCapacity: minCapacity === Infinity ? 999 : minCapacity,
          bottleneckColors: bottleneckColors.slice(0, 5), // Top 5 bottlenecks
          totalColors: colorRequirements.length,
          totalSkeinsPerKit: yarnUsage.reduce((sum, u) => sum + u.skeinsNeeded, 0),
          // Velocity-based metrics
          salesVelocity: design.salesVelocity,
          velocityCategory: design.velocityCategory,
          velocityCategoryOverride: design.velocityCategoryOverride,
          kitsReady: kitsReadyCount,
          weeksOfStock: Math.round(weeksOfStock * 10) / 10,
          targetWeeks,
          stockStatus,
        });
      } catch (e) {
        console.error(`Error processing design ${design.id}:`, e);
        continue;
      }
    }

    // Sort by stock status (critical first), then by weeks of stock (lowest first), then by velocity (highest first)
    const statusOrder = { critical: 0, low: 1, healthy: 2 };
    alerts.sort((a, b) => {
      // First by status
      if (statusOrder[a.stockStatus] !== statusOrder[b.stockStatus]) {
        return statusOrder[a.stockStatus] - statusOrder[b.stockStatus];
      }
      // Then by weeks of stock (lowest first)
      if (a.weeksOfStock !== b.weeksOfStock) {
        return a.weeksOfStock - b.weeksOfStock;
      }
      // Then by velocity (highest first - more urgent)
      return (b.salesVelocity ?? 0) - (a.salesVelocity ?? 0);
    });

    // Build most used colors list with aggregate demand metrics.
    // Effective yards per skein and the bobbin-vs-full-skein threshold both
    // depend on thread size — Size 3 (13ct) has smaller skeins than Size 5.
    const mostUsedColors: MostUsedColor[] = [];
    for (const [, data] of colorUsageMap.entries()) {
      const dmcNumber = data.dmcNumber;
      const threadSize = data.threadSize;
      const effectivePerSkein = effectiveYardsPerSkein(threadSize);
      const fullSkeinThreshold = bobbinThresholdsForThread(threadSize).max;
      const dmcColor = getDmcColorByNumber(dmcNumber);
      const totalYardsNeeded = Math.round(data.totalYards * 10) / 10;
      const totalSkeinsNeeded = data.totalYards <= fullSkeinThreshold
        ? 0
        : Math.ceil(data.totalYards / effectivePerSkein);
      const inventorySkeins = inventoryBySize[threadSize]?.get(dmcNumber) ?? 0;
      const skeinsReservedInKits = data.skeinsReservedInKits;
      const effectiveInventory = inventorySkeins;

      const coverageRounds = totalSkeinsNeeded > 0
        ? Math.floor(effectiveInventory / totalSkeinsNeeded)
        : Infinity;
      const remainder = totalSkeinsNeeded > 0
        ? effectiveInventory % totalSkeinsNeeded
        : 0;
      const skeinsToNextRound = totalSkeinsNeeded > 0
        ? totalSkeinsNeeded - remainder
        : 0;
      const isCritical = coverageRounds < 3;

      const sortedDesigns = [...data.designs].sort((a, b) => b.skeinsNeeded - a.skeinsNeeded);

      const backupDmcNum = backupMap.get(dmcNumber) ?? null;
      const backupColor = backupDmcNum ? getDmcColorByNumber(backupDmcNum) : null;

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
        threadSize,
        designs: sortedDesigns,
        coverageRounds: coverageRounds === Infinity ? 999 : coverageRounds,
        skeinsToNextRound,
        isCritical,
        backupDmcNumber: backupDmcNum,
        backupColorName: backupColor?.name ?? null,
        backupHex: backupColor?.hex ?? null,
      });
    }

    // Sort by coverage rounds (lowest/most critical first), then by design count
    mostUsedColors.sort((a, b) => {
      if (a.coverageRounds !== b.coverageRounds) {
        return a.coverageRounds - b.coverageRounds;
      }
      return b.designCount - a.designCount;
    });

    // Summary stats for per-design alerts (velocity-based)
    const summary = {
      totalDesigns: alerts.length,
      // Velocity-based counts
      criticalCount: alerts.filter((a) => a.stockStatus === "critical").length,
      lowCount: alerts.filter((a) => a.stockStatus === "low").length,
      healthyCount: alerts.filter((a) => a.stockStatus === "healthy").length,
      // Velocity category counts
      fastCount: alerts.filter((a) => a.velocityCategory === "fast").length,
      mediumCount: alerts.filter((a) => a.velocityCategory === "medium").length,
      slowCount: alerts.filter((a) => a.velocityCategory === "slow").length,
      newCount: alerts.filter((a) => a.velocityCategory === "new").length,
      // Legacy capacity-based counts (for backwards compatibility)
      legacyCritical: alerts.filter((a) => a.fulfillmentCapacity <= 3).length,
      legacyLow: alerts.filter((a) => a.fulfillmentCapacity >= 4 && a.fulfillmentCapacity <= 6).length,
      legacyHealthy: alerts.filter((a) => a.fulfillmentCapacity >= 7).length,
    };

    // Global demand summary
    // Critical: < 3 rounds, Low: 3-6 rounds, Healthy: 7+ rounds
    const globalDemand: GlobalDemandSummary = {
      totalColors: mostUsedColors.length,
      criticalColors: mostUsedColors.filter((c) => c.coverageRounds < 3).length,
      lowColors: mostUsedColors.filter((c) => c.coverageRounds >= 3 && c.coverageRounds <= 6).length,
      healthyColors: mostUsedColors.filter((c) => c.coverageRounds >= 7).length,
    };

    // Generate order suggestions for colors that need ordering (< 10 rounds)
    const orderSuggestions: OrderSuggestion[] = mostUsedColors
      .filter((c) => c.coverageRounds < 10 && c.totalSkeinsNeeded > 0)
      .map((c) => {
        const demandPerRound = c.totalSkeinsNeeded;
        const currentStock = c.effectiveInventory;
        const currentCoverage = c.coverageRounds;
        // Calculate how many skeins needed to reach target levels (10, 20, 30 rounds)
        const skeinsFor10Rounds = Math.max(0, demandPerRound * 10 - currentStock);
        const skeinsFor20Rounds = Math.max(0, demandPerRound * 20 - currentStock);
        const skeinsFor30Rounds = Math.max(0, demandPerRound * 30 - currentStock);

        return {
          dmcNumber: c.dmcNumber,
          colorName: c.colorName,
          hex: c.hex,
          threadSize: c.threadSize,
          currentStock,
          demandPerRound,
          currentCoverage,
          skeinsFor10Rounds,
          skeinsFor20Rounds,
          skeinsFor30Rounds,
        };
      })
      .filter((s) => s.skeinsFor10Rounds > 0) // Only include if needs ordering to reach 10 rounds
      .sort((a, b) => b.skeinsFor10Rounds - a.skeinsFor10Rounds); // Sort by most needed first

    return NextResponse.json({
      alerts,
      summary,
      mostUsedColors: mostUsedColors.slice(0, 50), // Increased from 25
      globalDemand,
      orderSuggestions,
      excludedDesigns,
    });
  } catch (error) {
    console.error("Error calculating stock alerts:", error);
    return NextResponse.json(
      { error: "Failed to calculate stock alerts" },
      { status: 500 }
    );
  }
}

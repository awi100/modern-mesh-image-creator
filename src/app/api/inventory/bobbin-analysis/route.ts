import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, MeshCount, threadSizeForMesh, bobbinThresholdsForMesh, ThreadSize } from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { meshCountWhere } from "@/lib/mesh-filter";
import pako from "pako";

const BOBBIN_TOLERANCE = 0.2; // A bobbin can cover needs within ±0.2 yards of its size

// Snap yards to nearest whole-yard bobbin size, accounting for ±0.2 tolerance.
// 2.7 → 3, 3.15 → 3 (tolerance), 3.25 → 4 (need bigger bobbin).
function bobbinSizeFor(yards: number): number {
  return Math.ceil(yards - BOBBIN_TOLERANCE);
}

interface BobbinRequirement {
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  exactYards: number;
  roundedYards: number;
}

interface ColorBobbinAnalysis {
  dmcNumber: string;
  colorName: string;
  hex: string;
  threadSize: ThreadSize;
  bobbins: BobbinRequirement[];
  // Grouped by rounded length
  groupedByLength: {
    length: number;
    count: number;
    designs: string[];
  }[];
  // Summary
  totalBobbins: number;
  uniqueLengths: number;
  // Inventory
  onHand: number;
  gap: number; // totalBobbins - onHand (positive = need to make more)
}

interface BobbinSuggestion {
  dmcNumber: string;
  colorName: string;
  hex: string;
  threadSize: ThreadSize;
  length: number;
  quantity: number; // designs that need this size of bobbin
  onHand: number; // bobbins of this exact size in inventory
  make: number; // shortfall after larger bobbins trickle down to cover smaller needs
  designs: {
    id: string;
    name: string;
    previewImageUrl: string | null;
    exactYards: number;
  }[];
}

// GET - Analyze bobbin requirements across all designs
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const meshFilter = new URL(request.url).searchParams.get("meshCount");
    const meshWhere = meshCountWhere(meshFilter);

    // Fetch non-draft designs (filtered by mesh count if specified)
    const designs = await prisma.design.findMany({
      where: {
        isDraft: false,
        deletedAt: null,
        archivedAt: null,
        printVersionOf: null,
        ...meshWhere,
      },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        meshCount: true,
        pixelData: true,
        stitchType: true,
        bufferPercent: true,
      },
      orderBy: { name: "asc" },
    });

    // Map of DMC number -> bobbin requirements from each design
    const colorBobbinsMap = new Map<string, {
      threadSize: ThreadSize;
      bobbins: BobbinRequirement[];
    }>();

    for (const design of designs) {
      if (!design.pixelData) continue;

      try {
        // Decompress pixel data and count stitches
        const compressed = Buffer.from(design.pixelData);
        const decompressed = pako.inflate(compressed, { to: "string" });
        const grid: (string | null)[][] = JSON.parse(decompressed);
        const stitchCounts = countStitchesByColor(grid);

        const meshCount = (design.meshCount || 14) as MeshCount;
        const threadSize = threadSizeForMesh(meshCount);
        const { min: bobbinMin, max: bobbinMax } = bobbinThresholdsForMesh(meshCount);

        // Calculate yarn usage
        const stitchType = (design.stitchType || "continental") as "continental" | "basketweave";
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          meshCount,
          stitchType,
          design.bufferPercent || 20
        );

        // Find colors that need pre-made bobbins for THIS design's thread size.
        // Skip < bobbinMin (finger wrap), > bobbinMax (full skein).
        for (const usage of yarnUsage) {
          if (usage.withBuffer >= bobbinMin && usage.withBuffer <= bobbinMax) {
            const key = `${usage.dmcNumber}-${threadSize}`;

            if (!colorBobbinsMap.has(key)) {
              colorBobbinsMap.set(key, {
                threadSize,
                bobbins: [],
              });
            }

            colorBobbinsMap.get(key)!.bobbins.push({
              designId: design.id,
              designName: design.name,
              previewImageUrl: design.previewImageUrl,
              exactYards: Math.round(usage.withBuffer * 10) / 10,
              roundedYards: bobbinSizeFor(usage.withBuffer),
            });
          }
        }
      } catch {
        continue;
      }
    }

    // Fetch current bobbin inventory keyed by (dmcNumber, length, threadSize)
    const bobbinInventory = await prisma.bobbinInventory.findMany();
    const bobbinInventoryMap = new Map(
      bobbinInventory.map(b => [`${b.dmcNumber}-${b.length}-${b.threadSize}`, b.count])
    );

    // Also include colors with inventory but no current need (so user can see what they have)
    const colorsInInventoryButNotNeeded = new Set(
      bobbinInventory
        .map(b => `${b.dmcNumber}-${b.length}-${b.threadSize}`)
        .filter(key => {
          const [dmc, lenStr, tsStr] = key.split("-");
          const len = parseInt(lenStr, 10);
          const ts = parseInt(tsStr, 10);
          const data = colorBobbinsMap.get(`${dmc}-${ts}`);
          if (!data) return true;
          return !data.bobbins.some(bb => bb.roundedYards === len);
        })
    );

    // Build analysis results
    const colorAnalysis: ColorBobbinAnalysis[] = [];
    const suggestions: BobbinSuggestion[] = [];

    // Track which inventory lengths exist per (color, threadSize) so we can
    // include larger sizes when computing trickle-down
    const inventoryLengthsByColorThread = new Map<string, Set<number>>();
    for (const b of bobbinInventory) {
      const k = `${b.dmcNumber}-${b.threadSize}`;
      if (!inventoryLengthsByColorThread.has(k)) {
        inventoryLengthsByColorThread.set(k, new Set());
      }
      inventoryLengthsByColorThread.get(k)!.add(b.length);
    }

    for (const [key, data] of colorBobbinsMap.entries()) {
      const [dmcNumber, tsStr] = key.split("-");
      const threadSize = parseInt(tsStr, 10) as ThreadSize;
      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      // Group by rounded length
      const lengthGroups = new Map<number, BobbinRequirement[]>();
      for (const bobbin of data.bobbins) {
        if (!lengthGroups.has(bobbin.roundedYards)) {
          lengthGroups.set(bobbin.roundedYards, []);
        }
        lengthGroups.get(bobbin.roundedYards)!.push(bobbin);
      }

      // Trickle-down allocation: larger bobbins can cover smaller needs (same threadSize only).
      const allLengths = new Set<number>(lengthGroups.keys());
      for (const len of inventoryLengthsByColorThread.get(`${dmcNumber}-${threadSize}`) || []) {
        allLengths.add(len);
      }
      const sortedLengthsDesc = Array.from(allLengths).sort((a, b) => b - a);
      const makeByLength = new Map<number, number>();
      let leftoverFromLarger = 0;
      for (const len of sortedLengthsDesc) {
        const need = lengthGroups.get(len)?.length || 0;
        const ownInv = bobbinInventoryMap.get(`${dmcNumber}-${len}-${threadSize}`) || 0;
        const totalAvailable = ownInv + leftoverFromLarger;
        if (totalAvailable >= need) {
          leftoverFromLarger = totalAvailable - need;
          makeByLength.set(len, 0);
        } else {
          makeByLength.set(len, need - totalAvailable);
          leftoverFromLarger = 0;
        }
      }

      const groupedByLength = Array.from(lengthGroups.entries())
        .map(([length, bobbins]) => ({
          length,
          count: bobbins.length,
          designs: bobbins.map(b => b.designName),
        }))
        .sort((a, b) => a.length - b.length);

      const totalBobbins = data.bobbins.length;
      const onHand = Array.from(lengthGroups.keys()).reduce(
        (sum, len) => sum + (bobbinInventoryMap.get(`${dmcNumber}-${len}-${threadSize}`) || 0),
        0
      );
      colorAnalysis.push({
        dmcNumber,
        colorName: color.name,
        hex: color.hex,
        threadSize: data.threadSize,
        bobbins: data.bobbins.sort((a, b) => a.roundedYards - b.roundedYards),
        groupedByLength,
        totalBobbins,
        uniqueLengths: groupedByLength.length,
        onHand,
        gap: totalBobbins - onHand,
      });

      // Add to suggestions list (one row per (color, length, threadSize))
      for (const [length, bobbins] of lengthGroups.entries()) {
        suggestions.push({
          dmcNumber,
          colorName: color.name,
          hex: color.hex,
          threadSize: data.threadSize,
          length,
          quantity: bobbins.length,
          onHand: bobbinInventoryMap.get(`${dmcNumber}-${length}-${threadSize}`) || 0,
          make: makeByLength.get(length) || 0,
          designs: bobbins.map(b => ({
            id: b.designId,
            name: b.designName,
            previewImageUrl: b.previewImageUrl,
            exactYards: b.exactYards,
          })),
        });
      }
    }

    // Also add inventory rows that aren't currently needed (so user sees what they have)
    for (const key of colorsInInventoryButNotNeeded) {
      const [dmcNumber, lenStr, tsStr] = key.split("-");
      const length = parseInt(lenStr, 10);
      const threadSize = parseInt(tsStr, 10) as ThreadSize;
      const onHand = bobbinInventoryMap.get(key) || 0;
      if (onHand === 0) continue;
      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;
      suggestions.push({
        dmcNumber,
        colorName: color.name,
        hex: color.hex,
        threadSize,
        length,
        quantity: 0,
        onHand,
        make: 0,
        designs: [],
      });
    }

    // Sort by total bobbins needed (most useful to pre-make first)
    colorAnalysis.sort((a, b) => b.totalBobbins - a.totalBobbins);

    // Sort suggestions by quantity (most needed first), then by color
    suggestions.sort((a, b) => {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      return a.dmcNumber.localeCompare(b.dmcNumber);
    });

    // Summary stats
    const summary = {
      totalColors: colorAnalysis.length,
      totalBobbins: suggestions.reduce((sum, s) => sum + s.quantity, 0),
      mostCommonLengths: (() => {
        const lengthCounts = new Map<number, number>();
        for (const s of suggestions) {
          lengthCounts.set(s.length, (lengthCounts.get(s.length) || 0) + s.quantity);
        }
        return Array.from(lengthCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([length, count]) => ({ length, count }));
      })(),
    };

    return NextResponse.json({
      colorAnalysis,
      suggestions,
      summary,
    });
  } catch (error) {
    console.error("Error analyzing bobbins:", error);
    return NextResponse.json(
      { error: "Failed to analyze bobbins" },
      { status: 500 }
    );
  }
}

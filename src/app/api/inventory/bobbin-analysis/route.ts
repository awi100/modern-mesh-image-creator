import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import pako from "pako";

const BOBBIN_ONLY_MAX = 5; // Yards threshold - below this we use bobbins only

// Standard bobbin lengths to round up to (in yards)
const BOBBIN_INCREMENTS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

function roundUpToIncrement(yards: number): number {
  for (const increment of BOBBIN_INCREMENTS) {
    if (yards <= increment) {
      return increment;
    }
  }
  return 5; // Max bobbin size
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
  threadSize: 5 | 8;
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
}

interface BobbinSuggestion {
  dmcNumber: string;
  colorName: string;
  hex: string;
  threadSize: 5 | 8;
  length: number;
  quantity: number;
  designs: {
    id: string;
    name: string;
    previewImageUrl: string | null;
    exactYards: number;
  }[];
}

// GET - Analyze bobbin requirements across all designs
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all non-draft designs
    const designs = await prisma.design.findMany({
      where: {
        isDraft: false,
        deletedAt: null,
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
      threadSize: 5 | 8;
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

        // Calculate yarn usage
        const meshCount = design.meshCount as 14 | 18;
        const stitchType = (design.stitchType || "continental") as "continental" | "basketweave";
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          meshCount,
          stitchType,
          design.bufferPercent || 20
        );

        // Thread size based on mesh
        const threadSize: 5 | 8 = meshCount === 14 ? 5 : 8;

        // Find colors that need bobbins (under threshold)
        for (const usage of yarnUsage) {
          if (usage.withBuffer <= BOBBIN_ONLY_MAX && usage.withBuffer > 0) {
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
              roundedYards: roundUpToIncrement(usage.withBuffer),
            });
          }
        }
      } catch {
        continue;
      }
    }

    // Build analysis results - only include colors with 2+ bobbin requirements
    const colorAnalysis: ColorBobbinAnalysis[] = [];
    const suggestions: BobbinSuggestion[] = [];

    for (const [key, data] of colorBobbinsMap.entries()) {
      // Skip colors with only 1 bobbin needed
      if (data.bobbins.length < 2) continue;

      const dmcNumber = key.split("-")[0];
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

      const groupedByLength = Array.from(lengthGroups.entries())
        .map(([length, bobbins]) => ({
          length,
          count: bobbins.length,
          designs: bobbins.map(b => b.designName),
        }))
        .sort((a, b) => a.length - b.length);

      colorAnalysis.push({
        dmcNumber,
        colorName: color.name,
        hex: color.hex,
        threadSize: data.threadSize,
        bobbins: data.bobbins.sort((a, b) => a.roundedYards - b.roundedYards),
        groupedByLength,
        totalBobbins: data.bobbins.length,
        uniqueLengths: groupedByLength.length,
      });

      // Add to suggestions list
      for (const [length, bobbins] of lengthGroups.entries()) {
        suggestions.push({
          dmcNumber,
          colorName: color.name,
          hex: color.hex,
          threadSize: data.threadSize,
          length,
          quantity: bobbins.length,
          designs: bobbins.map(b => ({
            id: b.designId,
            name: b.designName,
            previewImageUrl: b.previewImageUrl,
            exactYards: b.exactYards,
          })),
        });
      }
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

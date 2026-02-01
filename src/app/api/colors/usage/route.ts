import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import pako from "pako";

const SKEIN_YARDS = 27;
const BOBBIN_ONLY_MAX = 5;
const LEFTOVER_THRESHOLD = 5;

// Calculate full skeins and bobbin yards from total yards needed
function calculateSkeinBreakdown(yardsWithBuffer: number): { fullSkeins: number; bobbinYards: number } {
  if (yardsWithBuffer <= BOBBIN_ONLY_MAX) {
    return { fullSkeins: 0, bobbinYards: yardsWithBuffer };
  }

  const baseSkeins = Math.floor(yardsWithBuffer / SKEIN_YARDS);
  const remainder = yardsWithBuffer - baseSkeins * SKEIN_YARDS;

  // If remainder is small enough, round up to an extra skein
  if (remainder > 0 && remainder <= LEFTOVER_THRESHOLD) {
    return { fullSkeins: baseSkeins + 1, bobbinYards: 0 };
  }

  return { fullSkeins: baseSkeins, bobbinYards: remainder };
}

interface DesignUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  stitchCount: number;
  skeinsNeeded: number;
  yardsWithBuffer: number;
  fullSkeins: number;
  bobbinYards: number;
}

interface ColorUsage {
  dmcNumber: string;
  designs: DesignUsage[];
}

// GET - Fetch which designs use each color, including yarn usage
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all non-draft designs with their pixel data for yarn calculation
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
        colorsUsed: true,
        pixelData: true,
        stitchType: true,
        bufferPercent: true,
      },
      orderBy: { name: "asc" },
    });

    // Build a map of DMC number -> designs using it with yarn usage
    const colorUsageMap = new Map<string, DesignUsage[]>();

    for (const design of designs) {
      if (!design.colorsUsed || !design.pixelData) continue;

      try {
        // Decompress pixel data and count stitches
        const compressed = Buffer.from(design.pixelData);
        const decompressed = pako.inflate(compressed, { to: "string" });
        const grid: (string | null)[][] = JSON.parse(decompressed);
        const stitchCounts = countStitchesByColor(grid);

        // Calculate yarn usage for all colors in this design
        const meshCount = design.meshCount as 14 | 18;
        const stitchType = (design.stitchType || "continental") as "continental" | "basketweave";
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          meshCount,
          stitchType,
          design.bufferPercent || 20
        );

        // Create a lookup map for this design's yarn usage
        const usageByColor = new Map<string, typeof yarnUsage[0]>();
        for (const usage of yarnUsage) {
          usageByColor.set(usage.dmcNumber, usage);
        }

        // Add each color to the map
        const colors: string[] = JSON.parse(design.colorsUsed);
        for (const dmcNumber of colors) {
          if (!colorUsageMap.has(dmcNumber)) {
            colorUsageMap.set(dmcNumber, []);
          }

          const usage = usageByColor.get(dmcNumber);
          const yardsWithBuffer = usage?.withBuffer || 0;
          const { fullSkeins, bobbinYards } = calculateSkeinBreakdown(yardsWithBuffer);

          colorUsageMap.get(dmcNumber)!.push({
            id: design.id,
            name: design.name,
            previewImageUrl: design.previewImageUrl,
            meshCount: design.meshCount,
            stitchCount: usage?.stitchCount || stitchCounts.get(dmcNumber) || 0,
            skeinsNeeded: usage?.skeinsNeeded || 0,
            yardsWithBuffer,
            fullSkeins,
            bobbinYards,
          });
        }
      } catch {
        // Skip designs with invalid data
        continue;
      }
    }

    // Convert to array format
    const colorUsage: ColorUsage[] = Array.from(colorUsageMap.entries()).map(
      ([dmcNumber, designs]) => ({
        dmcNumber,
        designs,
      })
    );

    return NextResponse.json(colorUsage);
  } catch (error) {
    console.error("Error fetching color usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch color usage" },
      { status: 500 }
    );
  }
}

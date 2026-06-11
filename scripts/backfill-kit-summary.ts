/**
 * Backfill script to recompute kitColorCount and kitSkeinCount
 * for all existing designs using the app's real yarn calculator.
 *
 * Run after changing yarn rates in src/lib/yarn-calculator.ts so the
 * precomputed kit summaries match what the kit pages compute live.
 *
 * Run with: npx tsx scripts/backfill-kit-summary.ts
 */
import { PrismaClient } from "@prisma/client";
import pako from "pako";
import { calculateYarnUsage, type MeshCount, type StitchType } from "../src/lib/yarn-calculator.ts";

function countStitchesByColor(grid: (string | null)[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell) {
        counts.set(cell, (counts.get(cell) || 0) + 1);
      }
    }
  }
  return counts;
}

async function backfill() {
  const prisma = new PrismaClient();

  try {
    const designs = await prisma.design.findMany({
      select: {
        id: true,
        name: true,
        pixelData: true,
        meshCount: true,
        stitchType: true,
        bufferPercent: true,
        kitColorCount: true,
        kitSkeinCount: true,
      },
    });

    console.log(`Processing ${designs.length} designs...`);

    let updated = 0;
    let unchanged = 0;
    for (const design of designs) {
      try {
        const decompressed = pako.inflate(Buffer.from(design.pixelData), {
          to: "string",
        });
        const grid: (string | null)[][] = JSON.parse(decompressed);
        const stitchCounts = countStitchesByColor(grid);

        // Mirror the save-time computation in src/app/api/designs/route.ts
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          design.meshCount as MeshCount,
          design.stitchType as StitchType,
          design.bufferPercent
        );
        const kitColorCount = yarnUsage.length;
        const kitSkeinCount = yarnUsage.reduce(
          (sum, u) => sum + (u.usesFullSkein ? u.skeinsNeeded : 0),
          0
        );

        if (kitColorCount === design.kitColorCount && kitSkeinCount === design.kitSkeinCount) {
          unchanged++;
          continue;
        }

        await prisma.design.update({
          where: { id: design.id },
          data: { kitColorCount, kitSkeinCount },
        });

        console.log(
          `  ${design.name} (${design.meshCount}ct): ${design.kitColorCount}c/${design.kitSkeinCount}sk → ${kitColorCount}c/${kitSkeinCount}sk`
        );
        updated++;
      } catch (e) {
        console.error(`  Failed for "${design.name}" (${design.id}):`, e);
      }
    }

    console.log(`\nDone. Updated ${updated}, unchanged ${unchanged}, of ${designs.length} designs.`);
  } finally {
    await prisma.$disconnect();
  }
}

backfill();

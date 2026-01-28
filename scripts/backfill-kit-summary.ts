/**
 * One-time backfill script to compute kitColorCount and kitSkeinCount
 * for all existing designs.
 *
 * Run with: npx tsx scripts/backfill-kit-summary.ts
 */
import { PrismaClient } from "@prisma/client";
import pako from "pako";

// Inline the yarn calculation logic to avoid module resolution issues
const SKEIN_YARDS = 27;

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

function calculateSkeins(
  stitchCounts: Map<string, number>,
  meshCount: number,
  stitchType: string,
  bufferPercent: number
): { count: number; totalSkeins: number } {
  const yardsPerSqIn =
    meshCount === 14
      ? stitchType === "basketweave"
        ? 2.4
        : 2.1
      : stitchType === "basketweave"
        ? 3.1
        : 2.7;

  let totalSkeins = 0;
  for (const [, stitches] of stitchCounts) {
    const sqInches = stitches / (meshCount * meshCount);
    const yards = sqInches * yardsPerSqIn * (1 + bufferPercent / 100);
    totalSkeins += Math.ceil(yards / SKEIN_YARDS);
  }

  return { count: stitchCounts.size, totalSkeins };
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
      },
    });

    console.log(`Processing ${designs.length} designs...`);

    let updated = 0;
    for (const design of designs) {
      try {
        const decompressed = pako.inflate(Buffer.from(design.pixelData), {
          to: "string",
        });
        const grid: (string | null)[][] = JSON.parse(decompressed);
        const stitchCounts = countStitchesByColor(grid);
        const { count, totalSkeins } = calculateSkeins(
          stitchCounts,
          design.meshCount,
          design.stitchType,
          design.bufferPercent
        );

        await prisma.design.update({
          where: { id: design.id },
          data: {
            kitColorCount: count,
            kitSkeinCount: totalSkeins,
          },
        });

        console.log(
          `  ${design.name}: ${count} colors, ${totalSkeins} skeins`
        );
        updated++;
      } catch (e) {
        console.error(`  Failed for "${design.name}" (${design.id}):`, e);
      }
    }

    console.log(`\nDone. Updated ${updated}/${designs.length} designs.`);
  } finally {
    await prisma.$disconnect();
  }
}

backfill();

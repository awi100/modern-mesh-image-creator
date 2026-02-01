/**
 * One-time backfill script to compute colorsUsed
 * for all existing designs.
 *
 * Run with: npx tsx scripts/backfill-colors-used.ts
 */
import { PrismaClient } from "@prisma/client";
import pako from "pako";

function extractColors(grid: (string | null)[][]): string[] {
  const colors = new Set<string>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell) {
        colors.add(cell);
      }
    }
  }
  return Array.from(colors).sort();
}

async function backfill() {
  const prisma = new PrismaClient();

  try {
    const designs = await prisma.design.findMany({
      select: {
        id: true,
        name: true,
        pixelData: true,
        colorsUsed: true,
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
        const colors = extractColors(grid);

        await prisma.design.update({
          where: { id: design.id },
          data: {
            colorsUsed: JSON.stringify(colors),
          },
        });

        console.log(`  ${design.name}: ${colors.length} colors`);
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

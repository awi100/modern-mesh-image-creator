import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import pako from "pako";

// POST - Backfill totalStitches for all designs
export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all designs with pixel data
    const designs = await prisma.design.findMany({
      select: {
        id: true,
        name: true,
        pixelData: true,
        totalStitches: true,
      },
    });

    const results: { id: string; name: string; totalStitches: number }[] = [];
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const design of designs) {
      if (!design.pixelData) {
        skipped++;
        continue;
      }

      try {
        // Decompress pixel data
        const compressed = Buffer.from(design.pixelData);
        const decompressed = pako.inflate(compressed, { to: "string" });
        const grid: (string | null)[][] = JSON.parse(decompressed);

        // Count stitches
        const stitchCounts = countStitchesByColor(grid);
        let totalStitches = 0;
        for (const count of stitchCounts.values()) {
          totalStitches += count;
        }

        // Update the design
        await prisma.design.update({
          where: { id: design.id },
          data: { totalStitches },
        });

        results.push({
          id: design.id,
          name: design.name,
          totalStitches,
        });
        updated++;
      } catch (e) {
        console.error(`Error processing design ${design.id}:`, e);
        errors++;
      }
    }

    return NextResponse.json({
      message: "Backfill complete",
      updated,
      skipped,
      errors,
      total: designs.length,
      results,
    });
  } catch (error) {
    console.error("Error backfilling stitches:", error);
    return NextResponse.json(
      { error: "Failed to backfill stitches" },
      { status: 500 }
    );
  }
}

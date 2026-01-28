import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import pako from "pako";

// POST - Record a kit sale and deduct inventory
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { note } = body;

    const design = await prisma.design.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        meshCount: true,
        stitchType: true,
        bufferPercent: true,
        pixelData: true,
      },
    });

    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Decompress pixel data and compute yarn usage
    const compressed = Buffer.from(design.pixelData);
    const decompressed = pako.inflate(compressed, { to: "string" });
    const grid: (string | null)[][] = JSON.parse(decompressed);

    const stitchCounts = countStitchesByColor(grid);
    const meshCount = design.meshCount as 14 | 18;
    const stitchType = design.stitchType as "continental" | "basketweave";
    const yarnUsage = calculateYarnUsage(
      stitchCounts,
      meshCount,
      stitchType,
      design.bufferPercent
    );

    const threadSize = meshCount === 14 ? 5 : 8;

    // Atomic transaction: create sale + deduct inventory
    const sale = await prisma.$transaction(async (tx) => {
      // Create the kit sale with items
      const kitSale = await tx.kitSale.create({
        data: {
          designId: design.id,
          note: note || null,
          items: {
            create: yarnUsage.map((usage) => ({
              dmcNumber: usage.dmcNumber,
              skeins: usage.skeinsNeeded,
            })),
          },
        },
        include: {
          items: true,
          design: { select: { name: true } },
        },
      });

      // Deduct inventory for each color
      for (const usage of yarnUsage) {
        await tx.inventoryItem.upsert({
          where: {
            dmcNumber_size: {
              dmcNumber: usage.dmcNumber,
              size: threadSize,
            },
          },
          update: {
            skeins: { decrement: usage.skeinsNeeded },
          },
          create: {
            dmcNumber: usage.dmcNumber,
            size: threadSize,
            skeins: -usage.skeinsNeeded,
          },
        });
      }

      // Increment kitsReady on the design
      await tx.design.update({
        where: { id: design.id },
        data: { kitsReady: { increment: 1 } },
      });

      return kitSale;
    });

    return NextResponse.json(sale, { status: 201 });
  } catch (error) {
    console.error("Error recording kit sale:", error);
    return NextResponse.json(
      { error: "Failed to record kit sale" },
      { status: 500 }
    );
  }
}

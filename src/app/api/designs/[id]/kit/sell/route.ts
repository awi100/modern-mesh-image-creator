import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage } from "@/lib/yarn-calculator";
import pako from "pako";

const SKEIN_YARDS = 27;
const BOBBIN_ONLY_MAX = 5; // If ≤ this many yards, it's bobbin-only

// POST - Record a kit assembly and deduct inventory
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
    const { note, quantity = 1 } = body;

    // Validate quantity
    const qty = Math.max(1, Math.min(100, Math.floor(quantity)));

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

    // Calculate actual skeins to deduct for each color
    // For bobbin-only colors: accumulate yards across all kits, then calculate skeins
    // For full-skein colors: multiply skeins by quantity
    const itemsToCreate: { dmcNumber: string; skeins: number }[] = [];

    for (const usage of yarnUsage) {
      const yardsWithBuffer = usage.withBuffer;
      const isBobbin = yardsWithBuffer <= BOBBIN_ONLY_MAX;

      let skeinsToDeduct: number;
      if (isBobbin) {
        // Bobbin-only: accumulate yards across kits
        const totalBobbinYards = yardsWithBuffer * qty;
        skeinsToDeduct = Math.ceil(totalBobbinYards / SKEIN_YARDS);
      } else {
        // Full skeins: multiply by quantity
        skeinsToDeduct = usage.skeinsNeeded * qty;
      }

      itemsToCreate.push({
        dmcNumber: usage.dmcNumber,
        skeins: skeinsToDeduct,
      });
    }

    // Atomic transaction: create sale + deduct inventory
    const sale = await prisma.$transaction(async (tx) => {
      // Create the kit sale with items
      const kitSale = await tx.kitSale.create({
        data: {
          designId: design.id,
          quantity: qty,
          note: note || null,
          items: {
            create: itemsToCreate,
          },
        },
        include: {
          items: true,
          design: { select: { name: true } },
        },
      });

      // Deduct inventory for each color
      for (const item of itemsToCreate) {
        await tx.inventoryItem.upsert({
          where: {
            dmcNumber_size: {
              dmcNumber: item.dmcNumber,
              size: threadSize,
            },
          },
          update: {
            skeins: { decrement: item.skeins },
          },
          create: {
            dmcNumber: item.dmcNumber,
            size: threadSize,
            skeins: -item.skeins,
          },
        });
      }

      // Increment kitsReady by quantity
      await tx.design.update({
        where: { id: design.id },
        data: { kitsReady: { increment: qty } },
      });

      return kitSale;
    });

    return NextResponse.json(sale, { status: 201 });
  } catch (error) {
    console.error("Error recording kit assembly:", error);
    return NextResponse.json(
      { error: "Failed to record kit assembly" },
      { status: 500 }
    );
  }
}

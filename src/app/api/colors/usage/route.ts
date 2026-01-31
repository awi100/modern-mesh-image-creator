import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

interface ColorUsage {
  dmcNumber: string;
  designs: {
    id: string;
    name: string;
    previewImageUrl: string | null;
    meshCount: number;
  }[];
}

// GET - Fetch which designs use each color
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all non-draft designs with their colors
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
      },
      orderBy: { name: "asc" },
    });

    // Build a map of DMC number -> designs using it
    const colorUsageMap = new Map<string, ColorUsage["designs"]>();

    for (const design of designs) {
      if (!design.colorsUsed) continue;

      try {
        const colors: string[] = JSON.parse(design.colorsUsed);
        for (const dmcNumber of colors) {
          if (!colorUsageMap.has(dmcNumber)) {
            colorUsageMap.set(dmcNumber, []);
          }
          colorUsageMap.get(dmcNumber)!.push({
            id: design.id,
            name: design.name,
            previewImageUrl: design.previewImageUrl,
            meshCount: design.meshCount,
          });
        }
      } catch {
        // Skip designs with invalid colorsUsed
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

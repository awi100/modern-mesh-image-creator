import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId");
    const tagId = searchParams.get("tagId");
    const search = searchParams.get("search");

    const where: Record<string, unknown> = {};

    if (folderId === "null") {
      where.folderId = null;
    } else if (folderId) {
      where.folderId = folderId;
    }

    if (tagId) {
      where.tags = { some: { tagId } };
    }

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const designs = await prisma.design.findMany({
      where,
      include: {
        folder: true,
        tags: {
          include: {
            tag: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Transform tags
    const result = designs.map((design) => ({
      ...design,
      pixelData: undefined, // Don't send pixel data in list
      tags: design.tags.map((dt) => dt.tag),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching designs:", error);
    return NextResponse.json(
      { error: "Failed to fetch designs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const {
      name,
      widthInches,
      heightInches,
      meshCount,
      gridWidth,
      gridHeight,
      pixelData,
      stitchType,
      bufferPercent,
      referenceImageUrl,
      referenceImageOpacity,
      folderId,
      tagIds,
    } = body;

    // Convert base64 to Buffer
    const pixelDataBuffer = Buffer.from(pixelData, "base64");

    const design = await prisma.design.create({
      data: {
        name,
        widthInches,
        heightInches,
        meshCount,
        gridWidth,
        gridHeight,
        pixelData: pixelDataBuffer,
        stitchType: stitchType || "continental",
        bufferPercent: bufferPercent || 15,
        referenceImageUrl,
        referenceImageOpacity: referenceImageOpacity || 0.5,
        folderId,
        tags: tagIds
          ? {
              create: tagIds.map((tagId: string) => ({ tagId })),
            }
          : undefined,
      },
      include: {
        folder: true,
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    return NextResponse.json({
      ...design,
      pixelData: undefined,
      tags: design.tags.map((dt) => dt.tag),
    });
  } catch (error) {
    console.error("Error creating design:", error);
    return NextResponse.json(
      { error: "Failed to create design" },
      { status: 500 }
    );
  }
}

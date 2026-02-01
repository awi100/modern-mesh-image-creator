import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

interface BatchRequest {
  designIds: string[];
  action: "move" | "addTags" | "removeTags" | "delete";
  payload?: {
    folderId?: string | null;
    tagIds?: string[];
  };
}

// PATCH /api/designs/batch - Perform batch operations on multiple designs
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: BatchRequest = await request.json();
    const { designIds, action, payload } = body;

    if (!designIds || !Array.isArray(designIds) || designIds.length === 0) {
      return NextResponse.json(
        { error: "designIds array is required" },
        { status: 400 }
      );
    }

    if (designIds.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 designs per batch operation" },
        { status: 400 }
      );
    }

    let result: { success: boolean; count: number };

    switch (action) {
      case "move": {
        // Move designs to a folder (null = unfiled)
        const folderId = payload?.folderId ?? null;

        const updateResult = await prisma.design.updateMany({
          where: { id: { in: designIds } },
          data: { folderId },
        });

        result = { success: true, count: updateResult.count };
        break;
      }

      case "addTags": {
        // Add tags to designs
        const tagIds = payload?.tagIds;
        if (!tagIds || tagIds.length === 0) {
          return NextResponse.json(
            { error: "tagIds required for addTags action" },
            { status: 400 }
          );
        }

        // Create DesignTag records for each design-tag combination
        // Use skipDuplicates to avoid errors if tag already assigned
        const records = designIds.flatMap((designId) =>
          tagIds.map((tagId) => ({ designId, tagId }))
        );

        await prisma.designTag.createMany({
          data: records,
          skipDuplicates: true,
        });

        result = { success: true, count: designIds.length };
        break;
      }

      case "removeTags": {
        // Remove tags from designs
        const tagIds = payload?.tagIds;
        if (!tagIds || tagIds.length === 0) {
          return NextResponse.json(
            { error: "tagIds required for removeTags action" },
            { status: 400 }
          );
        }

        const deleteResult = await prisma.designTag.deleteMany({
          where: {
            designId: { in: designIds },
            tagId: { in: tagIds },
          },
        });

        result = { success: true, count: deleteResult.count };
        break;
      }

      case "delete": {
        // Soft delete designs (move to trash)
        const updateResult = await prisma.design.updateMany({
          where: { id: { in: designIds } },
          data: { deletedAt: new Date() },
        });

        result = { success: true, count: updateResult.count };
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[PATCH /api/designs/batch] Error:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Batch operation failed" },
      { status: 500 }
    );
  }
}

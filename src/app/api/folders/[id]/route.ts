import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Get the folder to find its parentId
    const folder = await prisma.folder.findUnique({
      where: { id },
      select: { parentId: true },
    });

    // Move child folders up to this folder's parent (or root)
    await prisma.folder.updateMany({
      where: { parentId: id },
      data: { parentId: folder?.parentId ?? null },
    });

    // Move all designs in this folder to unfiled
    await prisma.design.updateMany({
      where: { folderId: id },
      data: { folderId: null },
    });

    // Delete the folder
    await prisma.folder.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json(
      { error: "Failed to delete folder" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();

    const data: { name?: string; parentId?: string | null } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.parentId !== undefined) data.parentId = body.parentId;

    // Prevent cycles: a folder cannot be its own parent, nor be moved into one
    // of its own descendants. A cycle would make the recursive folder-tree
    // renderer loop forever and crash the home page.
    if (data.parentId) {
      if (data.parentId === id) {
        return NextResponse.json({ error: "A folder cannot be its own parent" }, { status: 400 });
      }
      const seen = new Set<string>();
      let cursor: string | null = data.parentId;
      while (cursor) {
        if (cursor === id) {
          return NextResponse.json({ error: "Cannot move a folder into its own descendant" }, { status: 400 });
        }
        if (seen.has(cursor)) break; // pre-existing cycle elsewhere; don't loop
        seen.add(cursor);
        const parent: { parentId: string | null } | null = await prisma.folder.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = parent?.parentId ?? null;
      }
    }

    const folder = await prisma.folder.update({
      where: { id },
      data,
    });

    return NextResponse.json(folder);
  } catch (error) {
    console.error("Error updating folder:", error);
    return NextResponse.json(
      { error: "Failed to update folder" },
      { status: 500 }
    );
  }
}

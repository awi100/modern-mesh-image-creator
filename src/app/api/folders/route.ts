import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const folders = await prisma.folder.findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json(folders);
  } catch (error) {
    console.error("Error fetching folders:", error);
    return NextResponse.json(
      { error: "Failed to fetch folders" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, parentId } = await request.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    // Validate the parent exists so we don't create an orphan folder that
    // never renders (root filter is !parentId).
    if (parentId) {
      const parent = await prisma.folder.findUnique({ where: { id: parentId }, select: { id: true } });
      if (!parent) {
        return NextResponse.json({ error: "Parent folder not found" }, { status: 400 });
      }
    }

    const folder = await prisma.folder.create({
      data: {
        name: name.trim(),
        parentId: parentId ?? null,
      },
    });

    return NextResponse.json(folder);
  } catch (error) {
    console.error("Error creating folder:", error);
    return NextResponse.json(
      { error: "Failed to create folder" },
      { status: 500 }
    );
  }
}

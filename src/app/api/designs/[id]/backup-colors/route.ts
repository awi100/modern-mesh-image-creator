import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// PUT - Update backup colors for a design
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { backupColors } = body;

    // Validate that backupColors is an object
    if (typeof backupColors !== "object" || backupColors === null) {
      return NextResponse.json(
        { error: "backupColors must be an object" },
        { status: 400 }
      );
    }

    // Filter out any empty values
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(backupColors)) {
      if (value && typeof value === "string" && value.trim()) {
        filtered[key] = value.trim();
      }
    }

    const design = await prisma.design.update({
      where: { id },
      data: {
        backupColors: JSON.stringify(filtered),
      },
      select: {
        id: true,
        backupColors: true,
      },
    });

    return NextResponse.json({
      success: true,
      backupColors: design.backupColors ? JSON.parse(design.backupColors) : {},
    });
  } catch (error) {
    console.error("Error updating backup colors:", error);
    return NextResponse.json(
      { error: "Failed to update backup colors" },
      { status: 500 }
    );
  }
}

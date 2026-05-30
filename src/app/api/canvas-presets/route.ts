import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET - List all canvas presets
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const presets = await prisma.canvasPreset.findMany({
      orderBy: [
        { sortOrder: "asc" },
        { name: "asc" },
      ],
    });

    return NextResponse.json(presets);
  } catch (error) {
    console.error("Error fetching canvas presets:", error);
    return NextResponse.json(
      { error: "Failed to fetch presets" },
      { status: 500 }
    );
  }
}

// POST - Create a new canvas preset
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, widthInches, heightInches, description } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const width = Number(widthInches);
    const height = Number(heightInches);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return NextResponse.json(
        { error: "widthInches and heightInches must be positive numbers" },
        { status: 400 }
      );
    }

    // Get the max sortOrder to add new preset at the end
    const maxOrder = await prisma.canvasPreset.aggregate({
      _max: { sortOrder: true },
    });

    const preset = await prisma.canvasPreset.create({
      data: {
        name: name.trim(),
        widthInches: width,
        heightInches: height,
        description: typeof description === "string" ? description : null,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    });

    return NextResponse.json(preset, { status: 201 });
  } catch (error) {
    console.error("Error creating canvas preset:", error);
    return NextResponse.json(
      { error: "Failed to create preset" },
      { status: 500 }
    );
  }
}

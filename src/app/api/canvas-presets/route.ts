import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET - List all canvas presets
export async function GET() {
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
  try {
    const body = await request.json();
    const { name, widthInches, heightInches, description } = body;

    if (!name || !widthInches || !heightInches) {
      return NextResponse.json(
        { error: "Name, width, and height are required" },
        { status: 400 }
      );
    }

    // Get the max sortOrder to add new preset at the end
    const maxOrder = await prisma.canvasPreset.aggregate({
      _max: { sortOrder: true },
    });

    const preset = await prisma.canvasPreset.create({
      data: {
        name,
        widthInches: Number(widthInches),
        heightInches: Number(heightInches),
        description: description || null,
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

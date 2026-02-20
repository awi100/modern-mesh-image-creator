import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET - Fetch all supplies
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supplies = await prisma.supply.findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json(supplies);
  } catch (error) {
    console.error("Error fetching supplies:", error);
    return NextResponse.json(
      { error: "Failed to fetch supplies" },
      { status: 500 }
    );
  }
}

// POST - Create a new supply
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, sku, description, imageUrl, quantity = 0 } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const supply = await prisma.supply.create({
      data: {
        name: name.trim(),
        sku: sku?.trim() || null,
        description: description?.trim() || null,
        imageUrl: imageUrl?.trim() || null,
        quantity: Math.max(0, Math.floor(quantity)),
      },
    });

    return NextResponse.json(supply, { status: 201 });
  } catch (error) {
    console.error("Error creating supply:", error);

    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A supply with this name already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create supply" },
      { status: 500 }
    );
  }
}

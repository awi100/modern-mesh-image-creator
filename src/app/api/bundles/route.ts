import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

interface ComponentInput {
  supplyId?: string | null;
  quantity?: number;
  chooseFrom?: string | null;
}

// Normalize + validate component rows: each is either a fixed supply or a
// customer-choice slot (chooseFrom = a Supply-name filter, e.g. "Needle Minder").
function normalizeComponents(components: unknown): { quantity: number; supplyId: string | null; chooseFrom: string | null; sortOrder: number }[] | null {
  if (!Array.isArray(components)) return null;
  const out: { quantity: number; supplyId: string | null; chooseFrom: string | null; sortOrder: number }[] = [];
  components.forEach((raw, i) => {
    const c = raw as ComponentInput;
    const quantity = Number(c.quantity);
    const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
    const chooseFrom = typeof c.chooseFrom === "string" && c.chooseFrom.trim() ? c.chooseFrom.trim() : null;
    const supplyId = !chooseFrom && typeof c.supplyId === "string" && c.supplyId ? c.supplyId : null;
    // A component must be either a fixed supply or a choice slot.
    if (!chooseFrom && !supplyId) return;
    out.push({ quantity: qty, supplyId, chooseFrom, sortOrder: i });
  });
  return out;
}

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const bundles = await prisma.bundle.findMany({
      orderBy: { title: "asc" },
      include: {
        components: {
          orderBy: { sortOrder: "asc" },
          include: { supply: { select: { id: true, name: true } } },
        },
      },
    });
    return NextResponse.json(bundles);
  } catch (error) {
    console.error("Error fetching bundles:", error);
    return NextResponse.json({ error: "Failed to fetch bundles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "title is required (must match the Shopify product title)" }, { status: 400 });
    const components = normalizeComponents(body.components ?? []);
    if (components === null) return NextResponse.json({ error: "components must be an array" }, { status: 400 });

    const bundle = await prisma.bundle.create({
      data: {
        title,
        label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null,
        active: body.active === undefined ? true : !!body.active,
        components: { create: components },
      },
      include: { components: { include: { supply: { select: { id: true, name: true } } } } },
    });
    return NextResponse.json(bundle, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A bundle with that title already exists" }, { status: 409 });
    }
    console.error("Error creating bundle:", error);
    return NextResponse.json({ error: "Failed to create bundle" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const data: { title?: string; label?: string | null; active?: boolean } = {};
    if (typeof body.title === "string") {
      if (!body.title.trim()) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      data.title = body.title.trim();
    }
    if (body.label !== undefined) data.label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
    if (body.active !== undefined) data.active = !!body.active;

    // If components are provided, replace them wholesale (delete + recreate).
    let components: ReturnType<typeof normalizeComponents> = null;
    if (body.components !== undefined) {
      components = normalizeComponents(body.components);
      if (components === null) return NextResponse.json({ error: "components must be an array" }, { status: 400 });
    }

    const bundle = await prisma.$transaction(async (tx) => {
      await tx.bundle.update({ where: { id: body.id }, data });
      if (components !== null) {
        await tx.bundleComponent.deleteMany({ where: { bundleId: body.id } });
        if (components.length > 0) {
          await tx.bundleComponent.createMany({ data: components.map((c) => ({ ...c, bundleId: body.id })) });
        }
      }
      return tx.bundle.findUnique({
        where: { id: body.id },
        include: { components: { orderBy: { sortOrder: "asc" }, include: { supply: { select: { id: true, name: true } } } } },
      });
    });
    return NextResponse.json(bundle);
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A bundle with that title already exists" }, { status: 409 });
    }
    console.error("Error updating bundle:", error);
    return NextResponse.json({ error: "Failed to update bundle" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await prisma.bundle.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting bundle:", error);
    return NextResponse.json({ error: "Failed to delete bundle" }, { status: 500 });
  }
}

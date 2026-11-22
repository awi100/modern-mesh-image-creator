/**
 * The line-item titles marked "not a physical item" from the Orders page.
 *
 * Adding one takes a product title off the picking list for good: it stops
 * counting as a canvas, stops appearing in the unmatched warning, and moves to
 * the Other tab. That is the right answer for a private class and a disaster
 * for a real design, so the write paths here are deliberately strict about
 * what they accept — a blank title would prefix-match everything and silently
 * empty the picking list.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { isBuiltInOtherTitle, OTHER_ITEM_TITLES } from "@/lib/other-items";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const stored = await prisma.otherItemTitle.findMany({ orderBy: { title: "asc" } });
    return NextResponse.json({ stored, builtIn: OTHER_ITEM_TITLES });
  } catch (error) {
    console.error("Error fetching other-item titles:", error);
    return NextResponse.json({ error: "Failed to fetch titles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

    // Empty is the dangerous one: it prefix-matches every line item.
    if (!title) {
      return NextResponse.json({ error: "A title is required" }, { status: 400 });
    }
    if (isBuiltInOtherTitle(title)) {
      return NextResponse.json({ error: `"${title}" is already built in` }, { status: 409 });
    }

    const existing = await prisma.otherItemTitle.findFirst({
      where: { title: { equals: title, mode: "insensitive" } },
    });
    if (existing) {
      return NextResponse.json({ error: `"${title}" is already listed`, item: existing }, { status: 409 });
    }

    const item = await prisma.otherItemTitle.create({ data: { title, note } });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error("Error adding other-item title:", error);
    return NextResponse.json({ error: "Failed to add title" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // Removing one puts the title back in the unmatched warning, which is the
    // visible state — nothing is lost by undoing a mistake here.
    await prisma.otherItemTitle.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error removing other-item title:", error);
    return NextResponse.json({ error: "Failed to remove title" }, { status: 500 });
  }
}

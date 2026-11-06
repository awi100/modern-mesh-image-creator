import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { parseOverrides, diffOverrides, recordRevision, type RevisionSource } from "@/lib/print-colors";

const SOURCES: RevisionSource[] = ["baseline", "print", "manual", "restore"];

/** GET — the current print colours plus every revision, newest first. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const design = await prisma.design.findUnique({
    where: { id },
    select: { id: true, name: true, printColorOverrides: true, printVersionOf: true },
  });
  if (!design) return NextResponse.json({ error: "Design not found" }, { status: 404 });

  const revisions = await prisma.printColorRevision.findMany({
    where: { designId: id },
    orderBy: { createdAt: "desc" },
  });

  // Each entry carries the change from the one BEFORE it, so the list reads as
  // "what this run altered" rather than a wall of unchanged hexes.
  const withDiff = revisions.map((r, i) => {
    const prev = revisions[i + 1];
    return {
      id: r.id,
      overrides: parseOverrides(r.overrides),
      source: r.source,
      note: r.note,
      createdAt: r.createdAt,
      changed: prev ? diffOverrides(parseOverrides(prev.overrides), parseOverrides(r.overrides)) : [],
    };
  });

  const current = parseOverrides(design.printColorOverrides);
  const latest = revisions[0] ? parseOverrides(revisions[0].overrides) : null;

  return NextResponse.json({
    designId: design.id,
    current,
    // True when the colours have moved since the last snapshot — the page uses
    // it to offer "save this as a run" rather than leaving it to be guessed.
    unsavedChanges: latest ? diffOverrides(latest, current).length > 0 : Object.keys(current).length > 0,
    revisions: withDiff,
  });
}

/**
 * POST — snapshot the current colours, or restore an earlier revision.
 *
 * Body: { note?, source? }        snapshot what is set now
 *       { restoreId, note? }      bring an old revision back
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const design = await prisma.design.findUnique({
    where: { id },
    select: { printColorOverrides: true },
  });
  if (!design) return NextResponse.json({ error: "Design not found" }, { status: 404 });

  if (body.restoreId) {
    const target = await prisma.printColorRevision.findFirst({
      where: { id: String(body.restoreId), designId: id },
    });
    if (!target) return NextResponse.json({ error: "Revision not found" }, { status: 404 });

    const overrides = parseOverrides(target.overrides);
    const result = await prisma.$transaction(async (tx) => {
      // The restore is written forward as its own revision rather than by
      // deleting what came after. What was actually sent to a printer stays on
      // the record even once it is superseded.
      await tx.design.update({
        where: { id },
        data: { printColorOverrides: JSON.stringify(overrides) },
      });
      return recordRevision(tx, id, overrides, "restore",
        note ?? `Restored the colours from ${target.createdAt.toISOString().slice(0, 10)}`);
    });
    return NextResponse.json({ restored: true, overrides, revision: result });
  }

  const source: RevisionSource = SOURCES.includes(body.source) ? body.source : "manual";
  const overrides = parseOverrides(design.printColorOverrides);
  const revision = await recordRevision(prisma, id, overrides, source, note);

  return NextResponse.json({
    // null means the colours are identical to the newest revision, so nothing
    // was recorded — saying so beats a history full of duplicates.
    revision,
    unchanged: revision === null,
  });
}

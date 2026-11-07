import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { normaliseAnswer, isMasked } from "@/lib/ticket-tailor/parse";
import { reresolveTickets } from "@/lib/ticket-tailor/sync";

export const dynamic = "force-dynamic";

/** GET — every mapping, with how many tickets gave that answer. */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [mappings, tickets] = await Promise.all([
    prisma.ticketTailorCanvasMapping.findMany({
      include: { design: { select: { id: true, name: true, meshCount: true, archivedAt: true } } },
      orderBy: { answerText: "asc" },
    }),
    prisma.ticketTailorTicket.groupBy({ by: ["answerKey"], _count: true }),
  ]);
  const counts = new Map(tickets.map((t) => [t.answerKey ?? "", t._count]));

  return NextResponse.json(mappings.map((m) => ({
    id: m.id,
    answerKey: m.answerKey,
    answerText: m.answerText,
    designId: m.designId,
    design: m.design,
    needsKit: m.needsKit,
    note: m.note,
    tickets: counts.get(m.answerKey) ?? 0,
  })));
}

/**
 * POST — map an answer to a design, or mark it as not a canvas.
 *
 * Body: { answer, designId: string | null, needsKit?, note? }
 *   designId null means "this answer is not a canvas, ignore it" — different
 *   from having no mapping at all, which means "not decided yet".
 *
 * Every ticket that ever gave this answer is re-resolved afterwards, so one
 * mapping fixes the past as well as the future. That is the whole reason the
 * mapping is a table and not a field on the ticket.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));

  const answerText = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!answerText) return NextResponse.json({ error: "answer is required" }, { status: 400 });
  // A masked answer is a key-permission failure. Mapping it would create one
  // row that silently absorbs every ticket on every event.
  if (isMasked(answerText)) {
    return NextResponse.json(
      { error: 'That answer is hidden ("****") because the Ticket Tailor API key cannot read customer data. Reissue the key with that access and sync again — do not map it.' },
      { status: 400 },
    );
  }
  const answerKey = normaliseAnswer(answerText);

  const designId = body.designId === null || body.designId === "" ? null
    : typeof body.designId === "string" ? body.designId : undefined;
  if (designId === undefined) {
    return NextResponse.json({ error: "designId must be a design id, or null for 'not a canvas'" }, { status: 400 });
  }
  if (designId) {
    const design = await prisma.design.findFirst({ where: { id: designId, deletedAt: null }, select: { id: true } });
    if (!design) return NextResponse.json({ error: "No such design" }, { status: 400 });
  }

  const needsKit = typeof body.needsKit === "boolean" ? body.needsKit : true;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const mapping = await prisma.ticketTailorCanvasMapping.upsert({
    where: { answerKey },
    update: { answerText, designId, needsKit, note },
    create: { answerKey, answerText, designId, needsKit, note },
  });

  const { updated } = await reresolveTickets();

  return NextResponse.json({ mapping, ticketsReresolved: updated });
}

/** DELETE — remove a mapping, putting its answers back to unmapped. */
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await prisma.ticketTailorCanvasMapping.delete({ where: { id } }).catch(() => null);
  const { updated } = await reresolveTickets();
  return NextResponse.json({ deleted: true, ticketsReresolved: updated });
}

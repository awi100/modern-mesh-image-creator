/**
 * Propose a design for every canvas answer seen on a Ticket Tailor ticket.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/seed-tt-canvas-mappings.ts          # dry run
 *   npx tsx --tsconfig tsconfig.json scripts/seed-tt-canvas-mappings.ts --write
 *   npx tsx --tsconfig tsconfig.json scripts/seed-tt-canvas-mappings.ts --undo --write
 *
 * Two rules, in order:
 *
 *   1. EXACT, after lowercasing and collapsing whitespace. This covers 219 of
 *      226 answered tickets, and is the only rule that can be trusted blindly.
 *   2. NEAREST name by `distance()` from unmatched-sales.ts, within
 *      SUGGESTION_LIMIT — and only over NON-ARCHIVED designs. That restriction
 *      is load-bearing: "Comm Ave Street Sign"'s nearest match overall is
 *      "Comm Ave Street Sign (14ct)", a retired 14ct design, which would map a
 *      live pick onto stock that no longer exists.
 *
 * Answers span 13ct intro kits and 18ct canvases alike, so nothing here filters
 * on meshCount. Picks seen so far are 85% ordinary 18ct canvases and 15% intro
 * kits.
 *
 * Nothing is written without --write, and a fuzzy proposal is never written at
 * all — those are printed for a person to decide, because getting one wrong
 * deducts the wrong design's stock.
 */

import { prisma } from "../src/lib/prisma";
import { distance, SUGGESTION_LIMIT } from "../src/lib/unmatched-sales";
import { normaliseAnswer, isMasked } from "../src/lib/ticket-tailor/parse";

/**
 * Answers confirmed by the owners that exact matching cannot reach.
 *
 * "Comm Ave Street Sign" has no match at all once archived designs are
 * excluded — and that exclusion is the point, since its nearest overall is the
 * retired "Comm Ave Street Sign (14ct)". "Newbury Street Sign" matches only
 * fuzzily. Both were checked by Andrew on 2026-11-07.
 */
const CONFIRMED: Record<string, string> = {
  "comm ave street sign": "Comm Ave",
  "newbury street sign": "Newbury Street",
};

const WRITE = process.argv.includes("--write");
const UNDO = process.argv.includes("--undo");
/** Write the fuzzy proposals too. Off by default on purpose. */
const INCLUDE_FUZZY = process.argv.includes("--include-fuzzy");

async function main() {
  if (UNDO) {
    const n = await prisma.ticketTailorCanvasMapping.count();
    console.log(`${n} mappings exist.`);
    if (!WRITE) { console.log("DRY RUN — add --write to delete them all."); return; }
    const gone = await prisma.ticketTailorCanvasMapping.deleteMany({});
    console.log(`deleted ${gone.count} mappings. Re-resolve tickets to see the effect.`);
    return;
  }

  // Every distinct answer seen, with how many tickets gave it.
  const tickets = await prisma.ticketTailorTicket.findMany({
    where: { canvasAnswer: { not: null } },
    select: { canvasAnswer: true, answerKey: true },
  });
  const counts = new Map<string, { text: string; n: number }>();
  for (const t of tickets) {
    const key = t.answerKey ?? normaliseAnswer(t.canvasAnswer);
    if (!key || isMasked(t.canvasAnswer)) continue;
    const e = counts.get(key) ?? { text: t.canvasAnswer!, n: 0 };
    e.n++;
    counts.set(key, e);
  }
  if (counts.size === 0) {
    console.log("No canvas answers stored yet — run the sync first.");
    return;
  }

  // Candidates: everything we could ship. Archived designs are excluded from
  // matching entirely, for the "Comm Ave Street Sign (14ct)" reason above.
  const designs = await prisma.design.findMany({
    where: { deletedAt: null, archivedAt: null, printVersionOf: null },
    select: { id: true, name: true, meshCount: true },
  });
  const byExact = new Map<string, typeof designs>();
  for (const d of designs) {
    const k = normaliseAnswer(d.name);
    byExact.set(k, [...(byExact.get(k) ?? []), d]);
  }

  const existing = new Map(
    (await prisma.ticketTailorCanvasMapping.findMany()).map((m) => [m.answerKey, m]),
  );

  type Row = {
    key: string; text: string; n: number;
    design: (typeof designs)[number] | null;
    how: "exact" | "confirmed" | "fuzzy" | "ambiguous" | "none" | "already mapped";
    score?: number;
  };
  const rows: Row[] = [];

  for (const [key, { text, n }] of counts) {
    if (existing.has(key)) {
      const m = existing.get(key)!;
      const d = designs.find((x) => x.id === m.designId) ?? null;
      rows.push({ key, text, n, design: d, how: "already mapped" });
      continue;
    }
    const confirmedName = CONFIRMED[key];
    if (confirmedName) {
      const d = designs.find((x) => normaliseAnswer(x.name) === normaliseAnswer(confirmedName)) ?? null;
      rows.push({ key, text, n, design: d, how: d ? "confirmed" : "none" });
      continue;
    }
    const exact = byExact.get(key);
    if (exact?.length === 1) { rows.push({ key, text, n, design: exact[0], how: "exact" }); continue; }
    if (exact && exact.length > 1) { rows.push({ key, text, n, design: null, how: "ambiguous" }); continue; }

    const best = designs
      .map((d) => ({ d, s: distance(key, normaliseAnswer(d.name)) }))
      .sort((a, b) => a.s - b.s)[0];
    if (best && best.s <= SUGGESTION_LIMIT) {
      rows.push({ key, text, n, design: best.d, how: "fuzzy", score: best.s });
    } else {
      rows.push({ key, text, n, design: null, how: "none", score: best?.s });
    }
  }

  rows.sort((a, b) => b.n - a.n || a.text.localeCompare(b.text));

  const label = (r: Row) =>
    r.design ? `${r.design.name} (${r.design.meshCount}ct)` : "—";

  console.log(`${counts.size} distinct answers across ${tickets.length} answered tickets\n`);
  console.log(`tickets  answer                           ->  design                                how`);
  for (const r of rows) {
    const how = r.how === "fuzzy" ? `fuzzy ${r.score!.toFixed(2)}  ** CHECK **`
      : r.how === "none" ? `no match (nearest ${r.score?.toFixed(2) ?? "?"})`
      : r.how;
    console.log(`${String(r.n).padStart(7)}  ${r.text.slice(0, 32).padEnd(33)} ->  ${label(r).slice(0, 36).padEnd(37)} ${how}`);
  }

  const exact = rows.filter((r) => r.how === "exact" || r.how === "confirmed");
  const fuzzy = rows.filter((r) => r.how === "fuzzy");
  const none = rows.filter((r) => r.how === "none" || r.how === "ambiguous");
  const already = rows.filter((r) => r.how === "already mapped");

  console.log(
    `\nexact ${exact.length} answers / ${exact.reduce((s, r) => s + r.n, 0)} tickets` +
    ` · fuzzy ${fuzzy.length} / ${fuzzy.reduce((s, r) => s + r.n, 0)}` +
    ` · unmatched ${none.length} / ${none.reduce((s, r) => s + r.n, 0)}` +
    ` · already mapped ${already.length}`,
  );

  if (fuzzy.length) {
    console.log(`\nThe fuzzy ones are NOT written, even with --write. Getting one wrong`);
    console.log(`deducts another design's stock. Confirm each, then re-run with --include-fuzzy,`);
    console.log(`or set them on the event page.`);
  }

  const toWrite = INCLUDE_FUZZY ? [...exact, ...fuzzy] : exact;
  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written. ${toWrite.length} mappings would be created.`);
    return;
  }

  let created = 0;
  for (const r of toWrite) {
    if (!r.design) continue;
    await prisma.ticketTailorCanvasMapping.create({
      data: {
        answerKey: r.key,
        answerText: r.text,
        designId: r.design.id,
        // Every sip-and-stitch canvas goes out kitted.
        needsKit: true,
        note:
          r.how === "confirmed" ? "Confirmed by the owners — the answer does not name the design"
          : r.how === "fuzzy" ? `Seeded by nearest name (distance ${r.score!.toFixed(2)}) — verify`
          : "Seeded by exact name match",
      },
    });
    created++;
  }
  console.log(`\nwrote ${created} mappings. Re-resolve tickets to apply them.`);
}

main().finally(() => prisma.$disconnect());

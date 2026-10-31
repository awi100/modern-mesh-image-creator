/**
 * Create a shared kit pool and move its members' kit stock into it.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/create-kit-group.ts          # dry run
 *   npx tsx --tsconfig tsconfig.json scripts/create-kit-group.ts --write
 *   npx tsx --tsconfig tsconfig.json scripts/create-kit-group.ts --undo
 *
 * The pool only works if one packed bag really does fit every member, so this
 * REFUSES to write unless the members' colour sets are identical. It also
 * reports the yardage spread, because a shared bag has to satisfy the hungriest
 * member and that is a judgement for a person, not a script.
 *
 * Member kit counts are summed into the pool and their own columns zeroed —
 * a move, not a loss. The originals are written into the group's notes so
 * --undo can put every one of them back exactly.
 */

import pako from "pako";
import { prisma } from "../src/lib/prisma";
import { calculateYarnUsage } from "../src/lib/yarn-calculator";

const WRITE = process.argv.includes("--write");
const UNDO = process.argv.includes("--undo");

const GROUP = {
  name: "Green Street Signs",
  members: ["Boylston Street", "Comm Ave", "Main Street", "Mass Ave", "Newbury Street"],
  notes: "All five take the same thread, so one packed bag fits any of them. Canvases stay per-design.",
};

async function main() {
  if (UNDO) {
    const g = await prisma.kitGroup.findUnique({ where: { name: GROUP.name }, include: { designs: { select: { id: true, name: true } } } });
    if (!g) { console.log("no such group"); return; }
    const saved: Record<string, { kitsReady: number; marketKitsReady: number; kitsAndover: number }> =
      JSON.parse((g.notes?.match(/<restore>([\s\S]*)<\/restore>/)?.[1]) ?? "{}");
    console.log(`pool holds ${g.kitsReady}/${g.marketKitsReady}/${g.kitsAndover} (home/tote/andover) across ${g.designs.length} designs`);
    console.log(`saved originals for ${Object.keys(saved).length} designs`);
    if (!WRITE) { console.log("\nDRY RUN — add --write to actually undo."); return; }
    await prisma.$transaction(async (tx) => {
      for (const d of g.designs) {
        const o = saved[d.id];
        await tx.design.update({
          where: { id: d.id },
          data: {
            kitGroupId: null,
            ...(o ? { kitsReady: o.kitsReady, marketKitsReady: o.marketKitsReady, kitsAndover: o.kitsAndover } : {}),
          },
        });
      }
      await tx.kitGroup.delete({ where: { id: g.id } });
    });
    console.log("restored every design's own kit counts and removed the pool");
    return;
  }

  const designs = await prisma.design.findMany({
    where: { name: { in: GROUP.members }, deletedAt: null, printVersionOf: null, archivedAt: null },
    select: { id: true, name: true, meshCount: true, stitchType: true, bufferPercent: true, pixelData: true,
      kitsReady: true, marketKitsReady: true, kitsAndover: true, kitGroupId: true },
  });

  const missing = GROUP.members.filter((m) => !designs.some((d) => d.name === m));
  if (missing.length) {
    console.log(`NOT FOUND: ${missing.join(", ")}`);
    return;
  }

  // Does one bag really fit all of them?
  const analysed = designs.map((d) => {
    const grid: (string | null)[][] = JSON.parse(pako.inflate(Buffer.from(d.pixelData), { to: "string" }));
    const counts = new Map<string, number>();
    for (const row of grid) for (const c of row) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    const usage = calculateYarnUsage(counts, d.meshCount as 18, d.stitchType as "continental", d.bufferPercent);
    return { d, usage, colours: [...counts.keys()].sort().join("+") };
  });

  const sets = new Set(analysed.map((a) => a.colours));
  console.log(`${GROUP.name}: ${designs.length} designs\n`);
  for (const a of analysed) {
    const parts = a.usage.map((u) => `${u.dmcNumber} ${u.withBuffer.toFixed(1)}yd/${u.skeinsNeeded}sk`).join("  ");
    console.log(`  ${a.d.name.padEnd(17)} ${parts}`);
  }

  if (sets.size !== 1) {
    console.log(`\nREFUSING: members do not share a colour set — ${[...sets].join("  VS  ")}`);
    console.log(`A pooled bag would be short of a colour for whichever design needs it.`);
    return;
  }
  console.log(`\ncolour set matches across all ${designs.length}: ${[...sets][0].split("+").join(", ")}`);

  const colours = [...sets][0].split("+");
  const contents = colours.map((c) => {
    const maxYd = Math.max(...analysed.map((a) => a.usage.find((u) => u.dmcNumber === c)?.withBuffer ?? 0));
    const maxSk = Math.max(...analysed.map((a) => a.usage.find((u) => u.dmcNumber === c)?.skeinsNeeded ?? 0));
    const full = analysed.some((a) => a.usage.find((u) => u.dmcNumber === c)?.usesFullSkein);
    return full ? `${maxSk} x ${c} skein${maxSk > 1 ? "s" : ""}` : `1 x ${c} bobbin (${Math.ceil(maxYd)}yd)`;
  }).join(", ");
  console.log(`one bag = ${contents}`);
  console.log(`  (sized to the hungriest member; the spread is ${colours.map((c) => {
    const ys = analysed.map((a) => a.usage.find((u) => u.dmcNumber === c)?.withBuffer ?? 0);
    return `${c} ${Math.min(...ys).toFixed(1)}-${Math.max(...ys).toFixed(1)}yd`;
  }).join(", ")})`);

  const pool = {
    kitsReady: analysed.reduce((s, a) => s + a.d.kitsReady, 0),
    marketKitsReady: analysed.reduce((s, a) => s + a.d.marketKitsReady, 0),
    kitsAndover: analysed.reduce((s, a) => s + a.d.kitsAndover, 0),
  };
  console.log(`\nkits moving into the pool:`);
  for (const a of analysed)
    console.log(`  ${a.d.name.padEnd(17)} home ${a.d.kitsReady}  tote ${a.d.marketKitsReady}  andover ${a.d.kitsAndover}`);
  console.log(`  ${"POOL".padEnd(17)} home ${pool.kitsReady}  tote ${pool.marketKitsReady}  andover ${pool.kitsAndover}`);

  const already = analysed.filter((a) => a.d.kitGroupId);
  if (already.length) console.log(`\nalready grouped: ${already.map((a) => a.d.name).join(", ")}`);

  if (!WRITE) { console.log(`\nDRY RUN — nothing written. Re-run with --write.`); return; }

  const restore = Object.fromEntries(analysed.map((a) => [a.d.id, {
    kitsReady: a.d.kitsReady, marketKitsReady: a.d.marketKitsReady, kitsAndover: a.d.kitsAndover,
  }]));

  await prisma.$transaction(async (tx) => {
    const g = await tx.kitGroup.upsert({
      where: { name: GROUP.name },
      update: { ...pool, contents, notes: `${GROUP.notes} <restore>${JSON.stringify(restore)}</restore>` },
      create: { name: GROUP.name, ...pool, contents, notes: `${GROUP.notes} <restore>${JSON.stringify(restore)}</restore>` },
    });
    // Members' own columns go to 0: the pool is the stock now, and a zero makes
    // any read that has not been taught about pools obviously wrong rather than
    // quietly stale.
    await tx.design.updateMany({
      where: { id: { in: analysed.map((a) => a.d.id) } },
      data: { kitGroupId: g.id, kitsReady: 0, marketKitsReady: 0, kitsAndover: 0 },
    });
  });

  console.log(`\nwrote the pool: ${pool.kitsReady} home, ${pool.marketKitsReady} tote, ${pool.kitsAndover} andover`);
  console.log(`members' own kit columns zeroed; originals saved for --undo`);
}

main().finally(() => prisma.$disconnect());

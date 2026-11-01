/**
 * Create the shared kit pools and move their members' kit stock in.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/create-kit-group.ts          # dry run
 *   npx tsx --tsconfig tsconfig.json scripts/create-kit-group.ts --write
 *   npx tsx --tsconfig tsconfig.json scripts/create-kit-group.ts --undo --write
 *
 * A pool is only sound if one packed bag really does fit every member, so this
 * checks two things and refuses to write unless both hold:
 *
 *   1. identical colour sets — otherwise a bag is short of a colour for
 *      whichever design needs it;
 *   2. identical WHOLE-SKEIN counts per colour, measured on raw yardage. This
 *      is the check that matters, and its absence is what put all five street
 *      signs in one pool to begin with: the yarn calculator rounds the buffered
 *      figure up, which reported 2 skeins of 909 for every sign, while on raw
 *      yardage three of them fit inside a single 27-yard skein and two did not.
 *
 * Member kit counts are summed into their pool and their own columns zeroed —
 * a move, not a loss. The originals go into the pool's notes so --undo puts
 * every one of them back exactly, which is also how a re-split redistributes
 * them: undo, then create the new pools, and each design's own counts land in
 * whichever pool now holds it.
 */

import pako from "pako";
import { prisma } from "../src/lib/prisma";
import { calculateYarnUsage } from "../src/lib/yarn-calculator";
import { skeinYardsForMesh } from "../src/lib/yarn-calculator";

const WRITE = process.argv.includes("--write");
const UNDO = process.argv.includes("--undo");

const GROUPS = [
  {
    name: "Street Sign - Small",
    members: ["Comm Ave", "Mass Ave", "Main Street"],
    notes: "Green street signs whose 909 fits one skein. Canvases stay per-design.",
  },
  {
    name: "Street Sign - Large",
    members: ["Boylston Street", "Newbury Street"],
    notes: "Taller green street signs; the 909 needs two skeins. Canvases stay per-design.",
  },
];

/** Every pool this script manages, so --undo clears old shapes too. */
const MANAGED = [...GROUPS.map((g) => g.name), "Green Street Signs"];

async function undo() {
  const groups = await prisma.kitGroup.findMany({
    where: { name: { in: MANAGED } },
    include: { designs: { select: { id: true, name: true } } },
  });
  if (!groups.length) { console.log("no managed pools to undo"); return; }
  for (const g of groups)
    console.log(`${g.name}: ${g.kitsReady}/${g.marketKitsReady}/${g.kitsAndover} across ${g.designs.length} designs`);
  if (!WRITE) { console.log("\nDRY RUN — add --write to actually undo."); return; }

  await prisma.$transaction(async (tx) => {
    for (const g of groups) {
      const saved: Record<string, { kitsReady: number; marketKitsReady: number; kitsAndover: number }> =
        JSON.parse(g.notes?.match(/<restore>([\s\S]*)<\/restore>/)?.[1] ?? "{}");
      for (const d of g.designs) {
        const o = saved[d.id];
        await tx.design.update({
          where: { id: d.id },
          data: { kitGroupId: null, ...(o ?? {}) },
        });
      }
      await tx.kitGroup.delete({ where: { id: g.id } });
    }
  });
  console.log(`\nrestored every design's own kit counts and removed ${groups.length} pool(s)`);
}

async function main() {
  if (UNDO) return undo();

  const wanted = GROUPS.flatMap((g) => g.members);
  const designs = await prisma.design.findMany({
    where: { name: { in: wanted }, deletedAt: null, printVersionOf: null, archivedAt: null },
    select: { id: true, name: true, meshCount: true, stitchType: true, bufferPercent: true, pixelData: true,
      kitsReady: true, marketKitsReady: true, kitsAndover: true, kitGroupId: true },
  });
  const missing = wanted.filter((m) => !designs.some((d) => d.name === m));
  if (missing.length) { console.log(`NOT FOUND: ${missing.join(", ")}`); return; }

  const analyse = (d: (typeof designs)[number]) => {
    const grid: (string | null)[][] = JSON.parse(pako.inflate(Buffer.from(d.pixelData), { to: "string" }));
    const counts = new Map<string, number>();
    for (const row of grid) for (const c of row) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    const usage = calculateYarnUsage(counts, d.meshCount as 18, d.stitchType as "continental", d.bufferPercent);
    const perSkein = skeinYardsForMesh(d.meshCount as 18);
    return {
      d, usage, perSkein,
      colours: [...counts.keys()].sort().join("+"),
      // Whole skeins on RAW yardage: what you physically put in the bag. The
      // buffer is headroom, not another skein — rounding it up is what made
      // three one-skein signs look like two-skein ones.
      rawSkeins: new Map(usage.map((u) => [u.dmcNumber, Math.ceil(u.yarnYards / perSkein)])),
    };
  };

  const plans: { name: string; notes: string; rows: ReturnType<typeof analyse>[]; contents: string }[] = [];
  let refused = false;

  for (const g of GROUPS) {
    const rows = designs.filter((d) => g.members.includes(d.name)).map(analyse);
    console.log(`\n=== ${g.name} (${rows.length} designs) ===`);
    for (const r of rows) {
      const parts = r.usage.map((u) =>
        `${u.dmcNumber} raw ${u.yarnYards.toFixed(1)}yd -> ${r.rawSkeins.get(u.dmcNumber)}sk`).join("  ");
      console.log(`  ${r.d.name.padEnd(17)} ${parts}`);
    }

    const sets = new Set(rows.map((r) => r.colours));
    if (sets.size !== 1) {
      console.log(`  REFUSING: colour sets differ — ${[...sets].join("  VS  ")}`);
      refused = true;
      continue;
    }
    const colours = [...sets][0].split("+");

    // The guard that matters: one bag, one skein count, for every member.
    const clash = colours.filter((c) => new Set(rows.map((r) => r.rawSkeins.get(c))).size > 1);
    if (clash.length) {
      for (const c of clash)
        console.log(`  REFUSING: ${c} needs ${rows.map((r) => `${r.d.name} ${r.rawSkeins.get(c)}sk`).join(", ")} — one bag cannot serve both`);
      refused = true;
      continue;
    }

    const contents = colours.map((c) => {
      const sk = rows[0].rawSkeins.get(c)!;
      const maxRaw = Math.max(...rows.map((r) => r.usage.find((u) => u.dmcNumber === c)!.yarnYards));
      const full = rows.some((r) => r.usage.find((u) => u.dmcNumber === c)!.usesFullSkein);
      return full ? `${sk} x ${c} skein${sk > 1 ? "s" : ""}` : `1 x ${c} bobbin (${Math.ceil(maxRaw) + 1}yd)`;
    }).join(", ");
    console.log(`  one bag = ${contents}`);

    // Headroom, because a skein that only just covers the hungriest member is
    // a bag that can run short mid-stitch.
    for (const c of colours) {
      const sk = rows[0].rawSkeins.get(c)!;
      const maxRaw = Math.max(...rows.map((r) => r.usage.find((u) => u.dmcNumber === c)!.yarnYards));
      const have = sk * rows[0].perSkein;
      const slack = have - maxRaw;
      if (rows.some((r) => r.usage.find((u) => u.dmcNumber === c)!.usesFullSkein) && slack / have < 0.1)
        console.log(`  TIGHT: ${c} — the hungriest member wants ${maxRaw.toFixed(1)}yd of ${have}yd (${(slack / have * 100).toFixed(1)}% spare)`);
    }

    plans.push({ name: g.name, notes: g.notes, rows, contents });
  }

  if (refused) { console.log(`\nnothing written — fix the groups above.`); return; }

  console.log(`\nkits moving into each pool:`);
  for (const p of plans) {
    const pool = {
      kitsReady: p.rows.reduce((s, r) => s + r.d.kitsReady, 0),
      marketKitsReady: p.rows.reduce((s, r) => s + r.d.marketKitsReady, 0),
      kitsAndover: p.rows.reduce((s, r) => s + r.d.kitsAndover, 0),
    };
    for (const r of p.rows)
      console.log(`  ${r.d.name.padEnd(17)} home ${r.d.kitsReady}  tote ${r.d.marketKitsReady}  andover ${r.d.kitsAndover}`);
    console.log(`  ${`-> ${p.name}`.padEnd(17)} home ${pool.kitsReady}  tote ${pool.marketKitsReady}  andover ${pool.kitsAndover}\n`);
  }

  const stillGrouped = designs.filter((d) => d.kitGroupId);
  if (stillGrouped.length) {
    console.log(`REFUSING: ${stillGrouped.length} of these designs are still in a pool.`);
    console.log(`Run with --undo --write first, so their own counts come back and can be re-split.`);
    return;
  }

  if (!WRITE) { console.log(`DRY RUN — nothing written. Re-run with --write.`); return; }

  for (const p of plans) {
    const pool = {
      kitsReady: p.rows.reduce((s, r) => s + r.d.kitsReady, 0),
      marketKitsReady: p.rows.reduce((s, r) => s + r.d.marketKitsReady, 0),
      kitsAndover: p.rows.reduce((s, r) => s + r.d.kitsAndover, 0),
    };
    const restore = Object.fromEntries(p.rows.map((r) => [r.d.id, {
      kitsReady: r.d.kitsReady, marketKitsReady: r.d.marketKitsReady, kitsAndover: r.d.kitsAndover,
    }]));
    await prisma.$transaction(async (tx) => {
      const notes = `${p.notes} <restore>${JSON.stringify(restore)}</restore>`;
      const g = await tx.kitGroup.upsert({
        where: { name: p.name },
        update: { ...pool, contents: p.contents, notes },
        create: { name: p.name, ...pool, contents: p.contents, notes },
      });
      await tx.design.updateMany({
        where: { id: { in: p.rows.map((r) => r.d.id) } },
        data: { kitGroupId: g.id, kitsReady: 0, marketKitsReady: 0, kitsAndover: 0 },
      });
    });
    console.log(`wrote ${p.name}: ${pool.kitsReady} home, ${pool.marketKitsReady} tote, ${pool.kitsAndover} andover`);
  }
  console.log(`members' own kit columns zeroed; originals saved for --undo`);
}

main().finally(() => prisma.$disconnect());

/**
 * Build the definitive list of DMC numbers worth measuring, so the job has an
 * end.
 *
 * The palette has 480 colours and the business physically holds 77 of them.
 * Measuring is the only real fix for hex values that were eyeballed (see
 * dmc-measured.ts), but it is only tractable because it is bounded — you can
 * only hold a card under a camera for thread you own. This writes that bound
 * down.
 *
 *   set -a && . ./.env.local && set +a
 *   npx tsx --tsconfig tsconfig.json scripts/build-measurement-scope.ts
 *   npx tsx --tsconfig tsconfig.json scripts/build-measurement-scope.ts --stdout
 *
 * READ-ONLY: findMany only, no write of any kind to the database.
 *
 * Three sources, because any one of them alone misses thread you hold:
 *   design  — a colour a live 18ct design calls for, even if the stock ran out
 *   stock   — a skein on the shelf, even if no current design uses it
 *   bobbin  — already wound, so the card is halfway made
 *
 * 13ct is excluded: those intro kits arrive finished from the supplier, so we
 * never hold their thread and there is nothing to wind (src/lib/sourcing.ts).
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import pako from "pako";
import { prisma } from "../src/lib/prisma";
import { DMC_PEARL_COTTON } from "../src/lib/dmc-pearl-cotton";
import { MEASURED } from "../src/lib/dmc-measured";

const STDOUT = process.argv.includes("--stdout");
const OUT = join(__dirname, "data", "measurement-scope.json");

type Source = "design" | "stock" | "bobbin";

/** The hex literals as written in dmc-pearl-cotton.ts — see ScopeEntry.currentHex. */
function paletteLiterals(): Map<string, string> {
  const src = readFileSync(join(__dirname, "..", "src", "lib", "dmc-pearl-cotton.ts"), "utf8");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/createColor\("([^"]+)",\s*"[^"]*",\s*"(#[0-9A-Fa-f]{6})"\)/g))
    out.set(m[1], m[2].toUpperCase());
  if (out.size !== DMC_PEARL_COTTON.length)
    throw new Error(`parsed ${out.size} hex literals but the palette has ${DMC_PEARL_COTTON.length} — the createColor call shape changed`);
  return out;
}

interface ScopeEntry {
  dmcNumber: string;
  name: string;
  /** The hex LITERAL in dmc-pearl-cotton.ts — the eyeballed value a reading
   *  replaces. Deliberately not DMC_PEARL_COTTON[].hex: createColor already
   *  substitutes MEASURED, so after the first import the sheet would print each
   *  measured colour's own reading in the "replaces" column and claim the
   *  reading replaces itself. Same reasoning, same parse, as paletteLiterals()
   *  in scripts/import-thread-measurements.ts. */
  currentHex: string;
  /** The reading already on file, or null if this card is still to shoot. */
  measuredHex: string | null;
  sources: Source[];
  /** Live 18ct designs calling for it: the colour's blast radius if it is wrong. */
  designs: number;
  skeins: number;
  bobbins: number;
}

async function main() {
  const designs = await prisma.design.findMany({
    // printVersionOf excluded: a print version is a colour-adjusted copy of a
    // design for the printer, so counting it doubles its parent's colours.
    where: { deletedAt: null, archivedAt: null, isDraft: false, meshCount: 18, printVersionOf: null },
    select: { id: true, name: true, pixelData: true },
  });

  // Read the grid rather than the colorsUsed cache. colorsUsed is written on
  // design save, so any edit path that forgot to refresh it drops a colour
  // silently — and a list whose whole job is to be definitive cannot be built
  // on a cache. All 77 grids together are 56KB, so there is nothing to save.
  const designCount = new Map<string, number>();
  for (const d of designs) {
    const grid: (string | null)[][] = JSON.parse(pako.inflate(Buffer.from(d.pixelData), { to: "string" }));
    const used = new Set<string>();
    for (const row of grid) for (const cell of row) if (cell) used.add(cell);
    for (const c of used) designCount.set(c, (designCount.get(c) ?? 0) + 1);
  }

  const skeins = new Map<string, number>();
  for (const i of await prisma.inventoryItem.findMany({ where: { skeins: { gt: 0 } } }))
    skeins.set(i.dmcNumber, (skeins.get(i.dmcNumber) ?? 0) + i.skeins);

  const bobbins = new Map<string, number>();
  for (const b of await prisma.bobbinInventory.findMany({ where: { count: { gt: 0 } } }))
    bobbins.set(b.dmcNumber, (bobbins.get(b.dmcNumber) ?? 0) + b.count);

  const palette = new Map(DMC_PEARL_COTTON.map((c) => [c.dmcNumber, c]));
  const literals = paletteLiterals();
  const numbers = [...new Set([...designCount.keys(), ...skeins.keys(), ...bobbins.keys()])];

  // A number no longer in the palette cannot be measured into it, so it is a
  // data problem to fix rather than a card to wind.
  const unknown = numbers.filter((n) => !palette.has(n)).sort();

  const entries: ScopeEntry[] = numbers
    .filter((n) => palette.has(n))
    .map((n) => {
      const sources: Source[] = [];
      if (designCount.has(n)) sources.push("design");
      if (skeins.has(n)) sources.push("stock");
      if (bobbins.has(n)) sources.push("bobbin");
      return {
        dmcNumber: n,
        name: palette.get(n)!.name,
        currentHex: literals.get(n)!,
        measuredHex: MEASURED[n]?.hex ?? null,
        sources,
        designs: designCount.get(n) ?? 0,
        skeins: skeins.get(n) ?? 0,
        bobbins: bobbins.get(n) ?? 0,
      };
    })
    // Winding order: most designs first, then most stock. A half-finished
    // sheet is then still the half that matters, because a wrong hex on a
    // colour in 30 designs misleads 30 kits and one in a single design misleads
    // one. dmcNumber breaks ties so the file is stable between runs.
    .sort((a, b) => b.designs - a.designs || b.skeins - a.skeins || a.dmcNumber.localeCompare(b.dmcNumber));

  const doc = {
    generatedBy: "scripts/build-measurement-scope.ts",
    generatedAt: new Date().toISOString().slice(0, 10),
    paletteSize: DMC_PEARL_COTTON.length,
    counts: {
      total: entries.length,
      design: entries.filter((e) => e.sources.includes("design")).length,
      stock: entries.filter((e) => e.sources.includes("stock")).length,
      bobbin: entries.filter((e) => e.sources.includes("bobbin")).length,
      designsScanned: designs.length,
      measured: entries.filter((e) => e.measuredHex !== null).length,
    },
    unknownToPalette: unknown,
    colors: entries,
  };

  const json = JSON.stringify(doc, null, 2) + "\n";
  if (STDOUT) { console.log(json); return; }
  writeFileSync(OUT, json);

  console.log(`${entries.length} colours in scope, from ${designs.length} live 18ct designs`);
  console.log(`  in a design: ${doc.counts.design}   on the shelf: ${doc.counts.stock}   wound: ${doc.counts.bobbin}`);
  const only = (s: Source) => entries.filter((e) => e.sources.length === 1 && e.sources[0] === s).length;
  console.log(`  reached by one source only — design ${only("design")}, stock ${only("stock")}, bobbin ${only("bobbin")}`);
  console.log(`  already measured: ${doc.counts.measured}   still to shoot: ${entries.length - doc.counts.measured}`);
  if (unknown.length) console.log(`  NOT IN PALETTE (cannot be measured in): ${unknown.join(", ")}`);
  console.log(`wrote ${OUT}`);
}

main().finally(() => prisma.$disconnect());

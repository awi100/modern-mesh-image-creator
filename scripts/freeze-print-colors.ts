/**
 * Freeze the print colour a design currently uses, before a palette hex moves.
 *
 * A palette hex is not a display setting: it SEEDS the print overrides. The
 * colours page generates `adjustColorForPrint(color.hex)` for any colour a
 * design has no stored override for, so moving a hex silently changes what
 * gets sent to the printer for every such design the next time its colours
 * page is opened. That is why 310 Black was moved and reverted the same day
 * (see the note above DMC_PEARL_COTTON), and the rule written down there is:
 * backfill every affected design with its CURRENT value, THEN change the hex.
 *
 * This is that backfill. Run it BEFORE editing dmc-pearl-cotton.ts — it reads
 * the palette to decide what "current" means, so running it afterwards freezes
 * the new value and protects nothing.
 *
 * Note the two cases it has to cover. `adjustColorForPrint` returns the hex
 * unchanged for light colours (above its L*70 threshold), and the colours page
 * only stores an override when the adjusted value DIFFERS — so for a colour
 * like 415 Pearl Gray nothing is stored at all and the renderer falls back to
 * the palette hex directly. There is nothing on disk protecting it, which is
 * exactly why it needs an explicit entry written here.
 *
 * Scope is every non-deleted design, archived ones included: freezing an
 * archive is harmless, and a print version (`printVersionOf`) is precisely the
 * thing that goes to a printer.
 *
 * Usage (dry run prints the plan and writes nothing):
 *   npx tsx --tsconfig tsconfig.json scripts/freeze-print-colors.ts 415 666 3753
 *   npx tsx --tsconfig tsconfig.json scripts/freeze-print-colors.ts 415 666 3753 --apply
 */
import { prisma } from "../src/lib/prisma";
import { adjustColorForPrint } from "../src/lib/pdf-export";
import { getDmcColorByNumber } from "../src/lib/dmc-pearl-cotton";
import { parseOverrides, recordRevision, ensureBaseline } from "../src/lib/print-colors";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const numbers = args.filter((a) => !a.startsWith("--"));
  if (!numbers.length) {
    console.error("Give at least one DMC number, e.g. 415 666 3753");
    process.exit(1);
  }

  const frozenFor = new Map<string, string>();
  for (const num of numbers) {
    const color = getDmcColorByNumber(num);
    if (!color) {
      console.error(`DMC ${num} is not in the palette — aborting rather than guessing.`);
      process.exit(1);
    }
    frozenFor.set(num, adjustColorForPrint(color.hex));
    console.log(`DMC ${num} ${color.name}: palette ${color.hex} -> freezing print as ${adjustColorForPrint(color.hex)}`);
  }
  console.log();

  const designs = await prisma.design.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, colorsUsed: true, printColorOverrides: true, archivedAt: true, printVersionOf: true },
    orderBy: { name: "asc" },
  });

  const plan: { id: string; name: string; adds: Record<string, string>; existing: Record<string, string>; tag: string }[] = [];
  let alreadySafe = 0;
  for (const d of designs) {
    let used: string[] = [];
    try { used = JSON.parse(d.colorsUsed || "[]"); } catch { used = []; }
    const existing = parseOverrides(d.printColorOverrides);
    const adds: Record<string, string> = {};
    for (const num of numbers) {
      if (!used.includes(num)) continue;
      if (existing[num]) { alreadySafe++; continue; } // a stored override always wins
      adds[num] = frozenFor.get(num)!;
    }
    if (Object.keys(adds).length) {
      const tag = d.printVersionOf ? "print-version" : d.archivedAt ? "archived" : "live";
      plan.push({ id: d.id, name: d.name, adds, existing, tag });
    }
  }

  for (const p of plan) {
    console.log(`  ${p.tag.padEnd(13)} ${p.name.slice(0, 38).padEnd(39)} + ${Object.entries(p.adds).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
  console.log(`\n${plan.length} designs to freeze (${plan.filter((p) => p.tag === "live").length} live, ${plan.filter((p) => p.tag === "archived").length} archived, ${plan.filter((p) => p.tag === "print-version").length} print-versions).`);
  console.log(`${alreadySafe} design/colour pairs already carry a stored override and are untouched.`);

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
    await prisma.$disconnect();
    return;
  }

  const note = `Frozen before palette correction of ${numbers.join(", ")}`;
  let written = 0;
  for (const p of plan) {
    const next = { ...p.existing, ...p.adds };
    await prisma.$transaction(async (tx) => {
      // Capture what was in use beforehand, so the history does not begin
      // after we already changed it.
      await ensureBaseline(tx, p.id, p.existing);
      await tx.design.update({ where: { id: p.id }, data: { printColorOverrides: JSON.stringify(next) } });
      await recordRevision(tx, p.id, next, "manual", note);
    });
    written++;
  }
  console.log(`\nWrote ${written} designs.`);
  await prisma.$disconnect();
}
main();

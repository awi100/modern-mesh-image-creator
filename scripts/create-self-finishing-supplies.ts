/**
 * Create the Supply rows for the self-finishing ornaments and luggage tags.
 *
 * Names are "<Color> <Shopify product title>", which is what
 * `matchSupplyByVariant` builds from a line item: squash("Green") +
 * squash("Self-Finishing Ornament") === squash("Green Self-Finishing
 * Ornament"). Get the name wrong and the line matches nothing and deducts
 * nothing — see src/lib/supply-match.ts.
 *
 * Quantities are the physical count ON THE SHELF NOW, not the purchase
 * quantity, because stock that has already left has to come off somewhere:
 *
 *   White ornament   50 bought  -1 sold at a market on 21 Nov (order #4307,
 *                               POS, fulfilled, matched no supply so it never
 *                               deducted and never will)        -> 49
 *   Green ornament   50 bought, nothing shipped                 -> 50
 *   Red ornament     50 bought, nothing sold                    -> 50
 *
 * The two open orders (#4347 green, #4350 white) are deliberately NOT netted
 * off: they deduct themselves when she presses Fulfill, which lands white on
 * 48 and green on 49 — exactly what Shopify's inventory reads.
 *
 * Everything goes to `quantity` (home). No tote or Andover split is invented;
 * move stock to the tote with the transfer control if any is in it.
 *
 * Dry run by default. --write applies.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ROWS: { name: string; quantity: number; note: string }[] = [
  { name: "White Self-Finishing Ornament", quantity: 49, note: "50 bought, 1 sold POS #4307 (never deducted)" },
  { name: "Red Self-Finishing Ornament", quantity: 50, note: "50 bought" },
  { name: "Green Self-Finishing Ornament", quantity: 50, note: "50 bought" },
  { name: "White Self-Finishing Luggage Tag", quantity: 100, note: "100 bought (Shopify says 50 — see report)" },
  { name: "Blue Self-Finishing Luggage Tag", quantity: 100, note: "100 bought (Shopify says 50 — see report)" },
];

async function main() {
  const write = process.argv.includes("--write");

  const existing = await prisma.supply.findMany({
    where: { name: { in: ROWS.map((r) => r.name) } },
    select: { id: true, name: true, quantity: true },
  });
  if (existing.length) {
    console.log("ALREADY EXIST — refusing to touch these, nothing is overwritten:");
    for (const e of existing) console.log(`   ${e.name} (home ${e.quantity})`);
  }
  const todo = ROWS.filter((r) => !existing.some((e) => e.name === r.name));

  console.log(`\n${todo.length} supply rows to create:\n`);
  for (const r of todo) {
    console.log(`   ${r.name.padEnd(36)} home=${r.quantity}   ${r.note}`);
  }

  if (!write) {
    console.log("\nDRY RUN — nothing written. Re-run with --write to apply.");
    return;
  }

  console.log("\ncreating...");
  for (const r of todo) {
    const created = await prisma.supply.create({
      data: { name: r.name, quantity: r.quantity, marketQuantity: 0, andoverQuantity: 0 },
      select: { id: true, name: true, quantity: true },
    });
    console.log(`   ok  ${created.name}  home=${created.quantity}  (${created.id})`);
  }
  console.log(`\n${todo.length} created.`);
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

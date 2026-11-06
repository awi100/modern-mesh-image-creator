/**
 * Kit Order Planner — see SKILL.md for the methodology.
 *
 * Run:
 *   export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
 *   npx tsx --tsconfig tsconfig.json .claude/skills/kit-order-planner/compute-kit-order.ts
 *
 * Writes kit-order.csv, kit-order-thread.csv, kit-order-per-kit.csv to repo root.
 */
import { PrismaClient } from "@prisma/client";
import pako from "pako";
import { writeFileSync } from "node:fs";
import { calculateYarnUsage, type MeshCount, type StitchType } from "@/lib/yarn-calculator";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { KIT_GROUP_INCLUDE, sharedKitShare } from "../../../src/lib/kit-pool";

// ---- Tunables ----
const ATTACH = 0.72;      // historical 18ct kit-attach rate
const LEAD_WEEKS = 13;    // ~3 months kit-supplier lead
const WINDOW_DAYS = 90;   // velocity window

// ---- Canvas already coming (EDIT THIS each run) ----
// Design name -> canvas quantity on order (canvas order sheet + outstanding POs).
// Canvas reorder agreed 6 Nov 2026 — sized to 12 months of cover from arrival
// (rate x 15 months less stock on hand, which covers the ~3-month lead).
const ON_ORDER: Record<string, number> = {
  "Fenway Frank": 200,
  "Citgo Sign": 200,
  "Shamrock": 200,
  "Honey Deuce": 100,
  "Hugo Spritz": 100,
  "Summer Should Be Fun": 100,
  "Cosmopolitan": 100,
  "Shamrock Beer": 100,
  "Cowboy Pup": 100,
  "Boston Terrier": 100,
  "Espresso Martini": 50,
  "Martini": 50,
  "Anchor": 50,
  "Lighthouse": 50,
  "French Bulldog": 50,
  "Heart Matchbox": 50,
  "Pats Matchbox": 50,
  "Comm Ave": 50,
  "Crab": 50,
  "Black & Gold Hockey Jersey": 50,
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const onOrderFor = (name: string) => ON_ORDER[norm(name) as keyof typeof ON_ORDER] ??
  (Object.entries(ON_ORDER).find(([k]) => norm(k) === norm(name))?.[1] ?? 0);

function countStitches(grid: (string | null)[][]) {
  const m = new Map<string, number>();
  for (const row of grid) for (const c of row) if (c) m.set(c, (m.get(c) || 0) + 1);
  return m;
}
const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((v) => { const s = String(v); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";

async function main() {
  const prisma = new PrismaClient();
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_DAYS * 864e5);

  const designs = await prisma.design.findMany({
    where: { meshCount: 18, deletedAt: null, archivedAt: null, printVersionOf: null },
    select: {
      id: true, name: true, pixelData: true, stitchType: true, bufferPercent: true,
      kitsReady: true, marketKitsReady: true, kitsAndover: true,
      kitGroupId: true, ...KIT_GROUP_INCLUDE,
      canvasPrinted: true, marketCanvasPrinted: true, canvasAndover: true,
    },
  });

  // Velocity: units sold/week over the trailing window, by REAL order date, processed rows only.
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      fulfilledAt: { not: null },
      OR: [{ orderDate: { gte: windowStart } }, { orderDate: null, createdAt: { gte: windowStart } }],
    },
    select: { items: { where: { designId: { not: null }, processed: true }, select: { designId: true, quantity: true } } },
  });
  const sold = new Map<string, number>();
  for (const o of orders) for (const it of o.items) if (it.designId) sold.set(it.designId, (sold.get(it.designId) || 0) + it.quantity);

  const orderRows: (string | number)[][] = [["design", "on_hand", "made", "on_order", "velocity_wk", "kits_to_order"]];
  const perKit: (string | number)[][] = [["design", "dmc", "color", "yards_per_kit"]];
  const byColor = new Map<string, number>();
  let totalKits = 0;

  // Designs that share a kit pool are ordered as ONE line, because that is what
  // the supplier makes: one bag that fits any member. Five lines would have
  // them packing five versions of an identical bag.
  type Pool = {
    name: string; kits: number; onHand: number; made: number; onOrder: number; velocity: number;
    members: string[];
    // The hungriest member decides each colour. A pooled bag has to satisfy
    // whichever design needs the most, so a per-design figure would send some
    // bags out short — Main Street wants 31.5yd of 909 where Comm Ave wants
    // 28.1, and one bag serves either.
    yards: Map<string, number>;
  };
  const pools = new Map<string, Pool>();

  for (const d of designs) {
    const onHand = d.canvasPrinted + (d.marketCanvasPrinted || 0) + (d.canvasAndover || 0);
    // A design sharing a kit pool gets its EVEN SHARE here, not the whole
    // pool: "kits already made" feeds a per-design order quantity, and
    // crediting all five street signs with the same bags would order no kits
    // for any of them. sharedKitShare includes Andover, which this does too.
    const made = d.kitGroupId
      ? sharedKitShare(d) + (d.kitGroup?.kitsAndover ?? 0) / Math.max(1, d.kitGroup?._count?.designs ?? 1)
      : d.kitsReady + (d.marketKitsReady || 0) + (d.kitsAndover || 0); // Andover = assembled kits in bulk storage
    const onOrder = onOrderFor(d.name);
    if (onHand + made + onOrder === 0) continue;
    const velocity = (sold.get(d.id) || 0) / (WINDOW_DAYS / 7);
    const projected = Math.max(0, onHand - Math.round(velocity * LEAD_WEEKS)) + made + onOrder;
    // Rounded at the end, not before: `made` is fractional for a design in a
    // shared kit pool (its even share of the pool), and an unrounded count
    // reaches the supplier as "order 4.33 kits".
    const kits = Math.max(0, Math.round(Math.round(projected * ATTACH) - made));
    if (kits <= 0) continue;

    const grid: (string | null)[][] = JSON.parse(pako.inflate(Buffer.from(d.pixelData), { to: "string" }));
    const usage = calculateYarnUsage(countStitches(grid), 18 as MeshCount, (d.stitchType as StitchType) || "continental", d.bufferPercent ?? 20);

    if (d.kitGroupId && d.kitGroup) {
      const key = d.kitGroup.name;
      const p = pools.get(key) ?? { name: key, kits: 0, onHand: 0, made: 0, onOrder: 0, velocity: 0, members: [], yards: new Map() };
      p.kits += kits;
      p.onHand += onHand;       // each member's own canvas; only the bag is shared
      p.made += made;           // the shares add back up to the pool
      p.onOrder += onOrder;
      p.velocity += velocity;
      p.members.push(d.name);
      for (const u of usage) p.yards.set(u.dmcNumber, Math.max(p.yards.get(u.dmcNumber) ?? 0, u.withBuffer));
      pools.set(key, p);
      continue;
    }

    orderRows.push([d.name, onHand, Math.round(made * 10) / 10, onOrder, Math.round(velocity * 100) / 100, kits]);
    totalKits += kits;
    for (const u of usage) {
      const yPerKit = Math.round(u.withBuffer * 10) / 10;
      perKit.push([d.name, u.dmcNumber, getDmcColorByNumber(u.dmcNumber)?.name ?? "Unknown", yPerKit]);
      byColor.set(u.dmcNumber, (byColor.get(u.dmcNumber) || 0) + u.withBuffer * kits);
    }
  }

  for (const p of pools.values()) {
    orderRows.push([p.name, p.onHand, Math.round(p.made * 10) / 10, p.onOrder, Math.round(p.velocity * 100) / 100, p.kits]);
    totalKits += p.kits;
    for (const [dmc, yd] of p.yards) {
      perKit.push([p.name, dmc, getDmcColorByNumber(dmc)?.name ?? "Unknown", Math.round(yd * 10) / 10]);
      byColor.set(dmc, (byColor.get(dmc) || 0) + yd * p.kits);
    }
    console.log(`pooled: ${p.name} = ${p.kits} bags for ${p.members.join(", ")}`);
  }

  const threadRows: (string | number)[][] = [["dmc", "color", "total_yards"]];
  for (const [dmc, yards] of [...byColor.entries()].sort((a, b) => b[1] - a[1])) {
    threadRows.push([dmc, getDmcColorByNumber(dmc)?.name ?? "Unknown", Math.round(yards)]);
  }

  writeFileSync("kit-order.csv", csv(orderRows));
  writeFileSync("kit-order-thread.csv", csv(threadRows));
  writeFileSync("kit-order-per-kit.csv", csv(perKit));
  console.log(`Designs to kit: ${orderRows.length - 1}, total kits: ${totalKits}`);
  console.log(`Colors: ${threadRows.length - 1}, total yards: ${threadRows.slice(1).reduce((s, r) => s + Number(r[2]), 0)}`);
  console.log("Wrote kit-order.csv, kit-order-thread.csv, kit-order-per-kit.csv");
  if (Object.keys(ON_ORDER).length === 0) console.log("\n⚠ ON_ORDER is empty — edit the map at the top with canvas already coming.");
  await prisma.$disconnect();
}
main();

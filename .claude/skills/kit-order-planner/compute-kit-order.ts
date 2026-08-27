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

// ---- Tunables ----
const ATTACH = 0.72;      // historical 18ct kit-attach rate
const LEAD_WEEKS = 13;    // ~3 months kit-supplier lead
const WINDOW_DAYS = 90;   // velocity window

// ---- Canvas already coming (EDIT THIS each run) ----
// Design name -> canvas quantity on order (canvas order sheet + outstanding POs).
const ON_ORDER: Record<string, number> = {
  // e.g. "Fenway Frank": 300, "Lobster": 150, "Hydrangea": 200,
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

  for (const d of designs) {
    const onHand = d.canvasPrinted + (d.marketCanvasPrinted || 0) + (d.canvasAndover || 0);
    const made = d.kitsReady + (d.marketKitsReady || 0) + (d.kitsAndover || 0); // Andover = assembled kits in bulk storage
    const onOrder = onOrderFor(d.name);
    if (onHand + made + onOrder === 0) continue;
    const velocity = (sold.get(d.id) || 0) / (WINDOW_DAYS / 7);
    const projected = Math.max(0, onHand - Math.round(velocity * LEAD_WEEKS)) + made + onOrder;
    const kits = Math.max(0, Math.round(projected * ATTACH) - made);
    if (kits <= 0) continue;
    orderRows.push([d.name, onHand, made, onOrder, Math.round(velocity * 100) / 100, kits]);
    totalKits += kits;

    const grid: (string | null)[][] = JSON.parse(pako.inflate(Buffer.from(d.pixelData), { to: "string" }));
    const usage = calculateYarnUsage(countStitches(grid), 18 as MeshCount, (d.stitchType as StitchType) || "continental", d.bufferPercent ?? 20);
    for (const u of usage) {
      const yPerKit = Math.round(u.withBuffer * 10) / 10;
      perKit.push([d.name, u.dmcNumber, getDmcColorByNumber(u.dmcNumber)?.name ?? "Unknown", yPerKit]);
      byColor.set(u.dmcNumber, (byColor.get(u.dmcNumber) || 0) + u.withBuffer * kits);
    }
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

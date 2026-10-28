/**
 * Record free replacement units — extras, and reprints of batches that printed
 * badly.
 *
 * Like the invoice import, this is cost-only: it creates no receipts and moves
 * no quantity. Those canvases are already on the shelf and already counted,
 * which is exactly why they show up as stock no purchase explains. This gives
 * them a purchase to point at.
 *
 * The paid line's money is then spread across the paid and the free units
 * together, so both carry the same rate — see poolReplacementCost().
 *
 *   npx tsx --tsconfig tsconfig.json scripts/record-replacements.ts          # dry run
 *   npx tsx --tsconfig tsconfig.json scripts/record-replacements.ts --write
 *   npx tsx --tsconfig tsconfig.json scripts/record-replacements.ts --undo
 */

import { prisma } from "../src/lib/prisma";
import data from "./data/free-replacements.json";
import { poolReplacementCost, round2 } from "../src/lib/costing";

const WRITE = process.argv.includes("--write");
const UNDO = process.argv.includes("--undo");

interface Entry {
  design: string;
  units: number;
  invoice?: string;
  freight?: number;
  note?: string;
}

async function main() {
  if (UNDO) {
    const lines = await prisma.purchaseOrderLine.findMany({
      where: { noCharge: true },
      select: { id: true, quantity: true, replacesLineId: true },
    });
    if (!lines.length) {
      console.log("no no-charge lines to undo");
      return;
    }
    if (!WRITE) {
      console.log(`would remove ${lines.length} no-charge lines and restore the paid rates. Add --write.`);
      return;
    }
    // Put each paid line back on its own rate before dropping the free one,
    // otherwise the pooled rate outlives the units that justified it.
    for (const l of lines) {
      if (!l.replacesLineId) continue;
      const paid = await prisma.purchaseOrderLine.findUnique({ where: { id: l.replacesLineId } });
      if (!paid) continue;
      const rate = poolReplacementCost(paid, 0);
      await prisma.purchaseOrderLine.update({ where: { id: paid.id }, data: { landedUnitCost: rate } });
      await prisma.costLayer.updateMany({ where: { lineId: paid.id }, data: { landedUnitCost: rate } });
    }
    // Layers cascade from the line.
    const gone = await prisma.purchaseOrderLine.deleteMany({ where: { noCharge: true } });
    console.log(`removed ${gone.count} no-charge lines and restored the paid rates`);
    return;
  }

  const entries = (data as { replacements: Entry[] }).replacements;
  if (!entries.length) {
    console.log("scripts/data/free-replacements.json has no entries yet — nothing to record.");
    return;
  }

  const plans: {
    entry: Entry;
    designId: string;
    designName: string;
    paidLineId: string | null;
    invoice: string | null;
    poId: string | null;
    paidQty: number;
    oldRate: number;
    newRate: number;
    receivedAt: Date;
  }[] = [];
  const problems: string[] = [];

  for (const e of entries) {
    if (!(e.units > 0)) {
      problems.push(`${e.design}: units must be positive`);
      continue;
    }
    const design = await prisma.design.findFirst({
      where: { name: e.design, deletedAt: null, printVersionOf: null },
      select: { id: true, name: true },
    });
    if (!design) {
      problems.push(`${e.design}: no such design`);
      continue;
    }

    // The paid line these make good on. Named invoice wins; otherwise the most
    // recent paid line for this design, which is the batch a reprint replaces.
    const paid = await prisma.purchaseOrderLine.findFirst({
      where: {
        designId: design.id,
        noCharge: false,
        ...(e.invoice ? { purchaseOrder: { invoiceNumber: e.invoice } } : {}),
      },
      include: { purchaseOrder: { select: { id: true, invoiceNumber: true, orderDate: true, createdAt: true } } },
      orderBy: { purchaseOrder: { orderDate: "desc" } },
    });

    if (!paid) {
      // No invoice to pool with. The units are real and go in, but they cost
      // nothing — flagged rather than quietly given a made-up rate.
      problems.push(`${e.design}: no paid line on file, so the free units will carry $0`);
      plans.push({
        entry: e, designId: design.id, designName: design.name, paidLineId: null,
        invoice: null, poId: null, paidQty: 0, oldRate: 0, newRate: 0, receivedAt: new Date(),
      });
      continue;
    }

    const oldRate = paid.landedUnitCost;
    // Freight we paid to get the reprint here joins the pool; usually zero.
    const newRate = poolReplacementCost(
      { quantity: paid.quantity, unitCost: paid.unitCost, allocatedCost: paid.allocatedCost + (e.freight ?? 0) },
      e.units,
    );
    plans.push({
      entry: e, designId: design.id, designName: design.name, paidLineId: paid.id,
      invoice: paid.purchaseOrder.invoiceNumber, poId: paid.purchaseOrder.id,
      paidQty: paid.quantity, oldRate, newRate,
      // The reprint shipped later than the order it makes good on, but dating
      // it to the order keeps FIFO reading the two as one lot — which, at a
      // pooled rate, they are.
      receivedAt: paid.purchaseOrder.orderDate ?? paid.purchaseOrder.createdAt,
    });
  }

  console.log("design                         free  paid  invoice        was      now");
  for (const p of plans)
    console.log(
      `${p.designName.padEnd(30)} ${String(p.entry.units).padStart(4)} ${String(p.paidQty).padStart(5)}  ${(p.invoice ?? "—").padEnd(13)} $${p.oldRate.toFixed(2).padStart(6)}  $${p.newRate.toFixed(2).padStart(6)}`,
    );

  const freeUnits = plans.reduce((s, p) => s + p.entry.units, 0);
  console.log(`\n${plans.length} designs, ${freeUnits} free units. No quantity is changed.`);

  if (problems.length) {
    console.log(`\nCHECK THESE:`);
    for (const p of problems) console.log(`  ${p}`);
  }

  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write.`);
    return;
  }

  let written = 0;
  for (const p of plans) {
    if (!p.poId || !p.paidLineId) continue;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrderLine.findFirst({
        where: { designId: p.designId, noCharge: true, replacesLineId: p.paidLineId },
      });
      if (existing) return;

      const line = await tx.purchaseOrderLine.create({
        data: {
          purchaseOrderId: p.poId!,
          kind: "canvas",
          designId: p.designId,
          supplierDescription: `${p.designName} — no charge`,
          quantity: p.entry.units,
          unitCost: 0,
          allocatedCost: p.entry.freight ?? 0,
          landedUnitCost: p.newRate,
          noCharge: true,
          replacesLineId: p.paidLineId,
          notes: p.entry.note ?? "Sent free by the supplier.",
        },
      });

      await tx.costLayer.create({
        data: {
          lineId: line.id,
          kind: "canvas",
          designId: p.designId,
          quantity: p.entry.units,
          remaining: p.entry.units,
          landedUnitCost: p.newRate,
          receivedAt: p.receivedAt,
          source: "replacement",
          estimated: true,
          notes: `Free from the supplier; cost pooled with invoice ${p.invoice}.`,
        },
      });

      // The paid line and its layer move to the pooled rate too — the whole
      // point is that a paid canvas and a free one cost the same.
      await tx.purchaseOrderLine.update({ where: { id: p.paidLineId! }, data: { landedUnitCost: p.newRate } });
      await tx.costLayer.updateMany({ where: { lineId: p.paidLineId! }, data: { landedUnitCost: p.newRate } });
      written++;
    });
  }
  console.log(`\nwrote ${written} no-charge lines`);
}

main().finally(() => prisma.$disconnect());

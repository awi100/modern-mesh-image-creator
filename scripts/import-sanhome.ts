/**
 * Load the Sanhome purchase history.
 *
 * Cost-only. This creates purchase orders, lines and cost layers, and does NOT
 * touch a single quantity column: those goods were received months ago and are
 * already counted. Replaying them as receipts would double every canvas in the
 * building.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/import-sanhome.ts          # dry run
 *   npx tsx --tsconfig tsconfig.json scripts/import-sanhome.ts --write
 *
 * Re-running is safe: an invoice already loaded (same supplier, number and
 * date) is skipped rather than duplicated. The supplier has reused an invoice
 * number, so the date is part of the identity.
 */

import { prisma } from "../src/lib/prisma";
import invoiceData from "./data/sanhome-invoices.json";
import { allocateCosts, landedUnitCost, round2 } from "../src/lib/costing";

const WRITE = process.argv.includes("--write");
const UNDO = process.argv.includes("--undo");

/** Supplier style names vs what we call the design. Only where a normalised
 *  comparison cannot get there on its own — each one is a judgement, so each
 *  one is written down rather than inferred by a looser matcher. */
const ALIASES: Record<string, string> = {
  "red sox hotdog": "Fenway Frank",
  hydrangas: "Hydrangea",
  "hydrangea bike": "Hydrangea Bike",
  "world cup": "World Cup Ball",
  "lemon fob": "Lemon Key Fob",
  southie: "Southie Sign",
  "new england v everyone": "New England vs Everyone",
  citgo: "Citgo Sign",
  "patriot pl street sign": "Patriot Place",
  "comm ave street sign": "Comm Ave",
  "newbury street sign": "Newbury Street",
  "pats #10 jersey": "Pats #10 Jersey",
  "summer should be fun": "Summer Should Be Fun",
  "tell your dog i say hi": "Tell Your Dog I Say Hi",
  "this is why we can't have nice things": "This Is Why We Can't Have Nice Things",
  "lobster matchbox": "Lobster Matchbox",
  "cowboy pup": "Cowboy Pup",
  "shamrock beer": "Shamrock Beer",
  "surf's up": "Surf's Up",
  "palm tree": "Palm Tree Intro Kit",
  pretzel: "Pretzel Intro Kit",
  duck: "Duck Intro Kit",
  lightning: "Lightning Intro Kit",
  "après ski": "Apres Ski",
  "main st": "Main Street",
  "halloween cat": "Spooky Cat",
  "christmas kitty": "Christmas Kitty Ornament",
};

const norm = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "").trim();

async function main() {
  // Print versions are excluded outright. They are a rendering artefact of a
  // real design, never something a supplier ships, and because the matcher
  // strips parentheses "Anchor (18ct) (Print)" collides with "Anchor" — which
  // put 31 of 101 cost layers on designs holding no stock the first time.
  const designs = await prisma.design.findMany({
    where: { deletedAt: null, printVersionOf: null },
    select: { id: true, name: true, meshCount: true, archivedAt: true },
  });
  // Exact name wins over the loose, paren-stripped key.
  const byExact = new Map<string, typeof designs>();
  for (const d of designs) {
    const k = d.name.toLowerCase().trim();
    byExact.set(k, [...(byExact.get(k) ?? []), d]);
  }
  const byNorm = new Map<string, typeof designs>();
  for (const d of designs) {
    const k = norm(d.name);
    byNorm.set(k, [...(byNorm.get(k) ?? []), d]);
  }

  /** Prefer a live design of the right mesh over an archived or wrong-mesh
   *  namesake — several designs exist in both 13ct and 18ct. */
  const pick = (cands: typeof designs, mesh?: number) => {
    if (cands.length === 1) return cands[0];
    const live = cands.filter((c) => !c.archivedAt);
    const pool = live.length ? live : cands;
    return pool.find((c) => c.meshCount === mesh) ?? pool[0];
  };

  const resolve = (name: string, mesh?: number) => {
    const alias = ALIASES[name.toLowerCase().trim()];
    if (alias) {
      const e = byExact.get(alias.toLowerCase().trim());
      if (e) return { design: pick(e, mesh), how: "alias" as const };
      const c = byNorm.get(norm(alias));
      if (c) return { design: pick(c, mesh), how: "alias~" as const };
    }
    const e = byExact.get(name.toLowerCase().trim());
    if (e) return { design: pick(e, mesh), how: "exact" as const };
    const c = byNorm.get(norm(name));
    if (c) return { design: pick(c, mesh), how: "loose" as const };
    return { design: null, how: "none" as const };
  };

  let matched = 0;
  const unmatched: { invoice: string; name: string; qty: number; value: number }[] = [];
  const plans: any[] = [];

  for (const inv of invoiceData.invoices) {
    const goods = round2(sum(inv.lines.map((l) => l.qty * l.unit)));
    // Freight and duty are capitalised; the Alibaba fee is derived from what
    // was actually paid, so it reflects reality rather than an assumed rate.
    const paidTotal =
      inv.paid.amount + ((inv.paid as any).second?.amount ?? 0);
    const invoiced = round2(goods + inv.freight - ((inv as any).discount ?? 0));
    const fee = round2(paidTotal - invoiced);

    const toAllocate = round2(inv.freight + fee - ((inv as any).discount ?? 0));
    const allocatable = inv.lines.map((l, i) => ({
      id: String(i),
      quantity: l.qty,
      unitCost: l.unit,
    }));
    const alloc = allocateCosts(allocatable, toAllocate, "value");

    const lines = inv.lines.map((l, i) => {
      const kind = (l as any).kind ?? "canvas";
      const r = kind === "supply" ? { design: null, how: "supply" as const }
                                  : resolve(l.name, (l as any).mesh);
      if (r.design) matched++;
      else if (kind !== "supply")
        unmatched.push({ invoice: inv.number, name: l.name, qty: l.qty, value: round2(l.qty * l.unit) });
      const allocated = alloc.get(String(i)) ?? 0;
      return {
        kind,
        name: l.name,
        designId: r.design?.id ?? null,
        designName: r.design?.name ?? null,
        how: r.how,
        qty: l.qty,
        unit: l.unit,
        allocated,
        landed: landedUnitCost(l.qty, l.unit, allocated),
      };
    });

    plans.push({ inv, goods, fee, invoiced, paidTotal, toAllocate, lines });
  }

  // ---- report -------------------------------------------------------------
  console.log(`${plans.length} invoices, ${plans.reduce((s, p) => s + p.lines.length, 0)} lines`);
  console.log(`matched to a design: ${matched}`);
  console.log(`unmatched: ${unmatched.length}\n`);

  for (const p of plans) {
    console.log(`${p.inv.number}  ${p.inv.date}  goods $${p.goods.toLocaleString()}  freight $${p.inv.freight}  fee $${p.fee}  -> allocating $${p.toAllocate}`);
  }

  if (unmatched.length) {
    console.log(`\nNOT MATCHED — these need an alias or a design:`);
    for (const u of unmatched)
      console.log(`  ${u.invoice}  ${u.name}  x${u.qty}  $${u.value}`);
  }

  // A few landed costs, to eyeball against the invoices.
  console.log(`\nSample landed unit costs:`);
  for (const p of plans.slice(0, 3))
    for (const l of p.lines.slice(0, 3))
      console.log(`  ${p.inv.number} ${l.name.padEnd(30)} ${l.qty} @ $${l.unit} + $${l.allocated} alloc = $${l.landed}/unit`);

  if (UNDO) {
    // Safe reversal of this import: cost layers and lines cascade from the
    // purchase orders. It only ever touches this supplier's orders, and since
    // the import never created receipts, no quantity can be affected.
    const sup = await prisma.supplier.findUnique({ where: { name: invoiceData.supplier.name } });
    if (!sup) { console.log("nothing to undo"); return; }
    const lineIds = (await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrder: { supplierId: sup.id } }, select: { id: true },
    })).map((l) => l.id);
    // Deleted explicitly rather than trusting the cascade, so this also clears
    // layers orphaned by a rollback run before the cascade existed.
    const layers = await prisma.costLayer.deleteMany({
      where: { OR: [{ lineId: { in: lineIds } }, { lineId: null, source: "purchase" }] },
    });
    const gone = await prisma.purchaseOrder.deleteMany({ where: { supplierId: sup.id } });
    console.log(`rolled back ${gone.count} purchase orders and ${layers.count} cost layers`);
    return;
  }

  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write.`);
    return;
  }

  // ---- write --------------------------------------------------------------
  const supplier = await prisma.supplier.upsert({
    where: { name: invoiceData.supplier.name },
    update: {},
    create: {
      name: invoiceData.supplier.name,
      contact: invoiceData.supplier.contact,
      currency: invoiceData.supplier.currency,
      notes: invoiceData.supplier.notes,
    },
  });

  let created = 0;
  let skipped = 0;

  for (const p of plans) {
    // Identity is supplier + number + DATE: this supplier has reused a number.
    const existing = await prisma.purchaseOrder.findFirst({
      where: {
        supplierId: supplier.id,
        invoiceNumber: p.inv.number,
        orderDate: new Date(p.inv.date),
      },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          supplierId: supplier.id,
          invoiceNumber: p.inv.number,
          status: "received",
          orderDate: new Date(p.inv.date),
          paidDate: new Date(p.inv.paid.date),
          shippingCost: p.inv.freight,
          discount: (p.inv as any).discount ?? 0,
          paymentFee: p.fee,
          feeInLandedCost: true,
          allocationMethod: "value",
          // Freight was invoiced as a single figure for the whole shipment, so
          // every per-unit cost here is an allocation, not a supplier number.
          costsEstimated: true,
          notes: [
            p.inv.freightNote,
            (p.inv as any).discountNote,
            (p.inv as any).duplicateNumberNote,
            (p.inv as any).note,
            (p.inv.paid as any).note,
            `Paid $${p.paidTotal.toFixed(2)} vs $${p.invoiced.toFixed(2)} invoiced (Alibaba fee).`,
          ].filter(Boolean).join(" "),
        },
      });

      for (const l of p.lines) {
        const line = await tx.purchaseOrderLine.create({
          data: {
            purchaseOrderId: po.id,
            kind: l.kind,
            designId: l.designId,
            supplierDescription: l.name,
            quantity: l.qty,
            unitCost: l.unit,
            allocatedCost: l.allocated,
            landedUnitCost: l.landed,
          },
        });

        // Cost layer WITHOUT a receipt. These goods arrived months ago and are
        // already in the quantity columns; creating receipts would re-add
        // every one of them. `remaining` starts at the full quantity and is
        // drawn down by consumption, which is computed periodically.
        await tx.costLayer.create({
          data: {
            lineId: line.id,
            kind: l.kind,
            designId: l.designId,
            quantity: l.qty,
            remaining: l.qty,
            landedUnitCost: l.landed,
            receivedAt: new Date(p.inv.date),
            source: "purchase",
            estimated: true,
            notes: "Historical import: freight and payment fee allocated by value.",
          },
        });
      }
    }, { timeout: 30000 });
    created++;
  }

  console.log(`\nwrote ${created} purchase orders, skipped ${skipped} already present`);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

main().finally(() => prisma.$disconnect());

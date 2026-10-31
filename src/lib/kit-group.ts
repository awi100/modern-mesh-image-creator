/**
 * Writing kit stock.
 *
 * Server only — these take a Prisma transaction. The pure read helpers are in
 * kit-pool.ts, which client components can import; this file cannot be, since
 * it pulls in the Prisma runtime.
 */

import { Prisma } from "@prisma/client";
import { KIT_FIELDS, type KitLocation } from "./kit-pool";

// Re-exported so server code has one import for both halves.
export * from "./kit-pool";

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Lock the kit-group rows a deduction is about to change.
 *
 * Same race as lockDesigns guards, one step removed: two orders for DIFFERENT
 * street signs now contend for the same pool, so locking their design rows no
 * longer serialises them. Sorted for the same deadlock-freedom reason.
 */
export async function lockKitGroups(
  tx: Prisma.TransactionClient,
  groupIds: string[],
): Promise<void> {
  const ids = [...new Set(groupIds.filter(Boolean))].sort();
  if (ids.length === 0) return;
  await tx.$executeRaw`SELECT id FROM kit_groups WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
}

/**
 * Take `requested` kits for a design at one location, clamped to what is there.
 *
 * Reads inside the call rather than taking a count from the caller, so several
 * members of one group drawing in the same transaction each see the pool as the
 * earlier ones left it. A caller that cached the figure would let two street
 * signs in one order both clamp against the same opening balance.
 *
 * Returns what was actually taken, which is what the audit row should record.
 */
export async function deductKits(
  tx: Prisma.TransactionClient,
  designId: string,
  location: KitLocation,
  requested: number,
): Promise<{ deducted: number; from: "group" | "design"; groupId: string | null }> {
  if (!(requested > 0)) return { deducted: 0, from: "design", groupId: null };
  const field = KIT_FIELDS[location];

  const design = await tx.design.findUnique({
    where: { id: designId },
    select: { kitGroupId: true, kitsReady: true, marketKitsReady: true, kitsAndover: true },
  });
  if (!design) return { deducted: 0, from: "design", groupId: null };

  if (design.kitGroupId) {
    const group = await tx.kitGroup.findUnique({
      where: { id: design.kitGroupId },
      select: { kitsReady: true, marketKitsReady: true, kitsAndover: true },
    });
    if (!group) return { deducted: 0, from: "design", groupId: null };
    // Floored at 0 for the same reason the design path is: Math.min alone
    // returns a negative deduction when the pool is already negative.
    const deducted = Math.max(0, Math.min(requested, group[field]));
    if (deducted > 0) {
      await tx.kitGroup.update({
        where: { id: design.kitGroupId },
        data: { [field]: { decrement: deducted } },
      });
    }
    return { deducted, from: "group", groupId: design.kitGroupId };
  }

  const deducted = Math.max(0, Math.min(requested, design[field]));
  if (deducted > 0) {
    await tx.design.update({ where: { id: designId }, data: { [field]: { decrement: deducted } } });
  }
  return { deducted, from: "design", groupId: null };
}

/** Put kits back — an unfulfil, or a cancelled order. */
export async function restoreKits(
  tx: Prisma.TransactionClient,
  designId: string,
  location: KitLocation,
  units: number,
): Promise<void> {
  if (!(units > 0)) return;
  const field = KIT_FIELDS[location];
  const design = await tx.design.findUnique({
    where: { id: designId },
    select: { kitGroupId: true },
  });
  if (!design) return;
  if (design.kitGroupId) {
    await tx.kitGroup.update({ where: { id: design.kitGroupId }, data: { [field]: { increment: units } } });
  } else {
    await tx.design.update({ where: { id: designId }, data: { [field]: { increment: units } } });
  }
}

/** Set a kit count outright, on the group when the design is in one. */
export async function setKits(
  tx: Prisma.TransactionClient,
  designId: string,
  location: KitLocation,
  value: number,
): Promise<number> {
  const field = KIT_FIELDS[location];
  const v = Math.max(0, Math.floor(value));
  const design = await tx.design.findUnique({ where: { id: designId }, select: { kitGroupId: true } });
  if (!design) return 0;
  if (design.kitGroupId) {
    await tx.kitGroup.update({ where: { id: design.kitGroupId }, data: { [field]: v } });
  } else {
    await tx.design.update({ where: { id: designId }, data: { [field]: v } });
  }
  return v;
}

/**
 * Apply a signed delta to a kit count, floored at 0.
 *
 * A delta rather than an absolute value because the UI's +/- buttons would
 * otherwise write a figure computed from a stale render: if a sale landed
 * between the render and the tap, an absolute write both invents a kit and
 * partly erases the sale. This matters more for a shared pool, where five
 * screens can be looking at the same number.
 */
export async function adjustKits(
  tx: Prisma.TransactionClient,
  designId: string,
  location: KitLocation,
  delta: number,
): Promise<number> {
  const field = KIT_FIELDS[location];
  const d = Math.trunc(delta);
  const design = await tx.design.findUnique({
    where: { id: designId },
    select: { kitGroupId: true, kitsReady: true, marketKitsReady: true, kitsAndover: true },
  });
  if (!design) return 0;

  if (design.kitGroupId) {
    const group = await tx.kitGroup.findUnique({
      where: { id: design.kitGroupId },
      select: { kitsReady: true, marketKitsReady: true, kitsAndover: true },
    });
    if (!group) return 0;
    const next = Math.max(0, group[field] + d);
    await tx.kitGroup.update({ where: { id: design.kitGroupId }, data: { [field]: next } });
    return next;
  }

  const next = Math.max(0, design[field] + d);
  await tx.design.update({ where: { id: designId }, data: { [field]: next } });
  return next;
}

/** Move kits between locations, clamped to the source. */
export async function moveKits(
  tx: Prisma.TransactionClient,
  designId: string,
  from: KitLocation,
  to: KitLocation,
  qty: number,
): Promise<number> {
  if (from === to || !(qty > 0)) return 0;
  const fromField = KIT_FIELDS[from];
  const toField = KIT_FIELDS[to];
  const design = await tx.design.findUnique({
    where: { id: designId },
    select: { kitGroupId: true, kitsReady: true, marketKitsReady: true, kitsAndover: true },
  });
  if (!design) return 0;

  if (design.kitGroupId) {
    const group = await tx.kitGroup.findUnique({
      where: { id: design.kitGroupId },
      select: { kitsReady: true, marketKitsReady: true, kitsAndover: true },
    });
    if (!group) return 0;
    const moved = Math.min(Math.floor(qty), group[fromField]);
    if (moved > 0) {
      await tx.kitGroup.update({
        where: { id: design.kitGroupId },
        data: { [fromField]: { decrement: moved }, [toField]: { increment: moved } },
      });
    }
    return moved;
  }

  const moved = Math.min(Math.floor(qty), design[fromField]);
  if (moved > 0) {
    await tx.design.update({
      where: { id: designId },
      data: { [fromField]: { decrement: moved }, [toField]: { increment: moved } },
    });
  }
  return moved;
}

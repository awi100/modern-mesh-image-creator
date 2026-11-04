/**
 * Writing kit stock.
 *
 * Server only — these take a Prisma transaction. The pure read helpers are in
 * kit-pool.ts, which client components can import; this file cannot be, since
 * it pulls in the Prisma runtime.
 */

import { Prisma } from "@prisma/client";
import { KIT_FIELDS, type KitLocation } from "./kit-pool";
import { drawFrom } from "./stock-draw";

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
 * Take `requested` kits for a design, drawing on its location first and then on
 * Andover bulk.
 *
 * Reads inside the call rather than taking a count from the caller, so several
 * members of one group drawing in the same transaction each see the pool as the
 * earlier ones left it. A caller that cached the figure would let two street
 * signs in one order both clamp against the same opening balance.
 *
 * Returns the split, which is what the audit row should record: an undo has to
 * put each unit back where it came from.
 */
export async function deductKits(
  tx: Prisma.TransactionClient,
  designId: string,
  location: KitLocation,
  requested: number,
): Promise<{ deducted: number; fromAndover: number; short: number; from: "group" | "design"; groupId: string | null }> {
  const none = { deducted: 0, fromAndover: 0, short: 0, from: "design" as const, groupId: null };
  if (!(requested > 0)) return none;
  const field = KIT_FIELDS[location];

  const design = await tx.design.findUnique({
    where: { id: designId },
    select: { kitGroupId: true, kitsReady: true, marketKitsReady: true, kitsAndover: true },
  });
  if (!design) return none;

  // Andover is already the primary bucket for an andover-located draw; there is
  // nothing further to fall back to.
  const useAndover = location !== "andover";

  if (design.kitGroupId) {
    const group = await tx.kitGroup.findUnique({
      where: { id: design.kitGroupId },
      select: { kitsReady: true, marketKitsReady: true, kitsAndover: true },
    });
    if (!group) return none;
    const d = drawFrom(requested, group[field], useAndover ? group.kitsAndover : 0);
    if (d.total > 0) {
      await tx.kitGroup.update({
        where: { id: design.kitGroupId },
        data: {
          ...(d.fromPrimary > 0 ? { [field]: { decrement: d.fromPrimary } } : {}),
          ...(d.fromAndover > 0 ? { kitsAndover: { decrement: d.fromAndover } } : {}),
        },
      });
    }
    return { deducted: d.total, fromAndover: d.fromAndover, short: d.short, from: "group", groupId: design.kitGroupId };
  }

  const d = drawFrom(requested, design[field], useAndover ? design.kitsAndover : 0);
  if (d.total > 0) {
    await tx.design.update({
      where: { id: designId },
      data: {
        ...(d.fromPrimary > 0 ? { [field]: { decrement: d.fromPrimary } } : {}),
        ...(d.fromAndover > 0 ? { kitsAndover: { decrement: d.fromAndover } } : {}),
      },
    });
  }
  return { deducted: d.total, fromAndover: d.fromAndover, short: d.short, from: "design", groupId: null };
}

/** Put kits back — an unfulfil, or a cancelled order. */
export async function restoreKits(
  tx: Prisma.TransactionClient,
  designId: string,
  location: KitLocation,
  units: number,
  fromAndover = 0,
): Promise<void> {
  if (!(units > 0)) return;
  const field = KIT_FIELDS[location];
  // Each unit goes back where it came from. Crediting an Andover draw to home
  // would quietly move stock between two real places.
  const toAndover = Math.min(Math.max(0, fromAndover), units);
  const toPrimary = units - toAndover;
  const data = {
    ...(toPrimary > 0 ? { [field]: { increment: toPrimary } } : {}),
    ...(toAndover > 0 ? { kitsAndover: { increment: toAndover } } : {}),
  };
  const design = await tx.design.findUnique({
    where: { id: designId },
    select: { kitGroupId: true },
  });
  if (!design) return;
  if (design.kitGroupId) {
    await tx.kitGroup.update({ where: { id: design.kitGroupId }, data });
  } else {
    await tx.design.update({ where: { id: designId }, data });
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

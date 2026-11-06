/**
 * Print colour revisions.
 *
 * A design's `printColorOverrides` is only ever the current setting. Every
 * reorder nudges a few hexes to make the printed canvas truer, and without a
 * record the previous mix is gone the moment a slider moves — so there is no
 * way to tell whether this run came out better than the last, or to go back.
 *
 * Revisions are append-only. Restoring one writes its values forward as a new
 * revision rather than deleting what came after, because the history of what
 * was actually sent to a printer is the useful thing; a tidied history is not.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

export type RevisionSource = "baseline" | "print" | "manual" | "restore";

export type Overrides = Record<string, string>;

type Db = PrismaClient | Prisma.TransactionClient;

/** Parse a stored override blob, tolerating null and malformed JSON. */
export function parseOverrides(raw: string | null | undefined): Overrides {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Overrides) : {};
  } catch {
    return {};
  }
}

/** Two override sets are the same if they map the same DMC numbers to the same
 *  hexes. Key order is irrelevant, so a re-save that changed nothing does not
 *  earn a revision. */
export function sameOverrides(a: Overrides, b: Overrides): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (a[k] ?? "").toLowerCase() === (b[k] ?? "").toLowerCase());
}

/** What changed between two revisions, for showing a history entry. */
export interface OverrideDiff {
  dmcNumber: string;
  from: string | null;
  to: string | null;
}

export function diffOverrides(prev: Overrides, next: Overrides): OverrideDiff[] {
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort();
  const out: OverrideDiff[] = [];
  for (const k of keys) {
    const from = prev[k] ?? null;
    const to = next[k] ?? null;
    if ((from ?? "").toLowerCase() !== (to ?? "").toLowerCase()) out.push({ dmcNumber: k, from, to });
  }
  return out;
}

/**
 * Record a revision, unless it would duplicate the newest one.
 *
 * Returns the revision, or null when nothing was recorded. The de-duplication
 * matters because the colours page auto-saves on a debounce: without it, every
 * pause while dragging a slider would leave its own entry and the history would
 * be unreadable within one sitting.
 */
export async function recordRevision(
  db: Db,
  designId: string,
  overrides: Overrides,
  source: RevisionSource,
  note?: string | null,
) {
  const latest = await db.printColorRevision.findFirst({
    where: { designId },
    orderBy: { createdAt: "desc" },
  });
  if (latest && sameOverrides(parseOverrides(latest.overrides), overrides)) return null;
  return db.printColorRevision.create({
    data: { designId, overrides: JSON.stringify(overrides), source, note: note ?? null },
  });
}

/**
 * Capture what the colours were BEFORE an edit, the first time one happens.
 *
 * Without this the oldest thing a design can show is the state after someone
 * already changed it — "what it was last time" would be lost on the very first
 * adjustment, which is the one case the history exists for.
 */
export async function ensureBaseline(db: Db, designId: string, current: Overrides) {
  const count = await db.printColorRevision.count({ where: { designId } });
  if (count > 0) return null;
  return db.printColorRevision.create({
    data: {
      designId,
      overrides: JSON.stringify(current),
      source: "baseline",
      note: Object.keys(current).length
        ? "In use before revisions were tracked"
        : "No adjustments before revisions were tracked",
    },
  });
}

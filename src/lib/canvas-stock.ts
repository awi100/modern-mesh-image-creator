/**
 * Moving canvas stock.
 *
 * The mirror of deductKits/restoreKits in kit-group.ts, for the canvas columns.
 * Canvases have no pool concept — only thread is interchangeable between
 * designs — so this is simpler: the design's own three columns, nothing shared.
 *
 * It exists because all three Shopify deduction paths compute the canvas draw
 * inline, which is how a fix landed in one path and not the others more than
 * once. Ticket Tailor goes through here instead of adding a fourth copy.
 *
 * NOTE: the Shopify paths are deliberately NOT moved onto this yet — that is a
 * follow-up, so this build cannot break a working deduction while adding a new
 * one.
 */

import { Prisma } from "@prisma/client";
import { CANVAS_FIELDS, type KitLocation } from "./kit-pool";
import { drawFrom } from "./stock-draw";

type Db = Prisma.TransactionClient;

/** The same three places a kit can be. "andover" as a primary is only used by
 *  a direct adjustment; a sale draws home-or-market and falls back to Andover. */
export type CanvasLocation = KitLocation;

export interface CanvasDraw {
  deducted: number;
  fromAndover: number;
  short: number;
}

/**
 * Take `requested` canvases for a design, drawing on `location` first and then
 * on Andover bulk.
 *
 * Reads inside the call rather than trusting a count from the caller, so two
 * tickets for the same design in one transaction each see the stock as the
 * previous one left it. A cached figure would let both clamp against the same
 * opening balance — the race that logged orders #3580/#3583 as -1.
 *
 * Returns the split, which is what the audit row must record: a reversal has to
 * credit each unit back where it came from.
 */
export async function deductCanvas(
  db: Db,
  designId: string,
  location: CanvasLocation,
  requested: number,
): Promise<CanvasDraw> {
  if (!(requested > 0)) return { deducted: 0, fromAndover: 0, short: 0 };
  const field = CANVAS_FIELDS[location];

  const design = await db.design.findUnique({
    where: { id: designId },
    select: { canvasPrinted: true, marketCanvasPrinted: true, canvasAndover: true },
  });
  if (!design) return { deducted: 0, fromAndover: 0, short: requested };

  // Andover is already the primary for an andover-located draw, so there is
  // nothing further to fall through to.
  const useAndover = location !== "andover";
  const d = drawFrom(requested, design[field], useAndover ? design.canvasAndover : 0);

  if (d.total > 0) {
    await db.design.update({
      where: { id: designId },
      data: {
        ...(d.fromPrimary > 0 ? { [field]: { decrement: d.fromPrimary } } : {}),
        ...(d.fromAndover > 0 ? { canvasAndover: { decrement: d.fromAndover } } : {}),
      },
    });
  }
  return { deducted: d.total, fromAndover: d.fromAndover, short: d.short };
}

/**
 * Put canvases back.
 *
 * `fromAndover` is how many of them came out of Andover, so they return there
 * rather than to the chosen bucket — crediting an Andover draw to home would
 * move stock between two real places on paper.
 */
export async function restoreCanvas(
  db: Db,
  designId: string,
  location: CanvasLocation,
  units: number,
  fromAndover = 0,
): Promise<void> {
  if (!(units > 0)) return;
  const field = CANVAS_FIELDS[location];
  const toAndover = Math.min(Math.max(0, fromAndover), units);
  const toPrimary = units - toAndover;

  const design = await db.design.findUnique({ where: { id: designId }, select: { id: true } });
  if (!design) return;

  await db.design.update({
    where: { id: designId },
    data: {
      ...(toPrimary > 0 ? { [field]: { increment: toPrimary } } : {}),
      ...(toAndover > 0 ? { canvasAndover: { increment: toAndover } } : {}),
    },
  });
}

/** How a restore splits between the bucket and Andover. Pure, so the split can
 *  be tested without a database. */
export function restoreSplit(units: number, fromAndover: number): { toPrimary: number; toAndover: number } {
  const u = Math.max(0, Math.floor(units));
  const toAndover = Math.min(Math.max(0, Math.floor(fromAndover)), u);
  return { toPrimary: u - toAndover, toAndover };
}

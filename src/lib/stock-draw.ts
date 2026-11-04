/**
 * Where a sale's units come from.
 *
 * An order draws on its own bucket first — home for an online order, the tote
 * for a POS one — and falls back to Andover bulk storage when that bucket runs
 * out. Before this existed the clamp simply stopped at the empty bucket and the
 * deduction took nothing: 55 deduction rows came up short that way, every one a
 * sale that left no trace in any count, invisible to the consumption maths as
 * well as to the shelf.
 *
 * Andover is still a real place, so a draw from it does NOT mean anyone went
 * and fetched a canvas — the shelf at Andover will be right only after the next
 * pickup. That is a known cost of the fallback: the alternative was a count
 * that silently diverged from reality on every oversold order, which is worse,
 * because nothing ever flagged it.
 *
 * A POS sale does not fall back to home. Market stock is deliberately separate
 * — stock moves to the tote as an explicit transfer and never drifts back on
 * its own — so the tote falls through to Andover and skips home entirely.
 */

export interface Draw {
  /** Taken from the order's own bucket (home for online, tote for POS). */
  fromPrimary: number;
  /** Taken from Andover bulk because the primary bucket ran out. */
  fromAndover: number;
  /** Total actually taken. */
  total: number;
  /** Units the sale wanted that nothing could cover. */
  short: number;
}

/**
 * Split `requested` units across the primary bucket and Andover.
 *
 * Negative balances are floored to zero rather than treated as capacity: a
 * bucket already at -1 has nothing to give, and letting Math.min see the
 * negative returns a negative deduction, which is how orders #3580 and #3583
 * came to be logged as "kits 0 -> -1".
 */
export function drawFrom(requested: number, primary: number, andover: number): Draw {
  const want = Math.max(0, Math.floor(requested));
  const fromPrimary = Math.min(want, Math.max(0, primary));
  const fromAndover = Math.min(want - fromPrimary, Math.max(0, andover));
  const total = fromPrimary + fromAndover;
  return { fromPrimary, fromAndover, total, short: want - total };
}

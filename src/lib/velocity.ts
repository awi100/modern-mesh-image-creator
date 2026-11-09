import { prisma } from "@/lib/prisma";
import { RETAIL } from "@/lib/order-kind";

/**
 * Sales rate per design, computed LIVE from order history.
 *
 * There is a `Design.salesVelocity` column, written by a manual "Recalculate"
 * button and by nothing else. It was last written on 27 Feb and is NULL on
 * every one of the 86 live designs — so anything reading it reported
 * `kitsReady > 0 ? 999 weeks : 0`, i.e. "healthy" for everything with stock and
 * "critical" for everything without, dressed up as a velocity figure. Stock
 * Alerts, the Velocity page and the Order Builder all sized decisions off that.
 *
 * /inventory/reorder never used the column — it computed the rate from orders
 * on each request and was correct the whole time. This is that computation,
 * lifted out so every caller shares it. A number derived on read cannot go
 * stale, which removes the failure mode rather than scheduling around it.
 */

export const VELOCITY_WINDOW_DAYS = 90;

/**
 * The population every demand calculation must use: fulfilled orders, windowed
 * by the REAL order date, and **retail only**.
 *
 * The `kind` filter is what keeps a donation, a damaged-goods replacement or a
 * half-price wholesale order out of the sales rate. All three deduct stock —
 * the unit left the building — but none of them is a customer wanting the
 * design, and the rate here sizes reorders, stock alerts and the kit order. One
 * 30-unit wholesale order would otherwise read as 2.3 units/week of fresh
 * retail demand for a year. See lib/order-kind.
 *
 * The column defaults to "retail", so every order that predates it counts
 * exactly as it did before.
 *
 * Exported as one fragment because this `where` was duplicated, comment and
 * all, in four places (this file, /inventory/reorder, /inventory/velocity and
 * the kit-order-planner skill) — four chances for the next filter to be added
 * to three of them.
 */
export function retailDemandWhere(windowStart: Date) {
  return {
    fulfilledAt: { not: null },
    kind: RETAIL,
    OR: [
      { orderDate: { gte: windowStart } },
      { orderDate: null, createdAt: { gte: windowStart } },
    ],
  };
}

/** The matching line-item filter: only rows an actual deduction processed. */
export const PROCESSED_DESIGN_ITEMS = { designId: { not: null }, processed: true } as const;

export interface VelocityRow {
  /** Units sold in the window. */
  units: number;
  /** Units per week. */
  perWeek: number;
}

/**
 * Units sold per design over the trailing window.
 *
 * Population matches /inventory/reorder exactly, because both now share
 * `retailDemandWhere`: fulfilled retail orders only, processed line items only,
 * windowed by the real order date with a fallback to row createdAt for the
 * 2,391 legacy rows that predate orderDate — so a bulk backfill can't dump
 * historical orders into the current window.
 */
export async function salesInWindow(windowDays = VELOCITY_WINDOW_DAYS): Promise<Map<string, number>> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const orders = await prisma.shopifyOrder.findMany({
    where: retailDemandWhere(windowStart),
    select: {
      items: {
        where: PROCESSED_DESIGN_ITEMS,
        select: { designId: true, quantity: true },
      },
    },
  });

  const sold = new Map<string, number>();
  for (const o of orders) {
    for (const it of o.items) {
      if (it.designId) sold.set(it.designId, (sold.get(it.designId) || 0) + it.quantity);
    }
  }
  return sold;
}

/**
 * Weekly rate for one design.
 *
 * Never divides by more days than the design has existed, so a design launched
 * two weeks ago isn't averaged over 90 days and made to look dead.
 */
export function weeklyRate(units: number, createdAt: Date, windowDays = VELOCITY_WINDOW_DAYS): number {
  const ageDays = Math.max(1, (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
  const effectiveDays = Math.min(windowDays, ageDays);
  return units / (effectiveDays / 7);
}

/** Bucket a weekly rate the way the velocity view labels it. */
export function categorise(perWeek: number, units: number): "fast" | "medium" | "slow" | "new" {
  if (units === 0) return "new";
  if (perWeek >= 3) return "fast";
  if (perWeek >= 1) return "medium";
  return "slow";
}

/** Default weeks of cover we want, by how fast it sells. */
export function targetWeeksFor(category: string | null | undefined): number {
  switch (category) {
    case "fast": return 4;
    case "medium": return 6;
    case "slow": return 8;
    default: return 6;
  }
}

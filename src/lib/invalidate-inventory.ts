import { mutate } from "swr";

// Keys whose data reflects inventory / stock / kit / supply state. After ANY
// write that changes stock, kits, canvas, market, Andover, supplies, misprints,
// or bobbins, call invalidateInventory() so every page reading these keys
// refetches — no matter which page made the change. This is what makes an
// adjustment on one page show up immediately on all the others.
const INVENTORY_KEY_PREFIXES = [
  "/api/inventory",     // thread skeins, alerts, reorder, bobbins, deductions
  "/api/kits",          // kit summaries (kitsReady, canvas, demand) — all mesh/archived variants
  "/api/colors/usage",  // per-color usage (all mesh variants)
  "/api/designs",       // design counts (kitsReady, canvasPrinted, market, Andover, misprint)
  "/api/supplies",      // supply quantities + market tote
  "/api/bundles",
  "/api/market",        // market-prep projection
  "/api/color-backups",
];

/**
 * Revalidate every inventory-related SWR cache entry across the app.
 * Predicate matching covers query-string variants (e.g. `/api/kits?meshCount=18`,
 * `/api/kits?includeArchived=true`) that a single exact-key mutate would miss.
 * Safe to call from any page — it's a no-op for keys no mounted component reads.
 */
export function invalidateInventory(): Promise<unknown> {
  return mutate(
    (key) =>
      typeof key === "string" &&
      INVENTORY_KEY_PREFIXES.some((p) => key.startsWith(p)),
    undefined, // don't set data — just trigger a background revalidation
    { revalidate: true },
  );
}

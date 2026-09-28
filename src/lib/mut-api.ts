import { invalidateInventory } from "@/lib/invalidate-inventory";

/**
 * `fetch` for any request that CHANGES stock, kits, canvases, market, Andover,
 * supplies, misprints or bobbins.
 *
 * On success it invalidates every inventory-related SWR key across the app, so
 * an edit made on one page shows up on all the others without a manual refresh.
 *
 * This lived as six identical copies, one per editable page, and the pages that
 * didn't have it used raw `fetch` — so an edit there silently left every other
 * page stale. Import it; don't re-declare it.
 */
export async function mutApi(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.ok) invalidateInventory();
  return res;
}

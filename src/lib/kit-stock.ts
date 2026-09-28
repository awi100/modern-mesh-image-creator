/**
 * Skeins you must have on hand for a colour to count as stocked.
 *
 * This mirrors the server's `skeinsToStock` (see the kit routes) and is the ONLY
 * number a client may compare inventory against. It is deliberately NOT
 * `skeinsNeeded`, which comes from a different, legacy heuristic in
 * yarn-calculator and disagrees with `fullSkeins` on roughly 19% of yardages —
 * cards displayed "Need 1 skein" while the colouring tested against 2, so
 * touching a stepper could flip a genuinely stocked colour red until the next
 * refetch.
 *
 * Lives in lib because three surfaces need it (inventory page kit panels, the
 * per-design kit page, the kits overview) and it had already drifted between them.
 */
export function skeinsToStock(item: { fullSkeins: number; bobbinYards: number }): number {
  return item.fullSkeins > 0 ? item.fullSkeins : item.bobbinYards > 0 ? 1 : 0;
}

/**
 * A row is in stock when the PRIMARY colour covers it or its BACKUP does —
 * the same rule the API applies.
 */
export function rowInStock(
  item: { fullSkeins: number; bobbinYards: number },
  primarySkeins: number,
  backupSkeins: number | null,
): { primaryInStock: boolean; backupInStock: boolean; inStock: boolean } {
  const need = skeinsToStock(item);
  const primaryInStock = primarySkeins >= need;
  const backupInStock = backupSkeins !== null && backupSkeins >= need;
  return { primaryInStock, backupInStock, inStock: primaryInStock || backupInStock };
}

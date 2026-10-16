/**
 * Which designs we buy thread for.
 *
 * 13ct intro kits now arrive from the supplier as FINISHED kits — canvas and
 * thread already packed. We never buy their thread, wind their bobbins or hold
 * their colours, so counting their colour requirements as demand invents
 * shopping-list lines, stock alerts and bobbin suggestions for thread nobody
 * will ever order. Seven DMC colours (19, 312, 33, 341, 3607, 3772, 3805)
 * exist in the catalogue for no other reason.
 *
 * It keys on mesh count because 13ct is exactly the intro-kit line today. If
 * an 18ct design is ever sourced finished, or a 13ct one is brought in house,
 * this becomes a per-design flag — one column and this one function.
 */
export function isSourcedKit(meshCount: number | null | undefined): boolean {
  return meshCount === 13;
}

/** True when we assemble this design ourselves and therefore buy its thread. */
export function needsThreadInventory(meshCount: number | null | undefined): boolean {
  return !isSourcedKit(meshCount);
}

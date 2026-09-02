// Shared mesh count filter for Prisma queries.
// Used by inventory alerts, bobbin analysis, kits, and color usage APIs.

export type MeshFilter =
  | "all"
  | "13"
  | "14"      // 14ct is retired (kept only for archived designs)
  | "18"
  | "order14" // deprecated — we stopped making 14ct intro kits; resolves to 18+13
  | "order13" // 18ct canvases + 13ct intro kits — the current product line
  | "order";  // alias of the current order view (18+13)

/**
 * Build a Prisma `where` clause for filtering designs by mesh count.
 *
 * - "all": no filter
 * - "13" | "14" | "18": only that mesh count
 * - "order" | "order13" | "order14": the current order/planning view — 18ct
 *   canvases + 13ct intro kits. ("order14" is deprecated: 14ct intro kits are
 *   retired, so it now resolves to the same 18+13 set.)
 */
export function meshCountWhere(meshFilter: string | null): Record<string, unknown> {
  if (meshFilter === "13") return { meshCount: 13 };
  if (meshFilter === "14") return { meshCount: 14 };
  if (meshFilter === "18") return { meshCount: 18 };
  if (meshFilter === "order" || meshFilter === "order13" || meshFilter === "order14") {
    return {
      OR: [
        { meshCount: 18 },
        { meshCount: 13 },
      ],
    };
  }
  return {}; // "all" — no filter
}

// Shared mesh count filter for Prisma queries.
// Used by inventory alerts, bobbin analysis, kits, and color usage APIs.

export type MeshFilter =
  | "all"
  | "13"
  | "14"
  | "16"
  | "18"
  | "order14"  // 18ct + 14ct intro designs
  | "order13"  // 18ct + all 13ct designs (all 13ct are intro)
  | "order";   // alias of order14 (kept for backward compat with sessionStorage)

/**
 * Build a Prisma `where` clause for filtering designs by mesh count.
 *
 * - "all": no filter
 * - "13" | "14" | "16" | "18": only that mesh count
 * - "order14": 18ct + 14ct designs with "intro" in the name (Size 5 thread set)
 * - "order13": 18ct + all 13ct designs (all 13ct are intro — Size 3 thread set)
 * - "order": alias for "order14" (preserved for older sessionStorage values)
 */
export function meshCountWhere(meshFilter: string | null): Record<string, unknown> {
  if (meshFilter === "13") return { meshCount: 13 };
  if (meshFilter === "14") return { meshCount: 14 };
  if (meshFilter === "16") return { meshCount: 16 };
  if (meshFilter === "18") return { meshCount: 18 };
  if (meshFilter === "order" || meshFilter === "order14") {
    return {
      OR: [
        { meshCount: 18 },
        { meshCount: 14, name: { contains: "intro", mode: "insensitive" } },
      ],
    };
  }
  if (meshFilter === "order13") {
    return {
      OR: [
        { meshCount: 18 },
        { meshCount: 13 },
      ],
    };
  }
  return {}; // "all" — no filter
}

// Shared mesh count filter for Prisma queries.
// Used by inventory alerts, bobbin analysis, kits, and color usage APIs.

export type MeshFilter = "all" | "14" | "18" | "order";

/**
 * Build a Prisma `where` clause for filtering designs by mesh count.
 *
 * - "all": no filter
 * - "14": only 14ct designs
 * - "18": only 18ct designs
 * - "order": 18ct + 14ct designs with "intro" in the name
 *   (the active order set — what gets manufactured going forward)
 */
export function meshCountWhere(meshFilter: string | null): Record<string, unknown> {
  if (meshFilter === "18") return { meshCount: 18 };
  if (meshFilter === "14") return { meshCount: 14 };
  if (meshFilter === "order") {
    return {
      OR: [
        { meshCount: 18 },
        { meshCount: 14, name: { contains: "intro", mode: "insensitive" } },
      ],
    };
  }
  return {}; // "all" — no filter
}

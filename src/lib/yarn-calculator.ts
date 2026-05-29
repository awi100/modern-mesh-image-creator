// Yarn usage calculator for needlepoint designs
// Uses yards-per-square-inch method: convert stitches to canvas area, then
// multiply by thread consumption rate per square inch.
//
// Thread sizes used:
//   13ct → Size 3 Pearl Cotton (16-yard skeins, thicker thread)
//   14/18ct → Size 5 Pearl Cotton (27-yard skeins)

export type MeshCount = 13 | 14 | 18;
export type ThreadSize = 3 | 5;

export interface YarnCalculationSettings {
  // Yards of thread needed to cover one square inch of canvas
  mesh13ContinentalYardsPerSqIn: number; // Size 3 thread
  mesh13BasketwaveYardsPerSqIn: number;  // Size 3 thread
  mesh14ContinentalYardsPerSqIn: number; // Size 5 thread
  mesh14BasketwaveYardsPerSqIn: number;
  mesh18ContinentalYardsPerSqIn: number;
  mesh18BasketwaveYardsPerSqIn: number;
}

export const DEFAULT_SETTINGS: YarnCalculationSettings = {
  // 13 mesh: 169 stitches/sq in, Size 3 thread (estimated)
  mesh13ContinentalYardsPerSqIn: 2.2,
  mesh13BasketwaveYardsPerSqIn: 2.5,
  // 14 mesh: 196 stitches/sq in, Size 5 thread
  mesh14ContinentalYardsPerSqIn: 2.1,
  mesh14BasketwaveYardsPerSqIn: 2.4,
  // 18 mesh: 324 stitches/sq in, Size 5 thread
  mesh18ContinentalYardsPerSqIn: 3.46,
  mesh18BasketwaveYardsPerSqIn: 3.98,
};

/** Thread size used for a given canvas mesh count. */
export function threadSizeForMesh(meshCount: MeshCount): ThreadSize {
  return meshCount === 13 ? 3 : 5;
}

/** Yards in a standard skein for a given thread size. */
export function skeinYardsForThread(threadSize: ThreadSize): number {
  return threadSize === 3 ? 16 : 27;
}

/** Yards in a standard skein for a given mesh count. */
export function skeinYardsForMesh(meshCount: MeshCount): number {
  return skeinYardsForThread(threadSizeForMesh(meshCount));
}

/** Bobbin yard thresholds for a given mesh count.
 *  Below `min`: finger-wrap from skein (no pre-made bobbin).
 *  Between min and max: pre-made bobbin (sized in whole yards).
 *  Above `max`: full skein.
 */
export function bobbinThresholdsForMesh(meshCount: MeshCount): { min: number; max: number } {
  // Size 3 (13ct) has smaller skeins, so thresholds are proportionally lower
  if (meshCount === 13) return { min: 1.5, max: 4 };
  return { min: 2.4, max: 5 };
}

export type StitchType = "continental" | "basketweave";

export interface YarnUsage {
  dmcNumber: string;
  stitchCount: number;
  squareInches: number;
  yarnYards: number;
  withBuffer: number; // yards with buffer
  skeinsNeeded: number;
  usesFullSkein: boolean; // true if > 4 yards needed, meaning full skein(s) used
}

// Standard DMC Pearl Cotton skein length in yards (Size 5 default; Size 3 = 16)
const SKEIN_YARDS = 27; // DMC Pearl Cotton #5 is approximately 27 yards

// Calculate a smart buffer that scales down for larger amounts.
// Buffer tiers are proportional to skein size (which differs by thread size).
function calculateSmartBuffer(yarnYards: number, bufferPercent: number, skeinYards: number = SKEIN_YARDS): number {
  // Tier 1: small (< skein/3) → full buffer
  // Tier 2: medium (< skein) → 60% of buffer
  // Tier 3: large (>= skein) → 40% of buffer
  const tier1 = skeinYards / 2.7; // ~10 yards for Size 5, ~6 yards for Size 3

  let effectiveBufferPercent: number;
  if (yarnYards < tier1) {
    effectiveBufferPercent = bufferPercent;
  } else if (yarnYards < skeinYards) {
    effectiveBufferPercent = bufferPercent * 0.6;
  } else {
    effectiveBufferPercent = bufferPercent * 0.4;
  }

  // Add buffer with minimum based on required yardage:
  // - Less than 1 yard needed: minimum 0.5 yard buffer
  // - 1+ yards needed: minimum 1 yard buffer
  const minBuffer = yarnYards < 1 ? 0.5 : 1;
  const bufferYards = Math.max(minBuffer, yarnYards * (effectiveBufferPercent / 100));
  return yarnYards + bufferYards;
}

// Get yards per square inch for a given mesh count and stitch type
function getYardsPerSqIn(
  meshCount: MeshCount,
  stitchType: StitchType,
  settings: YarnCalculationSettings
): number {
  const key = `mesh${meshCount}${stitchType === "continental" ? "Continental" : "Basketwave"}YardsPerSqIn` as keyof YarnCalculationSettings;
  return settings[key];
}

export function calculateYarnUsage(
  stitchCounts: Map<string, number>,
  meshCount: MeshCount,
  stitchType: StitchType,
  bufferPercent: number,
  settings: YarnCalculationSettings = DEFAULT_SETTINGS
): YarnUsage[] {
  const yardsPerSqIn = getYardsPerSqIn(meshCount, stitchType, settings);
  const skeinYards = skeinYardsForMesh(meshCount);

  // Stitches per square inch = meshCount²
  const stitchesPerSqIn = meshCount * meshCount;

  const results: YarnUsage[] = [];

  // Threshold for using full skeins vs wound portions.
  // Size 3 uses smaller bobbins (smaller skein), so threshold is proportional.
  const bobbinThresholds = bobbinThresholdsForMesh(meshCount);
  const FULL_SKEIN_THRESHOLD = bobbinThresholds.max;

  for (const [dmcNumber, stitchCount] of stitchCounts) {
    const squareInches = stitchCount / stitchesPerSqIn;
    const yarnYards = squareInches * yardsPerSqIn;
    const withBuffer = calculateSmartBuffer(yarnYards, bufferPercent, skeinYards);

    // If more than threshold needed, use full skein(s); otherwise wind the exact amount
    const usesFullSkein = withBuffer > FULL_SKEIN_THRESHOLD;

    // Calculate skeins needed, but be smart about it:
    // Don't add an extra skein just for a small buffer overage
    let skeinsNeeded: number;
    if (!usesFullSkein) {
      skeinsNeeded = 1;
    } else {
      const baseSkeins = Math.floor(yarnYards / skeinYards);
      const remainder = yarnYards - (baseSkeins * skeinYards);

      // If the raw yards fit in N skeins with reasonable headroom (>3 yards),
      // don't bump up to N+1 just because of buffer
      if (baseSkeins > 0 && remainder <= (skeinYards - 3)) {
        // Check if N skeins provide enough margin (at least 10% over raw yards)
        const totalFromBase = baseSkeins * skeinYards;
        if (totalFromBase >= yarnYards * 1.1) {
          skeinsNeeded = baseSkeins;
        } else {
          skeinsNeeded = Math.ceil(withBuffer / skeinYards);
        }
      } else {
        skeinsNeeded = Math.ceil(withBuffer / skeinYards);
      }
    }

    results.push({
      dmcNumber,
      stitchCount,
      squareInches: Math.round(squareInches * 100) / 100,
      yarnYards: Math.round(yarnYards * 100) / 100,
      withBuffer: Math.round(withBuffer * 100) / 100,
      skeinsNeeded,
      usesFullSkein,
    });
  }

  // Sort by stitch count descending
  results.sort((a, b) => b.stitchCount - a.stitchCount);

  return results;
}

export function getTotalYarnYards(usages: YarnUsage[]): number {
  return usages.reduce((sum, u) => sum + u.withBuffer, 0);
}

export function getTotalSkeins(usages: YarnUsage[]): number {
  return usages.reduce((sum, u) => sum + u.skeinsNeeded, 0);
}

export function getTotalStitches(usages: YarnUsage[]): number {
  return usages.reduce((sum, u) => sum + u.stitchCount, 0);
}

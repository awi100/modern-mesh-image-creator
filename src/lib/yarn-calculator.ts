// Yarn usage calculator for needlepoint designs
// Uses yards-per-square-inch method: convert stitches to canvas area, then
// multiply by thread consumption rate per square inch.

export interface YarnCalculationSettings {
  // Yards of thread needed to cover one square inch of canvas
  // Size 5 thread on 14 mesh (~76 inches / sq in for continental)
  mesh14ContinentalYardsPerSqIn: number;
  mesh14BasketwaveYardsPerSqIn: number;
  // Size 8 thread on 18 mesh (~96 inches / sq in for continental)
  mesh18ContinentalYardsPerSqIn: number;
  mesh18BasketwaveYardsPerSqIn: number;
}

export const DEFAULT_SETTINGS: YarnCalculationSettings = {
  mesh14ContinentalYardsPerSqIn: 2.1,  // ~76 inches per sq in
  mesh14BasketwaveYardsPerSqIn: 2.4,   // ~15% more than continental
  mesh18ContinentalYardsPerSqIn: 2.7,  // ~96 inches per sq in
  mesh18BasketwaveYardsPerSqIn: 3.1,   // ~15% more than continental
};

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

// Standard DMC Pearl Cotton skein length in yards
const SKEIN_YARDS = 27; // DMC Pearl Cotton #5 is approximately 27 yards

export function calculateYarnUsage(
  stitchCounts: Map<string, number>,
  meshCount: 14 | 18,
  stitchType: StitchType,
  bufferPercent: number,
  settings: YarnCalculationSettings = DEFAULT_SETTINGS
): YarnUsage[] {
  // Get yards per square inch based on mesh and stitch type
  let yardsPerSqIn: number;

  if (meshCount === 14) {
    yardsPerSqIn = stitchType === "continental"
      ? settings.mesh14ContinentalYardsPerSqIn
      : settings.mesh14BasketwaveYardsPerSqIn;
  } else {
    yardsPerSqIn = stitchType === "continental"
      ? settings.mesh18ContinentalYardsPerSqIn
      : settings.mesh18BasketwaveYardsPerSqIn;
  }

  // Stitches per square inch = meshCount²
  const stitchesPerSqIn = meshCount * meshCount;

  const results: YarnUsage[] = [];

  // Threshold for using full skeins vs wound portions
  const FULL_SKEIN_THRESHOLD = 4; // yards

  for (const [dmcNumber, stitchCount] of stitchCounts) {
    const squareInches = stitchCount / stitchesPerSqIn;
    const yarnYards = squareInches * yardsPerSqIn;
    const withBuffer = yarnYards * (1 + bufferPercent / 100);

    // If more than 4 yards needed, use full skein(s); otherwise wind the exact amount
    const usesFullSkein = withBuffer > FULL_SKEIN_THRESHOLD;
    const skeinsNeeded = usesFullSkein ? Math.ceil(withBuffer / SKEIN_YARDS) : 1;

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

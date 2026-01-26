// Yarn usage calculator for needlepoint designs

export interface YarnCalculationSettings {
  mesh14ContinentalInchPerStitch: number;
  mesh14BasketwaveInchPerStitch: number;
  mesh18ContinentalInchPerStitch: number;
  mesh18BasketwaveInchPerStitch: number;
}

export const DEFAULT_SETTINGS: YarnCalculationSettings = {
  mesh14ContinentalInchPerStitch: 1.5,
  mesh14BasketwaveInchPerStitch: 2.0,
  mesh18ContinentalInchPerStitch: 1.2,
  mesh18BasketwaveInchPerStitch: 1.6,
};

export type StitchType = "continental" | "basketweave";

export interface YarnUsage {
  dmcNumber: string;
  stitchCount: number;
  yarnInches: number;
  yarnYards: number;
  withBuffer: number; // yards with buffer
  skeinsNeeded: number;
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
  // Get inches per stitch based on mesh and stitch type
  let inchPerStitch: number;

  if (meshCount === 14) {
    inchPerStitch = stitchType === "continental"
      ? settings.mesh14ContinentalInchPerStitch
      : settings.mesh14BasketwaveInchPerStitch;
  } else {
    inchPerStitch = stitchType === "continental"
      ? settings.mesh18ContinentalInchPerStitch
      : settings.mesh18BasketwaveInchPerStitch;
  }

  const results: YarnUsage[] = [];

  for (const [dmcNumber, stitchCount] of stitchCounts) {
    const yarnInches = stitchCount * inchPerStitch;
    const yarnYards = yarnInches / 36;
    const withBuffer = yarnYards * (1 + bufferPercent / 100);
    const skeinsNeeded = Math.ceil(withBuffer / SKEIN_YARDS);

    results.push({
      dmcNumber,
      stitchCount,
      yarnInches,
      yarnYards,
      withBuffer,
      skeinsNeeded,
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

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

// Calculate a smart buffer that scales down for larger amounts
// This prevents the buffer from causing unnecessary skein increases
function calculateSmartBuffer(yarnYards: number, bufferPercent: number): number {
  // For small amounts (< 10 yards): use full buffer - need safety margin
  // For medium amounts (10-27 yards): use 60% of buffer
  // For larger amounts (> 27 yards): use 40% of buffer
  // Reasoning: larger amounts already have more inherent margin, and
  // full skeins provide built-in buffer (27 yards for 20 needed = 35% extra)

  let effectiveBufferPercent: number;
  if (yarnYards < 10) {
    effectiveBufferPercent = bufferPercent;
  } else if (yarnYards < 27) {
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
  const FULL_SKEIN_THRESHOLD = 5; // yards - if more than 5 yards needed, use full skein(s)

  for (const [dmcNumber, stitchCount] of stitchCounts) {
    const squareInches = stitchCount / stitchesPerSqIn;
    const yarnYards = squareInches * yardsPerSqIn;
    const withBuffer = calculateSmartBuffer(yarnYards, bufferPercent);

    // If more than 5 yards needed, use full skein(s); otherwise wind the exact amount
    const usesFullSkein = withBuffer > FULL_SKEIN_THRESHOLD;

    // Calculate skeins needed, but be smart about it:
    // Don't add an extra skein just for a small buffer overage
    let skeinsNeeded: number;
    if (!usesFullSkein) {
      skeinsNeeded = 1;
    } else {
      const baseSkeins = Math.floor(yarnYards / SKEIN_YARDS);
      const remainder = yarnYards - (baseSkeins * SKEIN_YARDS);

      // If the raw yards fit in N skeins with reasonable headroom (>3 yards),
      // don't bump up to N+1 just because of buffer
      if (baseSkeins > 0 && remainder <= (SKEIN_YARDS - 3)) {
        // Check if N skeins provide enough margin (at least 10% over raw yards)
        const totalFromBase = baseSkeins * SKEIN_YARDS;
        if (totalFromBase >= yarnYards * 1.1) {
          skeinsNeeded = baseSkeins;
        } else {
          skeinsNeeded = Math.ceil(withBuffer / SKEIN_YARDS);
        }
      } else {
        skeinsNeeded = Math.ceil(withBuffer / SKEIN_YARDS);
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

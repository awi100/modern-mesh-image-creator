// DMC Pearl Cotton Color Palette with Lab values for perceptual color matching

import { MEASURED } from "./dmc-measured";

export interface DmcColor {
  dmcNumber: string;
  name: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  lab: { l: number; a: number; b: number };
}

// RGB to Lab conversion
export function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  // Normalize RGB to 0-1
  let rNorm = r / 255;
  let gNorm = g / 255;
  let bNorm = b / 255;

  // Apply gamma correction
  rNorm = rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
  gNorm = gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
  bNorm = bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

  // Convert to XYZ
  const x = (rNorm * 0.4124564 + gNorm * 0.3575761 + bNorm * 0.1804375) / 0.95047;
  const y = (rNorm * 0.2126729 + gNorm * 0.7151522 + bNorm * 0.0721750) / 1.00000;
  const z = (rNorm * 0.0193339 + gNorm * 0.1191920 + bNorm * 0.9503041) / 1.08883;

  // Convert to Lab
  const xLab = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
  const yLab = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
  const zLab = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;

  return {
    l: (116 * yLab) - 16,
    a: 500 * (xLab - yLab),
    b: 200 * (yLab - zLab)
  };
}

// Delta E (CIE76) - perceptual color difference
export function deltaE76(lab1: { l: number; a: number; b: number }, lab2: { l: number; a: number; b: number }): number {
  return Math.sqrt(
    Math.pow(lab1.l - lab2.l, 2) +
    Math.pow(lab1.a - lab2.a, 2) +
    Math.pow(lab1.b - lab2.b, 2)
  );
}

// Lab to RGB conversion (inverse of rgbToLab)
export function labToRgb(l: number, a: number, b: number): { r: number; g: number; b: number } {
  // Lab to XYZ
  let y = (l + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;

  const y3 = Math.pow(y, 3);
  const x3 = Math.pow(x, 3);
  const z3 = Math.pow(z, 3);

  y = y3 > 0.008856 ? y3 : (y - 16 / 116) / 7.787;
  x = x3 > 0.008856 ? x3 : (x - 16 / 116) / 7.787;
  z = z3 > 0.008856 ? z3 : (z - 16 / 116) / 7.787;

  // Apply D65 illuminant
  x *= 0.95047;
  y *= 1.00000;
  z *= 1.08883;

  // XYZ to RGB
  let rLinear = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let gLinear = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bLinear = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  // Apply gamma correction
  const gammaCorrect = (c: number) =>
    c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;

  rLinear = gammaCorrect(rLinear);
  gLinear = gammaCorrect(gLinear);
  bLinear = gammaCorrect(bLinear);

  return {
    r: Math.max(0, Math.min(255, Math.round(rLinear * 255))),
    g: Math.max(0, Math.min(255, Math.round(gLinear * 255))),
    b: Math.max(0, Math.min(255, Math.round(bLinear * 255))),
  };
}

// Find nearest DMC color to a given RGB
export function findNearestDmcColor(r: number, g: number, b: number): DmcColor {
  const targetLab = rgbToLab(r, g, b);
  let nearest = DMC_PEARL_COTTON[0];
  let minDistance = Infinity;

  for (const color of DMC_PEARL_COTTON) {
    const distance = deltaE76(targetLab, color.lab);
    // Prefer BLANC over B5200 for pure/near white (BLANC is more common in needlepoint)
    if (distance < minDistance ||
        (distance === minDistance && color.dmcNumber === "BLANC")) {
      minDistance = distance;
      nearest = color;
    }
  }

  return nearest;
}

// Check if a color is near-white (for treating as empty/background)
export function isNearWhite(r: number, g: number, b: number, threshold: number = 250): boolean {
  return r >= threshold && g >= threshold && b >= threshold;
}

// Find nearest from a subset of colors
export function findNearestFromSubset(r: number, g: number, b: number, subset: DmcColor[]): DmcColor {
  const targetLab = rgbToLab(r, g, b);
  let nearest = subset[0];
  let minDistance = Infinity;

  for (const color of subset) {
    const distance = deltaE76(targetLab, color.lab);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = color;
    }
  }

  return nearest;
}

// Find a similar in-stock color when selected color is out of stock
export function findSimilarInStockColor(
  selectedColor: DmcColor,
  inStockNumbers: Set<string>,
  maxDeltaE: number = 15
): { color: DmcColor; deltaE: number } | null {
  if (inStockNumbers.size === 0) return null;

  const inStockColors = DMC_PEARL_COTTON.filter(c => inStockNumbers.has(c.dmcNumber));
  if (inStockColors.length === 0) return null;

  let bestMatch: DmcColor | null = null;
  let bestDeltaE = Infinity;

  for (const color of inStockColors) {
    const dE = deltaE76(selectedColor.lab, color.lab);
    if (dE < bestDeltaE) {
      bestDeltaE = dE;
      bestMatch = color;
    }
  }

  if (bestMatch && bestDeltaE <= maxDeltaE) {
    return { color: bestMatch, deltaE: Math.round(bestDeltaE * 10) / 10 };
  }
  return null;
}

// Get similarity description based on deltaE
export function getSimilarityDescription(deltaE: number): string {
  if (deltaE < 3) return "Nearly identical";
  if (deltaE < 6) return "Very similar";
  if (deltaE < 10) return "Similar";
  if (deltaE < 15) return "Somewhat similar";
  return "Different";
}

// Helper to create color entry.
//
// A measured reading, where we have one, wins over the literal hex below. The
// lookup lives in dmc-measured.ts rather than being edited into the 480 literals
// because this file is copied verbatim to the public SaaS app (CLAUDE.md, "SYNC
// WITH PUBLIC APP"): rewriting literals here would turn every batch of newly
// measured skeins into a three-way merge, while a separate generated file stays
// a file copy. MEASURED ships empty, so with nothing measured this behaves
// exactly as parsing the hex did.
//
// Measured Lab is taken straight through instead of being re-derived from the
// measured hex. 8-bit sRGB quantises Lab into roughly 0.4 dE steps, and lab —
// not hex — is what the matching path reads: findNearestDmcColor below and the
// photo quantization in color-utils.ts.
function createColor(dmcNumber: string, name: string, hex: string): DmcColor {
  const measured = MEASURED[dmcNumber];
  const effectiveHex = measured?.hex ?? hex;
  const r = parseInt(effectiveHex.slice(1, 3), 16);
  const g = parseInt(effectiveHex.slice(3, 5), 16);
  const b = parseInt(effectiveHex.slice(5, 7), 16);
  const lab = measured?.lab ?? rgbToLab(r, g, b);
  return { dmcNumber, name, hex: effectiveHex, rgb: { r, g, b }, lab };
}

// Complete DMC Pearl Cotton palette - all colors available from Yarn Tree wholesale
//
// Lines marked "provisional" were corrected by hand against the two public
// datasets (Wolfram n=454, camelia n=455) because they were provably wrong —
// nobody held a skein next to a screen, so they are still guesses, only
// better-argued ones. dmc-provenance.ts records which; a reading landing in
// dmc-measured.ts is what retires the label. The reasoning, once:
//
//   310 Black     HELD AT #000000. It was moved to #131313 on 2026-11-13 and
//     reverted the same day: a palette hex is not display-only, it is the seed
//     for the print-colour overrides. The colours page generates
//     adjustColorForPrint(color.hex) for any design that has no stored
//     overrides and SAVES it, and adjustColorForPrint("#000000") = #1F1F1F
//     while adjustColorForPrint("#131313") = #2E2E2E — 15 levels per channel
//     lighter on a canvas that costs real money. 103 of the 292 live designs
//     stitch 310 and 73 of those carry no overrides at all, so the next visit
//     to each of their colours pages would have banked the new value silently.
//     (The 30 designs that DO store a 310 override are already safe: 29 hold
//     #1f1f1f and one a hand-tuned #171717, and a stored override always wins.)
//     Black's true value is a measurement question, not a reasoning one; the
//     screen-side problem it was reaching for was fixed where it lived, in
//     darkenColor() in stitch-preview.ts. Moving 310 is only safe once print
//     overrides are frozen first — backfill every design that stitches 310 with
//     its current adjustColorForPrint value, THEN change the hex.
//   B5200 Snow White #FFFFFF -> #FDFDFF  The same argument at the other end,
//     and it survives because at L*99.36 it is above adjustColorForPrint's L*70
//     threshold: both the old and the new hex pass through untouched, no
//     override is ever generated, and the only print difference is the 2/255 on
//     R and G that no printer resolves. Both datasets put B5200 at #FCFCFF — a
//     hair under white with the optical brightener's blue cast; taken at half
//     strength so B5200/BLANC stay the near-twins they are, still above BLANC's
//     L*98.96. B5200 must stay at index 0, which store.ts:238 depends on.
//
//     It is NOT display-only either: it changes photo import. An exactly white
//     pixel used to hit B5200 on a dE76 of 0 and now hits BLANC (1.036 vs
//     B5200's 1.201), because findNearestDmcColor matches on lab. That is the
//     better answer — BLANC is the thread the business actually stocks, 136
//     skeins across 179 live designs, against B5200's 67 skeins in 6 — but it
//     is a behaviour change, not a repaint, and it is recorded here rather than
//     rediscovered from a quantized photo that came back a different white.
//
// Three colours corrected on 2026-11-13 from a two-source consensus. A
// photograph of the real skein (123stitch's product shots of DMC Pearl Cotton
// size 5 — our actual product line) and an independent public table were each
// compared with the palette after mean-centring both, so only the SHAPE of the
// disagreement counts, not either source's exposure or white balance:
//
//   415  Pearl Gray    #B0B0B0 -> #D3D3D6  photo #cfd3dc, public #D3D3D6
//   666  Bright Red    #E31D3D -> #E31D42  photo #dd1044, public #E31D42
//   3753 Ultra V Lt Ant#D8E8F0 -> #DBE2E9  photo #d6dee1, public #DBE2E9
//
// The two sources agree with each other to 1.9, 1.5 and 4.3 dE2000 while the
// palette sat 9.2, 8.2 and 7.6 from both. 415 and 3753 were also on the 8-step
// RGB grid, the fingerprint of a value picked off a colour wheel.
//
// Photographs are NOT ground truth and this is the only way they are used
// here. Scored alone against the public table they are a coin flip — the table
// sided with our palette 34 times and with the photograph 29 — because a photo
// carries six unknowns (illuminant, white balance, exposure, the mercerized
// thread's specular sheen, JPEG, the screen) and no colour chart in frame.
// What survives that is agreement between two methods that fail differently,
// which is why only 3 of 63 comparable colours are here. See
// scripts/estimate-colors-from-photos.ts and photo-palette-consensus.ts; do
// not bulk-replace hexes from either source.
//
// 3753 was already hand-corrected once (b11644f, Jan 2026) and the consensus
// still disagreed with it; its two sources agree least well of the three (4.3),
// so it is the weakest of them and was applied at the owner's direction.
//
// All three seed print colours, so the 30 affected designs — 18 live, 2
// archived and 10 print-versions — were frozen at their previous values first
// with scripts/freeze-print-colors.ts, per the 310 rule below. Existing designs
// therefore print exactly as before; the new values apply to new work, to photo
// import, and to any design whose override is deliberately cleared.
//
// The six byte-identical pairs below were six threads you could not tell apart
// on screen, and findNearestDmcColor breaks ties by array position, so one of
// each pair was unreachable from photo import. For five of them both datasets
// agree which half ours matches, so the OTHER half moved, by the Lab delta the
// two datasets agree on rather than by importing either one's absolute value:
//
//   988  vs 320   #588858 -> #5D8B4D  b* +7.6, forest green is the yellower one
//   3346 vs 367   #386038 -> #42642E  b* +8.0, same relationship
//   368  vs 989   #78A878 -> #8DCA98  L* +11.9; here ours matched 989 in both
//                                     datasets, so 368 is the half that moved
//   535  vs 318   #989898 -> #4B4942  L* -31.7. Not a nudge: ours was 28.6/30.4
//                                     dE2000 from the two datasets, which agree
//                                     535 is a dark olive-grey. Now 3.4/3.0.
//   645  vs 3787  #585048 -> #565A51  a* -5.1; 645 is the neutral olive-grey of
//                                     the pair, 3787 the brown one
//   07   vs 453   #CCB8AA -> #BCA194  Neither dataset covers the 01-35 range at
//     all, while both carry 453 (camelia byte-for-byte as ours), so 07 was the
//     copy. Placed at the Lab midpoint of its own neighbours 06 and 08, whose
//     steps were a lopsided 3.8 then 18.1 dE2000.
//
// None of those six carries 310's print consequence TODAY, which is why they
// stand while 310 was reverted: not one of them is stitched in any of the 474
// designs in the database, live or trashed, and no design stores a print
// override for any of them. They would if they were used — 535's generated
// override moves #9d9d9d -> #5f5d54, 3346's #477947 -> #55813c — so the same
// freeze-the-overrides rule applies the first time one of them lands in a
// design that has already been to the printer.
//
// And every hex here, changed for whatever reason, changes what a PHOTO
// quantizes to. Import matches on lab (findNearestDmcColor, and the quantizer
// in color-utils.ts), lab is derived from the hex, so moving one entry can
// reassign pixels that were never near it — at #131313, 310 took rgb(32,32,32)
// off 3799 Very Dark Pewter Gray, and splitting a byte-identical pair makes the
// half that could never be picked pickable. Re-importing the same photograph
// after a palette change is not guaranteed to give the same design.
export const DMC_PEARL_COTTON: DmcColor[] = [
  // Whites and Ecrus
  createColor("B5200", "Snow White", "#FDFDFF"), // provisional, pending measurement
  createColor("BLANC", "White", "#FCFCFC"),
  createColor("ECRU", "Ecru", "#F0EAD6"),
  createColor("712", "Cream", "#F6EFDA"),
  createColor("746", "Off White", "#FAF2D5"),
  createColor("3865", "Winter White", "#FFFDF9"),
  createColor("3866", "Mocha Brown Ultra Very Light", "#F0E6D7"),

  // New DMC Colors (01-35)
  createColor("01", "White Tin", "#EFEEF0"),
  createColor("02", "Tin", "#C5C4C9"),
  createColor("03", "Medium Tin", "#B0B0B5"),
  createColor("04", "Dark Tin", "#9C9B9D"),
  createColor("05", "Light Driftwood", "#E3CCBE"),
  createColor("06", "Medium Light Driftwood", "#DCC6B8"),
  createColor("07", "Driftwood", "#BCA194"), // provisional, pending measurement
  createColor("08", "Dark Driftwood", "#9D7D71"),
  createColor("09", "Very Dark Cocoa", "#552014"),
  createColor("10", "Very Light Tender Green", "#EDFED9"),
  createColor("11", "Light Tender Green", "#E2EDB5"),
  createColor("12", "Tender Green", "#CDD99A"),
  createColor("13", "Medium Light Nile Green", "#BFF6E0"),
  createColor("14", "Pale Apple Green", "#D0FBB2"),
  createColor("15", "Apple Green", "#D1EDA4"),
  createColor("16", "Light Chartreuse", "#A4D67C"),
  createColor("17", "Light Yellow Plum", "#E5E272"),
  createColor("18", "Yellow Plum", "#D9D56D"),
  createColor("19", "Medium Light Autumn Gold", "#F7C95F"),
  createColor("20", "Shrimp", "#F7AF93"),
  createColor("21", "Light Alizarin", "#D79982"),
  createColor("22", "Alizarin", "#BC604E"),
  createColor("23", "Apple Blossom", "#EDE2ED"),
  createColor("24", "White Lavender", "#E0D7EE"),
  createColor("25", "Ultra Light Lavender", "#DAD2E9"),
  createColor("26", "Pale Lavender", "#CFC8DE"),
  createColor("27", "White Violet", "#E9ECFC"),
  createColor("28", "Medium Light Eggplant", "#7D4E92"),
  createColor("29", "Eggplant", "#674076"),
  createColor("30", "Medium Light Blueberry", "#6D54D3"),
  createColor("31", "Blueberry", "#5834A3"),
  createColor("32", "Dark Blueberry", "#4D2E8A"),
  createColor("33", "Fuchsia", "#C32278"),
  createColor("34", "Dark Fuchsia", "#AE4280"),
  createColor("35", "Very Dark Fuchsia", "#732B55"),

  // Reds
  createColor("321", "Red", "#C52F3C"),
  createColor("304", "Medium Red", "#B72431"),
  createColor("347", "Very Dark Salmon", "#AB1B33"),
  createColor("498", "Dark Red", "#8B0A1E"),
  createColor("816", "Garnet", "#971E2A"),
  createColor("815", "Medium Garnet", "#7B1B25"),
  createColor("814", "Dark Garnet", "#5C1420"),
  createColor("666", "Bright Red", "#E31D42"),  // provisional
  createColor("349", "Dark Coral", "#CF3B3B"),
  createColor("350", "Medium Coral", "#E15656"),
  createColor("351", "Coral", "#E97171"),
  createColor("352", "Light Coral", "#F09090"),
  createColor("353", "Peach", "#F7B8B8"),
  createColor("817", "Very Dark Coral Red", "#B41C2D"),
  createColor("902", "Very Dark Garnet", "#651329"),
  createColor("760", "Salmon", "#EC8880"),
  createColor("761", "Light Salmon", "#F8B4AD"),
  createColor("3328", "Dark Salmon", "#BE444A"),
  createColor("3705", "Dark Melon", "#E55B5B"),
  createColor("3706", "Medium Melon", "#F08888"),
  createColor("3708", "Light Melon", "#F7BABA"),
  createColor("3801", "Very Dark Melon", "#CC3B3B"),
  createColor("3802", "Very Dark Antique Mauve", "#6B2538"),
  createColor("3803", "Dark Mauve", "#8B2F47"),
  createColor("3804", "Dark Cyclamen Pink", "#A33558"),
  createColor("3805", "Cyclamen Pink", "#C44B73"),
  createColor("3806", "Light Cyclamen Pink", "#D9749B"),
  createColor("3831", "Dark Raspberry", "#C12B52"),
  createColor("3832", "Medium Raspberry", "#E36370"),
  createColor("3833", "Light Raspberry", "#EA8B96"),

  // Pinks
  createColor("150", "Ultra Very Dark Dusty Rose", "#7D3040"),
  createColor("151", "Very Light Dusty Rose", "#F4C8CE"),
  createColor("152", "Medium Light Shell Pink", "#E1A1A1"),
  createColor("221", "Very Dark Shell Pink", "#883E43"),
  createColor("225", "Ultra Very Light Shell Pink", "#FFDFD7"),
  createColor("309", "Dark Rose", "#9B2545"),
  createColor("326", "Very Dark Rose", "#B33050"),
  createColor("335", "Rose", "#D65070"),
  createColor("776", "Medium Pink", "#F4B8C4"),
  createColor("818", "Baby Pink", "#FFDFE5"),
  createColor("819", "Light Baby Pink", "#FCEBDE"),
  createColor("891", "Dark Carnation", "#E66080"),
  createColor("892", "Medium Carnation", "#EF8098"),
  createColor("893", "Light Carnation", "#F4A0B0"),
  createColor("894", "Very Light Carnation", "#F8C4CF"),
  createColor("899", "Medium Rose", "#E87088"),
  createColor("956", "Geranium", "#E77B8B"),
  createColor("957", "Pale Geranium", "#F4A4AF"),
  createColor("961", "Dark Dusty Rose", "#CF6B7B"),
  createColor("962", "Medium Dusty Rose", "#E28A97"),
  createColor("963", "Ultra Very Light Dusty Rose", "#F7D5DA"),
  createColor("3326", "Light Rose", "#F9979C"),
  createColor("3350", "Ultra Dark Dusty Rose", "#984455"),
  createColor("3354", "Light Dusty Rose", "#E8A3AC"),
  createColor("3685", "Very Dark Mauve", "#79263B"),
  createColor("3687", "Mauve", "#B5455D"),
  createColor("3688", "Medium Mauve", "#DC7C86"),
  createColor("3689", "Light Mauve", "#F8BBC8"),
  createColor("3716", "Very Light Dusty Rose", "#FCAFB9"),
  createColor("3721", "Dark Shell Pink", "#933B3D"),
  createColor("3722", "Medium Shell Pink", "#A04B4C"),
  createColor("3731", "Very Dark Dusty Rose", "#B85567"),
  createColor("3733", "Dusty Rose", "#D88A95"),

  // Antique Mauve / Shell
  createColor("315", "Medium Dark Antique Mauve", "#814952"),
  createColor("316", "Medium Antique Mauve", "#B7737F"),
  createColor("778", "Very Light Antique Mauve", "#DCA6A4"),
  createColor("3726", "Dark Antique Mauve", "#95565C"),
  createColor("3727", "Light Antique Mauve", "#DA9EA6"),

  // Cranberries
  createColor("600", "Very Dark Cranberry", "#BF1C48"),
  createColor("601", "Dark Cranberry", "#C62A53"),
  createColor("602", "Medium Cranberry", "#D63F68"),
  createColor("603", "Cranberry", "#FB4B7C"),
  createColor("604", "Light Cranberry", "#F793B2"),
  createColor("605", "Very Light Cranberry", "#FBACC4"),

  // Oranges
  createColor("606", "Bright Orange-Red", "#F03B18"),
  createColor("608", "Bright Orange", "#F85B20"),
  createColor("720", "Dark Orange Spice", "#C85830"),
  createColor("721", "Medium Orange Spice", "#E87838"),
  createColor("722", "Light Orange Spice", "#F09858"),
  createColor("740", "Tangerine", "#F77B28"),
  createColor("741", "Medium Tangerine", "#F79848"),
  createColor("742", "Light Tangerine", "#F7B068"),
  createColor("743", "Medium Yellow", "#F7CF68"),
  createColor("744", "Pale Yellow", "#F7E088"),
  createColor("745", "Very Light Pale Yellow", "#F8E8A8"),
  createColor("754", "Light Peach", "#F7C9B0"),
  createColor("900", "Dark Burnt Orange", "#CF4010"),
  createColor("918", "Dark Red Copper", "#883630"),
  createColor("919", "Red Copper", "#9B371B"),
  createColor("920", "Medium Copper", "#AB4836"),
  createColor("921", "Copper", "#C0573D"),
  createColor("922", "Light Copper", "#DD6E4C"),
  createColor("945", "Tawny", "#F6C19A"),
  createColor("946", "Medium Burnt Orange", "#E55318"),
  createColor("947", "Burnt Orange", "#F76E35"),
  createColor("948", "Very Light Peach", "#FDE6D3"),
  createColor("951", "Light Tawny", "#FADDB6"),
  createColor("970", "Light Pumpkin", "#F78B3B"),
  createColor("971", "Pumpkin", "#F56B1B"),
  createColor("301", "Medium Mahogany", "#A85030"),
  createColor("400", "Dark Mahogany", "#883820"),
  createColor("402", "Very Light Mahogany", "#E89868"),
  createColor("3340", "Medium Apricot", "#F79070"),
  createColor("3341", "Apricot", "#F7A890"),
  createColor("3770", "Very Light Tawny", "#FEF1D8"),
  createColor("3771", "Ultra Very Light Terra Cotta", "#E8AC9B"),
  createColor("3776", "Light Mahogany", "#C87048"),
  createColor("3824", "Light Apricot", "#F8C8B8"),
  createColor("3825", "Pale Pumpkin", "#FEA370"),
  createColor("3853", "Dark Autumn Gold", "#EF8125"),
  createColor("3854", "Medium Autumn Gold", "#FBAC56"),
  createColor("3855", "Light Autumn Gold", "#FDDFA0"),
  createColor("3856", "Ultra Very Light Mahogany", "#FDBE8E"),

  // Yellows
  createColor("307", "Lemon", "#F7E718"),
  createColor("444", "Dark Lemon", "#F7D718"),
  createColor("445", "Light Lemon", "#FCF999"),
  createColor("676", "Light Old Gold", "#D8C068"),
  createColor("677", "Very Light Old Gold", "#E8D898"),
  createColor("680", "Dark Old Gold", "#A08018"),
  createColor("725", "Medium Light Topaz", "#F7D058"),
  createColor("726", "Light Topaz", "#F7E078"),
  createColor("727", "Very Light Topaz", "#F8E898"),
  createColor("728", "Topaz", "#F2AE3F"),
  createColor("729", "Medium Old Gold", "#C8A838"),
  createColor("780", "Ultra Very Dark Topaz", "#885008"),
  createColor("781", "Very Dark Topaz", "#A06810"),
  createColor("782", "Dark Topaz", "#B88018"),
  createColor("783", "Medium Topaz", "#CF9828"),
  createColor("972", "Deep Canary", "#F7C818"),
  createColor("973", "Bright Canary", "#F7E328"),
  createColor("3078", "Very Light Golden Yellow", "#F8F0B8"),
  createColor("3820", "Dark Straw", "#D8A828"),
  createColor("3821", "Straw", "#E8C048"),
  createColor("3822", "Light Straw", "#F0D878"),
  createColor("3823", "Ultra Pale Yellow", "#F8F0D0"),
  createColor("3829", "Very Dark Old Gold", "#A7671D"),
  createColor("3852", "Very Dark Straw", "#C89818"),

  // Golden Olives
  createColor("829", "Very Dark Golden Olive", "#64480C"),
  createColor("830", "Dark Golden Olive", "#6E501D"),
  createColor("831", "Medium Golden Olive", "#7C5F20"),
  createColor("832", "Golden Olive", "#9C7230"),
  createColor("833", "Light Golden Olive", "#B99956"),
  createColor("834", "Very Light Golden Olive", "#D2B468"),

  // Greens
  createColor("163", "Medium Celadon Green", "#557A60"),
  createColor("164", "Light Forest Green", "#BAE4B6"),
  createColor("165", "Very Light Moss Green", "#E1F477"),
  createColor("166", "Lime Green", "#ADC238"),
  createColor("319", "Very Dark Pistachio Green", "#184828"),
  createColor("320", "Medium Pistachio Green", "#588858"),
  createColor("367", "Dark Pistachio Green", "#386038"),
  createColor("368", "Light Pistachio Green", "#8DCA98"), // provisional, pending measurement
  createColor("369", "Very Light Pistachio Green", "#A8D0A8"),
  createColor("469", "Avocado Green", "#5B6533"),
  createColor("470", "Light Avocado Green", "#72813E"),
  createColor("471", "Very Light Avocado Green", "#9EB357"),
  createColor("472", "Ultra Light Avocado Green", "#D1DE75"),
  createColor("500", "Very Dark Blue Green", "#1D362A"),
  createColor("501", "Dark Blue Green", "#2F5446"),
  createColor("502", "Blue Green", "#57826E"),
  createColor("503", "Medium Blue Green", "#89B89F"),
  createColor("504", "Very Light Blue Green", "#C4DECC"),
  createColor("505", "Jade Green", "#338362"),
  createColor("520", "Dark Fern Green", "#384526"),
  createColor("522", "Fern Green", "#808B6E"),
  createColor("523", "Light Fern Green", "#959F7A"),
  createColor("524", "Very Light Fern Green", "#AEA78E"),
  createColor("561", "Very Dark Jade", "#285E48"),
  createColor("562", "Medium Jade", "#3B8C5A"),
  createColor("563", "Light Jade", "#6ED39A"),
  createColor("564", "Very Light Jade", "#95E4AF"),
  createColor("580", "Dark Moss Green", "#485028"),
  createColor("581", "Moss Green", "#687038"),
  createColor("699", "Green", "#185028"),
  createColor("700", "Bright Green", "#187830"),
  createColor("701", "Light Green", "#289840"),
  createColor("702", "Kelly Green", "#38B050"),
  createColor("703", "Chartreuse", "#58C868"),
  createColor("704", "Bright Chartreuse", "#78D878"),
  createColor("730", "Very Dark Olive Green", "#484808"),
  createColor("731", "Dark Olive Green", "#585818"),
  createColor("732", "Olive Green", "#686828"),
  createColor("733", "Medium Olive Green", "#888840"),
  createColor("734", "Light Olive Green", "#989858"),
  createColor("772", "Very Light Yellow Green", "#D7EFA7"),
  createColor("890", "Ultra Dark Pistachio Green", "#103818"),
  createColor("895", "Very Dark Hunter Green", "#344B2E"),
  createColor("904", "Very Dark Parrot Green", "#285830"),
  createColor("905", "Dark Parrot Green", "#388040"),
  createColor("906", "Medium Parrot Green", "#48A050"),
  createColor("907", "Light Parrot Green", "#78C880"),
  createColor("909", "Very Dark Emerald Green", "#106038"),
  createColor("910", "Dark Emerald Green", "#108840"),
  createColor("911", "Medium Emerald Green", "#18A850"),
  createColor("912", "Light Emerald Green", "#28C060"),
  createColor("913", "Medium Nile Green", "#68D090"),
  createColor("934", "Black Avocado Green", "#323324"),
  createColor("935", "Dark Avocado Green", "#383A2A"),
  createColor("936", "Very Dark Avocado Green", "#3F4227"),
  createColor("937", "Medium Avocado Green", "#434F2C"),
  createColor("943", "Medium Aquamarine", "#18A088"),
  createColor("954", "Nile Green", "#88E0A8"),
  createColor("955", "Light Nile Green", "#B8F0C8"),
  createColor("958", "Dark Sea Green", "#0DB294"),
  createColor("959", "Medium Sea Green", "#72D0B7"),
  createColor("964", "Light Sea Green", "#A5E4D4"),
  createColor("966", "Medium Baby Green", "#94D28A"),
  createColor("986", "Very Dark Forest Green", "#284028"),
  createColor("987", "Dark Forest Green", "#386838"),
  createColor("988", "Medium Forest Green", "#5D8B4D"), // provisional, pending measurement
  createColor("989", "Forest Green", "#78A878"),
  createColor("991", "Dark Aquamarine", "#135F55"),
  createColor("992", "Light Aquamarine", "#42B59E"),
  createColor("993", "Very Light Aquamarine", "#62D8B6"),
  createColor("3013", "Light Khaki Green", "#AFA97B"),
  createColor("3051", "Dark Green Gray", "#4C4C1E"),
  createColor("3052", "Medium Green Gray", "#787E5C"),
  createColor("3053", "Green Gray", "#999D75"),
  createColor("3345", "Dark Hunter Green", "#183820"),
  createColor("3346", "Hunter Green", "#42642E"), // provisional, pending measurement
  createColor("3347", "Medium Yellow Green", "#588050"),
  createColor("3348", "Light Yellow Green", "#98B088"),
  createColor("3362", "Dark Pine Green", "#49523C"),
  createColor("3363", "Medium Pine Green", "#617451"),
  createColor("3364", "Pine Green", "#8E9B6D"),
  createColor("3812", "Very Dark Seagreen", "#188878"),
  createColor("3813", "Light Blue Green", "#98D8C0"),
  createColor("3814", "Aquamarine", "#489080"),
  createColor("3815", "Dark Celadon Green", "#487868"),
  createColor("3816", "Celadon Green", "#689888"),
  createColor("3817", "Light Celadon Green", "#98C0B0"),
  createColor("3818", "Ultra Very Dark Emerald Green", "#005D2E"),
  createColor("3819", "Light Moss Green", "#CCC959"),
  createColor("3847", "Dark Teal Green", "#186358"),
  createColor("3848", "Medium Teal Green", "#207E72"),
  createColor("3849", "Light Teal Green", "#35B193"),
  createColor("3850", "Dark Bright Green", "#208B46"),
  createColor("3851", "Light Bright Green", "#61BB84"),

  // Blues
  createColor("155", "Forget-Me-Not Blue", "#9774B6"),
  createColor("156", "Medium Light Blue Violet", "#8577B4"),
  createColor("157", "Very Light Cornflower Blue", "#B5B8EA"),
  createColor("158", "Very Dark Cornflower Blue", "#393068"),
  createColor("159", "Light Petrol Blue", "#BCB5DE"),
  createColor("160", "Medium Petrol Blue", "#8178A9"),
  createColor("161", "Dark Petrol Blue", "#60568B"),
  createColor("162", "Light Baby Blue", "#CAE7F0"),
  createColor("311", "Medium Navy Blue", "#183868"),
  createColor("312", "Very Dark Baby Blue", "#284878"),
  createColor("322", "Dark Baby Blue", "#386090"),
  createColor("333", "Very Dark Blue Violet", "#4848A8"),
  createColor("334", "Medium Baby Blue", "#5888B0"),
  createColor("336", "Navy Blue", "#182858"),
  createColor("340", "Medium Blue Violet", "#8888C8"),
  createColor("341", "Light Blue Violet", "#A8A8D8"),
  createColor("517", "Dark Wedgwood", "#386888"),
  createColor("518", "Light Wedgwood", "#5898B8"),
  createColor("519", "Sky Blue", "#78B8D8"),
  createColor("747", "Very Light Peacock Blue", "#CEE9EA"),
  createColor("775", "Very Light Baby Blue", "#D8E8F8"),
  createColor("791", "Very Dark Cornflower Blue", "#384090"),
  createColor("792", "Dark Cornflower Blue", "#485098"),
  createColor("793", "Medium Cornflower Blue", "#6878B0"),
  createColor("794", "Light Cornflower Blue", "#88A0C8"),
  createColor("796", "Dark Royal Blue", "#182890"),
  createColor("797", "Royal Blue", "#2040A8"),
  createColor("798", "Dark Delft Blue", "#3858A0"),
  createColor("799", "Medium Delft Blue", "#5078B0"),
  createColor("800", "Pale Delft Blue", "#B8D0F0"),
  createColor("803", "Ultra Very Dark Baby Blue", "#202754"),
  createColor("806", "Dark Peacock Blue", "#306080"),
  createColor("807", "Peacock Blue", "#487898"),
  createColor("809", "Delft Blue", "#78A0D0"),
  createColor("813", "Light Blue", "#78A8C8"),
  createColor("820", "Very Dark Royal Blue", "#101870"),
  createColor("823", "Dark Navy Blue", "#101848"),
  createColor("824", "Very Dark Blue", "#183858"),
  createColor("825", "Dark Blue", "#305878"),
  createColor("826", "Medium Blue", "#4880A0"),
  createColor("827", "Very Light Blue", "#B0D0E8"),
  createColor("828", "Ultra Very Light Blue", "#D0E8F8"),
  createColor("939", "Very Dark Navy Blue", "#081038"),
  createColor("995", "Dark Electric Blue", "#1088C8"),
  createColor("996", "Medium Electric Blue", "#30B0E8"),
  createColor("3325", "Light Baby Blue", "#B8D0E8"),
  createColor("3750", "Very Dark Antique Blue", "#1D4552"),
  createColor("3755", "Baby Blue", "#88B0D0"),
  createColor("3760", "Medium Wedgwood", "#3880A0"),
  createColor("3761", "Light Sky Blue", "#98C8E0"),
  createColor("3765", "Very Dark Peacock Blue", "#175E78"),
  createColor("3766", "Light Peacock Blue", "#4B8AA1"),
  createColor("3807", "Cornflower Blue", "#4B599E"),
  createColor("3838", "Dark Lavender Blue", "#5870A8"),
  createColor("3839", "Medium Lavender Blue", "#7890C0"),
  createColor("3840", "Light Lavender Blue", "#A0B8D8"),
  createColor("3841", "Pale Baby Blue", "#D9EAF2"),
  createColor("3842", "Very Dark Wedgwood", "#06506A"),
  createColor("3843", "Electric Blue", "#10A8E8"),
  createColor("3844", "Dark Bright Turquoise", "#1098D0"),
  createColor("3845", "Medium Bright Turquoise", "#28C0E8"),
  createColor("3846", "Light Bright Turquoise", "#68D8F0"),

  // Purples
  createColor("153", "Very Light Violet", "#E0C8F0"),
  createColor("154", "Very Dark Grape", "#4B233A"),
  createColor("208", "Very Dark Lavender", "#583898"),
  createColor("209", "Dark Lavender", "#7858B0"),
  createColor("210", "Medium Lavender", "#9878C8"),
  createColor("211", "Light Lavender", "#C0A8E0"),
  createColor("327", "Dark Violet", "#582080"),
  createColor("550", "Very Dark Violet", "#481878"),
  createColor("552", "Medium Violet", "#682898"),
  createColor("553", "Violet", "#8848B0"),
  createColor("554", "Light Violet", "#A878C8"),
  createColor("718", "Plum", "#982878"),
  createColor("915", "Dark Plum", "#781058"),
  createColor("917", "Medium Plum", "#881870"),
  createColor("3041", "Medium Antique Violet", "#956F7C"),
  createColor("3042", "Light Antique Violet", "#B79DA7"),
  createColor("3607", "Light Plum", "#B84888"),
  createColor("3608", "Very Light Plum", "#D080A8"),
  createColor("3609", "Ultra Light Plum", "#E8A8C8"),
  createColor("3740", "Dark Antique Violet", "#71535D"),
  createColor("3743", "Very Light Antique Violet", "#CFC2C9"),
  createColor("3746", "Dark Blue Violet", "#6060B0"),
  createColor("3747", "Very Light Blue Violet", "#C8C8E8"),
  createColor("3834", "Dark Grape", "#6A2258"),
  createColor("3835", "Medium Grape", "#924D78"),
  createColor("3836", "Light Grape", "#C597B9"),
  createColor("3837", "Ultra Dark Lavender", "#482888"),

  // Browns
  createColor("167", "Khaki Brown", "#855D31"),
  createColor("300", "Very Dark Mahogany", "#682818"),
  createColor("370", "Medium Mustard", "#B89D64"),
  createColor("371", "Mustard", "#BFA671"),
  createColor("372", "Light Mustard", "#CCB784"),
  createColor("355", "Dark Terra Cotta", "#984838"),
  createColor("356", "Medium Terra Cotta", "#B86858"),
  createColor("407", "Dark Desert Sand", "#987868"),
  createColor("420", "Dark Hazelnut Brown", "#785028"),
  createColor("422", "Light Hazelnut Brown", "#A88050"),
  createColor("433", "Medium Brown", "#583018"),
  createColor("434", "Light Brown", "#784828"),
  createColor("435", "Very Light Brown", "#986038"),
  createColor("436", "Tan", "#B88048"),
  createColor("437", "Light Tan", "#D0A068"),
  createColor("543", "Ultra Very Light Beige Brown", "#EAD0B5"),
  createColor("610", "Dark Drab Brown", "#6B5039"),
  createColor("611", "Drab Brown", "#7C5F46"),
  createColor("612", "Light Drab Brown", "#A6885E"),
  createColor("613", "Very Light Drab Brown", "#B99F72"),
  createColor("632", "Ultra Very Dark Desert Sand", "#684838"),
  createColor("738", "Very Light Tan", "#E0C098"),
  createColor("739", "Ultra Very Light Tan", "#F0E0C8"),
  createColor("758", "Very Light Terra Cotta", "#E8A898"),
  createColor("779", "Dark Cocoa", "#53332D"),
  createColor("801", "Dark Coffee Brown", "#402818"),
  createColor("838", "Very Dark Beige Brown", "#584838"),
  createColor("839", "Dark Beige Brown", "#786858"),
  createColor("840", "Medium Beige Brown", "#988878"),
  createColor("841", "Light Beige Brown", "#B8A898"),
  createColor("842", "Very Light Beige Brown", "#D0C0B0"),
  createColor("869", "Very Dark Hazelnut Brown", "#583818"),
  createColor("898", "Very Dark Coffee Brown", "#382010"),
  createColor("938", "Ultra Dark Coffee Brown", "#301810"),
  createColor("950", "Light Desert Sand", "#E5AC8D"),
  createColor("975", "Dark Golden Brown", "#884818"),
  createColor("976", "Medium Golden Brown", "#B87828"),
  createColor("977", "Light Golden Brown", "#C89038"),
  createColor("3031", "Very Dark Mocha Brown", "#483828"),
  createColor("3032", "Medium Mocha Brown", "#908070"),
  createColor("3033", "Very Light Mocha Brown", "#C8B8A8"),
  createColor("3045", "Dark Yellow Beige", "#BC966A"),
  createColor("3046", "Medium Yellow Beige", "#D8BC9A"),
  createColor("3047", "Light Yellow Beige", "#E7D6C1"),
  createColor("3064", "Desert Sand", "#D0A898"),
  createColor("3371", "Black Brown", "#36220E"),
  createColor("3772", "Very Dark Desert Sand", "#886858"),
  createColor("3773", "Medium Desert Sand", "#C8A090"),
  createColor("3774", "Very Light Desert Sand", "#F3CFB4"),
  createColor("3777", "Very Dark Terra Cotta", "#922F25"),
  createColor("3778", "Light Terra Cotta", "#D08878"),
  createColor("3779", "Ultra Very Light Rosewood", "#F2AB95"),
  createColor("3781", "Dark Mocha Brown", "#584030"),
  createColor("3782", "Light Mocha Brown", "#A89080"),
  createColor("3790", "Ultra Dark Beige Gray", "#685848"),
  createColor("3826", "Golden Brown", "#A86828"),
  createColor("3827", "Pale Golden Brown", "#D8A858"),
  createColor("3828", "Hazelnut Brown", "#906838"),
  createColor("3830", "Terra Cotta", "#B85848"),
  createColor("3857", "Dark Rosewood", "#6A2F26"),
  createColor("3858", "Medium Rosewood", "#803A32"),
  createColor("3859", "Light Rosewood", "#BA7A6C"),
  createColor("3860", "Cocoa", "#896362"),
  createColor("3861", "Light Cocoa", "#AC8583"),
  createColor("3862", "Dark Mocha Beige", "#705848"),
  createColor("3863", "Medium Mocha Beige", "#907868"),
  createColor("3864", "Light Mocha Beige", "#C8B0A0"),

  // Grays
  // HELD at #000000: changing it rewrites generated print overrides. See the
  // note above DMC_PEARL_COTTON before touching this value.
  createColor("310", "Black", "#000000"),
  createColor("317", "Pewter Gray", "#787878"),
  createColor("318", "Light Steel Gray", "#989898"),
  createColor("413", "Dark Pewter Gray", "#484848"),
  createColor("414", "Dark Steel Gray", "#686868"),
  createColor("415", "Pearl Gray", "#D3D3D6"),  // provisional
  createColor("451", "Dark Shell Gray", "#887773"),
  createColor("452", "Medium Shell Gray", "#AD9994"),
  createColor("453", "Light Shell Gray", "#CCB8AA"),
  createColor("535", "Very Light Ash Gray", "#4B4942"), // provisional, pending measurement
  createColor("640", "Very Dark Beige Gray", "#817868"),
  createColor("642", "Dark Beige Gray", "#958D79"),
  createColor("644", "Medium Beige Gray", "#C4BEA6"),
  createColor("645", "Very Dark Beaver Gray", "#565A51"), // provisional, pending measurement
  createColor("646", "Dark Beaver Gray", "#787068"),
  createColor("647", "Medium Beaver Gray", "#989088"),
  createColor("648", "Light Beaver Gray", "#B8B0A8"),
  createColor("762", "Very Light Pearl Gray", "#D0D0D0"),
  createColor("822", "Light Beige Gray", "#E8DFC7"),
  createColor("844", "Ultra Dark Beaver Gray", "#484040"),
  createColor("3021", "Very Dark Brown Gray", "#403830"),
  createColor("3022", "Medium Brown Gray", "#888078"),
  createColor("3023", "Light Brown Gray", "#A8A098"),
  createColor("3024", "Very Light Brown Gray", "#C8C0B8"),
  createColor("3072", "Very Light Beaver Gray", "#E0E0D8"),
  createColor("3787", "Dark Brown Gray", "#585048"),
  createColor("3799", "Very Dark Pewter Gray", "#383838"),

  // Blue-Grays and Teals
  createColor("168", "Very Light Pewter", "#C0C0C0"),
  createColor("169", "Light Pewter", "#A0A0A0"),
  createColor("597", "Turquoise", "#38A0A8"),
  createColor("598", "Light Turquoise", "#70C0C8"),
  createColor("924", "Very Dark Gray Green", "#486860"),
  createColor("926", "Medium Gray Green", "#90A8A0"),
  createColor("927", "Light Gray Green", "#B8C8C0"),
  createColor("928", "Very Light Gray Green", "#D0E0D8"),
  createColor("930", "Dark Antique Blue", "#385878"),
  createColor("931", "Medium Antique Blue", "#5878A0"),
  createColor("932", "Light Antique Blue", "#88A8C8"),
  createColor("3752", "Very Light Antique Blue", "#B8C8D8"),
  createColor("3753", "Ultra Very Light Antique Blue", "#DBE2E9"),  // provisional
  createColor("3756", "Ultra Very Light Baby Blue", "#E8F0F8"),
  createColor("3808", "Ultra Very Dark Turquoise", "#106060"),
  createColor("3809", "Very Dark Turquoise", "#187078"),
  createColor("3810", "Dark Turquoise", "#288890"),
  createColor("3811", "Very Light Turquoise", "#A8E0E8"),
];

// Get color by DMC number
export function getDmcColorByNumber(dmcNumber: string): DmcColor | undefined {
  // Exact match first
  let color = DMC_PEARL_COTTON.find(c => c.dmcNumber === dmcNumber);
  if (color) return color;

  // Try case-insensitive match (for BLANC, ECRU, etc.)
  const upperDmc = dmcNumber.toUpperCase();
  color = DMC_PEARL_COTTON.find(c => c.dmcNumber.toUpperCase() === upperDmc);
  if (color) return color;

  // Try stripping leading zeros (e.g., "0310" -> "310")
  const stripped = dmcNumber.replace(/^0+/, '');
  if (stripped !== dmcNumber) {
    color = DMC_PEARL_COTTON.find(c => c.dmcNumber === stripped);
    if (color) return color;
  }

  // Try adding leading zeros for single/double digit numbers (e.g., "1" -> "01")
  if (/^\d{1,2}$/.test(dmcNumber)) {
    const padded = dmcNumber.padStart(2, '0');
    color = DMC_PEARL_COTTON.find(c => c.dmcNumber === padded);
    if (color) return color;
  }

  return undefined;
}

// Search colors by name
export function searchDmcColors(query: string): DmcColor[] {
  const lowerQuery = query.toLowerCase();
  return DMC_PEARL_COTTON.filter(c =>
    c.name.toLowerCase().includes(lowerQuery) ||
    c.dmcNumber.toLowerCase().includes(lowerQuery)
  );
}

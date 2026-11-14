// Where each palette hex came from.
//
// Nothing in dmc-pearl-cotton.ts distinguishes a value eyeballed in 2023 from
// one that was checked, which is why the palette keeps getting patched a colour
// at a time with no memory of the last patch: 33 Fuchsia in Aug 2026, 3753 in
// Jan 2026, and eight more in Nov 2026, each one argued from scratch. This is
// the record so the next argument starts from what is already known.
//
// Derived, not hand-listed — the full 480 keys come from the palette itself, so
// a colour added there cannot be missed here, and an import into dmc-measured.ts
// flips its entries to "measured" with no edit to this file.

import { DMC_PEARL_COTTON } from "./dmc-pearl-cotton";
import { MEASURED } from "./dmc-measured";

export type ColorSource = "legacy-eyeballed" | "hand-corrected" | "measured";

/** Values changed by hand against evidence, with the evidence named in the
 *  commit or in the note above DMC_PEARL_COTTON. Still guesses — better-argued
 *  ones — so they stay "hand-corrected" until a reading supersedes them. */
const HAND_CORRECTED: ReadonlySet<string> = new Set([
  "33",    // 63e7ba3, Aug 2026: #D9539F -> #C32278 against the real skein
  "3753",  // b11644f, Jan 2026; corrected again Nov 2026 on photo+public consensus
  "415",   // Nov 2026: photo + public table agree to 1.9 dE, palette was 9.2 off
  "666",   // Nov 2026: same, agree to 1.5 dE, palette 8.2 off
  "B5200", // Nov 2026: off #FFFFFF
  "07",    // Nov 2026: the six byte-identical pairs, split
  "368",
  "535",
  "645",
  "988",
  "3346",
]);

// 310 Black is deliberately absent. It was moved off #000000 on 2026-11-13 and
// reverted the same day — a palette hex seeds the saved print overrides, and
// #000000 -> #131313 moves the generated override from #1F1F1F to #2E2E2E on
// the 73 live designs that stitch 310 and store none (see the note above
// DMC_PEARL_COTTON). The value is back to the legacy one, so the label is back
// to "legacy-eyeballed": this file records where a hex came from, not which
// hexes have been argued about.

export function provenanceOf(dmcNumber: string): ColorSource {
  if (MEASURED[dmcNumber]) return "measured";
  if (HAND_CORRECTED.has(dmcNumber)) return "hand-corrected";
  return "legacy-eyeballed";
}

export const PROVENANCE: Record<string, ColorSource> = Object.fromEntries(
  DMC_PEARL_COTTON.map(c => [c.dmcNumber, provenanceOf(c.dmcNumber)]),
);

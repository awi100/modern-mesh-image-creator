import { describe, it, expect } from "vitest";
import { DMC_PEARL_COTTON } from "./dmc-pearl-cotton";
import {
  ladderViolations, tooClosePairs, readLadder, deltaE2000,
  duplicateHexes, impossibleExtremes, labHexDisagreement,
  isClampedMeasurement, labHexMismatches, onEightStepGrid,
} from "./dmc-palette-checks";

// Two kinds of check live here, and the difference matters.
//
// HARD assertions are invariants the palette actually satisfies today. They may
// never regress.
//
// RATCHETS are the frozen lists below: a record of what was still wrong on
// 2026-11-13, re-derived against the palette as it stands after that day's
// corrections. A new violation fails the build, and FIXING a listed one also
// fails the build, telling you to strike it off. Both directions are needed,
// because a list that only ever gets appended to stops being a record of
// anything. The lists may only shrink.
//
// None of this proves a colour matches the thread in the bag — only a reading
// off a real skein does that. It proves the palette is not self-contradictory.
//
// OUT-OF-GAMUT POLICY, the same rule stated in dmc-palette-checks.ts and in
// scripts/import-thread-measurements.ts: a measured Lab outside sRGB is an
// EXPECTED result of reading real saturated dye. The importer accepts it,
// keeps the lab exact and clamps only the hex, so the two hex-shaped
// assertions below (pure black/white, lab-agrees-with-hex) exempt a clamped
// measurement and "measured entries carry the hex their own lab converts to"
// covers those instead. A suite that reddened on the first real measurement
// session, over a reading the operator cannot do anything about, would be
// switched off within the week.

// ---------------------------------------------------------------------------

describe("the lightness ladder in DMC names", () => {
  // DMC names encode lightness order: "Ultra Very Light" < "Very Light" <
  // "Light" < "Medium Light" < "Medium" < "Dark" < "Very Dark" < "Ultra Very
  // Dark". If "Dark Rose" renders lighter than "Very Dark Rose", one of the two
  // hexes is provably wrong, whatever the real thread looks like.

  const KNOWN_INVERSIONS = [
    "156<340",   // Medium Light Blue Violet L*53.5 vs Medium Blue Violet L*59.0
    "309<326",   // Dark Rose L*35.4 vs Very Dark Rose L*41.7
    "315<3726",  // Medium Dark Antique Mauve L*37.9 vs Dark Antique Mauve L*44.0
    "3345<895",  // Dark Hunter Green L*20.5 vs Very Dark Hunter Green L*29.3
    "814<902",   // Dark Garnet L*19.6 vs Very Dark Garnet L*21.6
    "935<936",   // Dark Avocado Green L*23.8 vs Very Dark Avocado Green L*27.0
    "955<13",    // Light Nile Green L*90.2 vs Medium Light Nile Green L*92.7
  ];

  const found = ladderViolations(DMC_PEARL_COTTON);

  it("has no inversions beyond the seven already on record", () => {
    const unexpected = found
      .filter(v => !KNOWN_INVERSIONS.includes(v.key))
      .map(v => `${v.lighter.dmcNumber} ${v.lighter.name} (L*${v.lighter.lab.l.toFixed(1)}) ` +
                `should be lighter than ${v.darker.dmcNumber} ${v.darker.name} (L*${v.darker.lab.l.toFixed(1)})`);
    expect(unexpected).toEqual([]);
  });

  it("still has every inversion the list claims — strike off the ones you fixed", () => {
    const keys = found.map(v => v.key);
    const stale = KNOWN_INVERSIONS.filter(k => !keys.includes(k));
    expect(stale).toEqual([]);
  });

  it("reads both DMC name shapes", () => {
    // "Very Light Tender Green" and "Mocha Brown Ultra Very Light" are the same
    // ladder written two ways, and "Medium Light" must beat "Light".
    expect(readLadder({ name: "Very Light Tender Green" } as never)).toMatchObject({ family: "tender green", rank: 1 });
    expect(readLadder({ name: "Mocha Brown Ultra Very Light" } as never)).toMatchObject({ family: "mocha brown", rank: 0 });
    expect(readLadder({ name: "Medium Light Driftwood" } as never)).toMatchObject({ family: "driftwood", rank: 2.5 });
    expect(readLadder({ name: "Driftwood" } as never)).toMatchObject({ family: "driftwood", modifier: null });
  });
});

// ---------------------------------------------------------------------------

describe("two DMC numbers never render as the same colour", () => {
  // A design stores DMC numbers, not hex, so this is a usability bug rather
  // than a data bug: the shopping list says 320 and 988 and the screen shows
  // one colour. It is worse for photo import — findNearestDmcColor breaks ties
  // by array position, so the later of a byte-identical pair can never be
  // picked at all. Six threads were unreachable that way until Nov 2026.

  it("has no two entries sharing a hex", () => {
    // HARD: all six pairs (07/453, 318/535, 320/988, 367/3346, 368/989,
    // 645/3787) were separated on 2026-11-13. All 480 hexes are now distinct
    // and must stay that way.
    const dupes = duplicateHexes(DMC_PEARL_COTTON)
      .map(g => `${g.hex} shared by ${g.dmcNumbers.join(", ")}`);
    expect(dupes).toEqual([]);
  });

  const KNOWN_TOO_CLOSE = [
    "15=772",      // Apple Green vs Very Light Yellow Green, dE 1.06
    "24=25",       // White Lavender vs Ultra Light Lavender, dE 1.26
    "304=817",     // Medium Red vs Very Dark Coral Red, dE 1.25
    "307=973",     // Lemon vs Bright Canary, dE 1.38
    "349=3801",    // Dark Coral vs Very Dark Melon, dE 0.63
    "350=3705",    // Medium Coral vs Dark Melon, dE 1.48
    "353=3708",    // Peach vs Light Melon, dE 0.56
    "3689=776",    // Light Mauve vs Medium Pink, dE 0.89
    "3753=3841",   // Ultra Very Light Antique Blue vs Pale Baby Blue, dE 0.54
    "3771=758",    // the two palest Terra Cottas, dE 1.29
    "3823=746",    // Ultra Pale Yellow vs Off White, dE 1.06
    "3831=601",    // Dark Raspberry vs Dark Cranberry, dE 0.97
    "3847=991",    // Dark Teal Green vs Dark Aquamarine, dE 1.38
    "3850=910",    // Dark Bright Green vs Dark Emerald Green, dE 1.50
    "712=ECRU",    // Ecru and Cream really are near-twins; expected to stay.
    "B5200=BLANC", // Snow White and White really are near-twins; expected to stay.
  ];

  it("no pair is under 1.5 dE2000 beyond the sixteen already on record", () => {
    // 1.5 dE2000 is roughly the point where two swatches side by side stop
    // being tellable apart on a decent screen. The list was twenty-two before
    // the six byte-identical pairs were split apart.
    const got = tooClosePairs(DMC_PEARL_COTTON, 1.5);
    const unexpected = got
      .filter(p => !KNOWN_TOO_CLOSE.includes(p.key))
      .map(p => `${p.a.dmcNumber} ${p.a.name} ${p.a.hex} vs ${p.b.dmcNumber} ${p.b.name} ${p.b.hex} (dE ${p.deltaE.toFixed(2)})`);
    expect(unexpected).toEqual([]);
  });

  it("still has all sixteen — strike off the ones you separated", () => {
    const keys = tooClosePairs(DMC_PEARL_COTTON, 1.5).map(p => p.key);
    expect(KNOWN_TOO_CLOSE.filter(k => !keys.includes(k))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("the palette is structurally sane", () => {
  it("has no duplicate DMC numbers", () => {
    const nums = DMC_PEARL_COTTON.map(c => c.dmcNumber);
    expect(nums.length).toBe(new Set(nums).size);
  });

  it("stores every hex as a full 6-digit #RRGGBB", () => {
    // createColor() slices fixed byte offsets out of the string, so #ABC would
    // silently parse as NaN and the colour would render transparent.
    const bad = DMC_PEARL_COTTON.filter(c => !/^#[0-9A-Fa-f]{6}$/.test(c.hex));
    expect(bad.map(c => `${c.dmcNumber} ${c.hex}`)).toEqual([]);
  });

  // RATCHET, not a hard assertion. No dye absorbs or reflects everything, and
  // the practical cost is in stitch-preview.ts: at #000000 darkenColor()
  // returns black unchanged, so 310's stitch gradient has no shadow half, and
  // B5200 at #FFFFFF had no highlight.
  //
  // B5200 was moved off the rail on 2026-11-13 (-> #FDFDFF at L*99.36) and must
  // stay off it. 310 was moved the same day and REVERTED the same day, and the
  // reason is recorded in full above DMC_PEARL_COTTON: a palette hex seeds the
  // print-colour overrides, adjustColorForPrint("#000000") = #1F1F1F against
  // #2E2E2E for #131313, and 73 live designs that stitch 310 store no override
  // yet — so the next visit to each of their colours pages would have banked 15
  // levels per channel lighter on canvas that costs money. Black's real value
  // is a measurement question; strike 310 off this list only after every design
  // that stitches it has had its print overrides frozen.
  const KNOWN_EXTREMES = ["310"];

  it("has no thread at pure black or pure white beyond the one on record", () => {
    // A clamped measurement is exempt (see the policy at the top): B5200 read
    // at L*99.95 really is #FFFFFF, and the answer to that is to re-read the
    // skein, not to fail the build.
    const bad = impossibleExtremes(DMC_PEARL_COTTON)
      .filter(c => !KNOWN_EXTREMES.includes(c.dmcNumber))
      .map(c => `${c.dmcNumber} ${c.name} ${c.hex}`);
    expect(bad).toEqual([]);
  });

  it("still has every extreme the list claims — strike off the ones you moved", () => {
    const at = impossibleExtremes(DMC_PEARL_COTTON).map(c => c.dmcNumber);
    expect(KNOWN_EXTREMES.filter(n => !at.includes(n))).toEqual([]);
  });

  it("keeps B5200 first in the array", () => {
    // store.ts:238 reads DMC_PEARL_COTTON[0] as the default colour rather than
    // looking one up, so re-sorting or re-grouping the literals silently
    // changes what a new design starts with.
    expect(DMC_PEARL_COTTON[0].dmcNumber).toBe("B5200");
  });

  it("derives rgb that round-trips the hex", () => {
    const bad = DMC_PEARL_COTTON.filter(c => {
      const back = "#" + [c.rgb.r, c.rgb.g, c.rgb.b]
        .map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
      return back !== c.hex.toUpperCase();
    });
    expect(bad.map(c => c.dmcNumber)).toEqual([]);
  });

  it("stores a lab that agrees with its own hex", () => {
    // Not equality: createColor passes a MEASURED lab straight through instead
    // of re-deriving it, because 8-bit sRGB quantises Lab into roughly 0.4 dE
    // steps and lab is what findNearestDmcColor and the photo quantization in
    // color-utils.ts actually read. 1.0 dE2000 leaves room for that rounding.
    // Every entry is at 0.00 today, MEASURED being empty.
    //
    // Clamped measurements are exempt: the clamp IS a move away from the lab,
    // so this number is meaningless for them — 995 at L*53.91 a*-6.73 b*-47
    // reads 1.96 and is a good reading. The test below is their version.
    const bad = DMC_PEARL_COTTON
      .map(c => ({ c, d: labHexDisagreement(c) }))
      .filter(({ c, d }) => !Number.isFinite(c.lab.l) || (d >= 1.0 && !isClampedMeasurement(c)))
      .map(({ c, d }) => `${c.dmcNumber} ${c.hex} lab is ${d.toFixed(2)} dE2000 off its hex`);
    expect(bad).toEqual([]);
  });

  it("gives every measured entry the hex its own lab converts to", () => {
    // What replaces the dE check for a clamped reading, and is stricter than it
    // for an unclamped one: exact, clamp included. Nothing but the importer
    // writes hex and lab together, so a mismatch means an import paired a lab
    // with the wrong hex — the failure the dE check was really there to catch.
    // Vacuous while MEASURED is empty, and the first real import is what gives
    // it teeth.
    expect(labHexMismatches(DMC_PEARL_COTTON)).toEqual([]);
  });

  it("never puts another hex on the 8-step grid", () => {
    // RATCHET on the one number that says how much of this palette was picked
    // off a colour wheel, the number quoted in the header of
    // dmc-palette-checks.ts. 213 of 480 on 2026-11-13.
    //
    // An upper bound, not equality, for the same reason the clamped exemptions
    // exist: measuring a colour is what takes it OFF the grid — 995 is
    // #1088C8, all three bytes multiples of 8, and importing a reading for it
    // drops the count to 212. A test that failed because somebody finally
    // measured something would be the problem, not the finding. It may only
    // fall; a new value landing on the grid is a hex dragged off a picker.
    expect(onEightStepGrid(DMC_PEARL_COTTON).length).toBeLessThanOrEqual(213);
  });

  it("holds 480 colours", () => {
    // A guard on careless edits: adding or losing a row should be deliberate.
    expect(DMC_PEARL_COTTON.length).toBe(480);
  });

  it("agrees with a hand-computed dE2000", () => {
    // Sharma et al. 2005 reference pair, so a refactor cannot quietly break the
    // formula every other check leans on.
    expect(deltaE2000({ l: 50, a: 2.6772, b: -79.7751 }, { l: 50, a: 0, b: -82.7485 }))
      .toBeCloseTo(2.0425, 3);
    expect(deltaE2000({ l: 50, a: 2.5, b: 0 }, { l: 50, a: 0, b: -2.5 })).toBeCloseTo(4.3065, 3);
  });
});

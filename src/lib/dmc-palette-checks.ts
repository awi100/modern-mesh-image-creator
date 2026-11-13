// Structural invariants for the DMC Pearl Cotton palette.
//
// What these checks can do: show that a value is not self-contradictory — not a
// byte-for-byte copy of another thread's, not physically impossible, not in
// conflict with the lightness its own DMC name advertises, not out of step with
// the lab derived beside it.
//
// What they cannot do: tell you a colour is RIGHT. DMC has never published RGB
// or hex for any thread line, so every value in dmc-pearl-cotton.ts is somebody
// eyeballing a screen. The two best public datasets (Wolfram n=454, camelia
// n=455) disagree with EACH OTHER by a median 4.05 dE2000 — the same size as
// their disagreement with ours — so there is no table to check against and a
// wholesale swap to either is churn, not improvement. 213 of the 480 hexes
// still have all three bytes on an 8-step grid, which happens by chance about
// 0.2% of the time: the fingerprint of values picked off a colour wheel. (It
// was 212 for the few hours 310 sat at #131313; holding it at #000000 puts it
// back on the grid. The test ratchets it, so it may fall — measuring a colour
// takes it off the grid — but nothing new may land on it.) Only a reading off a
// real skein makes a value right (dmc-measured.ts),
// and that is bounded to the 77 colours the business physically holds.
//
// So: a green test here means nothing was broken, never that the palette is
// accurate. Do not let it stand in for measuring.
//
// This file is validation tooling and is deliberately NOT on the sync list with
// the public app. Only dmc-pearl-cotton.ts itself is shared.

import { DmcColor, deltaE76, labToRgb, rgbToLab } from "./dmc-pearl-cotton";
import { MEASURED } from "./dmc-measured";

export interface Lab { l: number; a: number; b: number }

/** CIEDE2000. deltaE76 in the palette module overstates differences in blues and
 *  understates them in neutrals; for "are these two threads distinguishable?"
 *  we want the modern formula. ~1.0 = just noticeable, ~3 = visible side by side. */
export function deltaE2000(x: Lab, y: Lab): number {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(x.a, x.b), C2 = Math.hypot(y.a, y.b);
  const Cb = (C1 + C2) / 2;
  const Cb7 = Math.pow(Cb, 7);
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)));
  const a1 = (1 + G) * x.a, a2 = (1 + G) * y.a;
  const C1p = Math.hypot(a1, x.b), C2p = Math.hypot(a2, y.b);
  const h1 = a1 === 0 && x.b === 0 ? 0 : (Math.atan2(x.b, a1) * deg + 360) % 360;
  const h2 = a2 === 0 && y.b === 0 ? 0 : (Math.atan2(y.b, a2) * deg + 360) % 360;
  const dL = y.l - x.l, dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lb = (x.l + y.l) / 2, Cbp = (C1p + C2p) / 2;
  let hb = h1 + h2;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1 - h2) <= 180) hb = (h1 + h2) / 2;
    else hb = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad)
    + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.20 * Math.cos((4 * hb - 63) * rad);
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Cbp7 = Math.pow(Cbp, 7);
  const Rt = -2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625))
    * Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2
    + Rt * (dC / Sc) * (dH / Sh));
}

// --- name ladder -----------------------------------------------------------
// DMC names encode lightness: "Ultra Very Light" ... "Ultra Very Dark".
// An unmodified name ("Olive Green") is NOT the middle of its family — DMC puts
// it darker than "Medium" (732 Olive Green is darker than 733 Medium Olive
// Green). Because that convention is not universal, pairs where one side is
// unmodified are reported separately and are not asserted on.
const MODIFIERS: ReadonlyArray<[string, number]> = ([
  ["ultra very light", 0], ["ultra light", 0.5], ["very light", 1],
  ["medium light", 2.5], ["light", 2],
  ["medium dark", 4.6], ["medium", 4],
  ["ultra very dark", 7], ["ultra dark", 6.5], ["very dark", 6], ["dark", 5],
] as [string, number][]).sort((a, b) => b[0].length - a[0].length);

/** "pale" / "bright" / "deep" are used inconsistently by DMC and are excluded. */
const AMBIGUOUS = ["pale", "bright", "deep"];

export interface Rung { color: DmcColor; family: string; rank: number; modifier: string | null }

export function readLadder(c: DmcColor): Rung {
  const n = c.name.toLowerCase().trim();
  for (const [mod, rank] of MODIFIERS) {
    if (n.startsWith(mod + " ")) return { color: c, family: n.slice(mod.length + 1).trim(), rank, modifier: mod };
    if (n.endsWith(" " + mod)) return { color: c, family: n.slice(0, -(mod.length + 1)).trim(), rank, modifier: mod };
  }
  return { color: c, family: n, rank: 3, modifier: null };
}

export function isAmbiguous(c: DmcColor): boolean {
  const words = c.name.toLowerCase().split(/\s+/);
  return AMBIGUOUS.some(w => words.includes(w));
}

export interface LadderViolation { family: string; lighter: DmcColor; darker: DmcColor; key: string }

/** Pairs within one family where the lighter-NAMED colour is not lighter in L*.
 *  Only pairs where BOTH names carry an explicit modifier, so the result does
 *  not depend on where the unmodified base name sits. */
export function ladderViolations(palette: readonly DmcColor[]): LadderViolation[] {
  const byFamily = new Map<string, Rung[]>();
  for (const c of palette) {
    if (isAmbiguous(c)) continue;
    const r = readLadder(c);
    if (r.modifier === null) continue;
    const list = byFamily.get(r.family) ?? [];
    list.push(r);
    byFamily.set(r.family, list);
  }
  const out: LadderViolation[] = [];
  for (const [family, rungs] of byFamily) {
    for (let i = 0; i < rungs.length; i++) {
      for (let j = i + 1; j < rungs.length; j++) {
        if (rungs[i].rank === rungs[j].rank) continue;
        const [lt, dk] = rungs[i].rank < rungs[j].rank ? [rungs[i], rungs[j]] : [rungs[j], rungs[i]];
        if (lt.color.lab.l <= dk.color.lab.l) {
          out.push({
            family,
            lighter: lt.color,
            darker: dk.color,
            key: `${lt.color.dmcNumber}<${dk.color.dmcNumber}`,
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// The ladder is the ONLY name-vs-value check in this file, and the only one
// that should ever be added. A hue-vs-name check ("a colour named Green must
// sit in the green hue band") was built and run: about ten of its twelve hits
// were genuine DMC naming rather than bad data — 500-504 "Blue Green" are
// greens at hue 154-167 deg, 3045 "Dark Yellow Beige" is a brown, 155
// "Forget-Me-Not Blue" is a violet. DMC names a thread for the shade-card
// family it ships in, not for its hue. A check that is 80% false positives gets
// skipped within a month and takes the real checks in this file down with it,
// so it is not here on purpose. Do not add it back.

// --- hex / lab sanity ------------------------------------------------------

export interface HexGroup { hex: string; dmcNumbers: string[]; key: string }

/** Entries sharing a byte-identical hex. findNearestDmcColor breaks ties by
 *  array position, so the later half of such a pair is unreachable from photo
 *  import entirely — six threads were in that state until Nov 2026. */
export function duplicateHexes(palette: readonly DmcColor[]): HexGroup[] {
  const byHex = new Map<string, string[]>();
  for (const c of palette) {
    const k = c.hex.toUpperCase();
    byHex.set(k, [...(byHex.get(k) ?? []), c.dmcNumber]);
  }
  return [...byHex.entries()]
    .filter(([, nums]) => nums.length > 1)
    .map(([hex, dmcNumbers]) => ({ hex, dmcNumbers, key: dmcNumbers.join(",") }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// --- out-of-gamut policy ---------------------------------------------------
//
// Stated in the same words in scripts/import-thread-measurements.ts (the NOTE
// it prints, and the comment on Measured.clamped): a measured Lab outside sRGB
// is an EXPECTED result of reading real saturated dye, not a bad reading. 995
// Electric Blue gets there with only ~5.6 b* units more chroma than the
// eyeballed value it replaces, and a white read at L*99.95 clamps to #FFFFFF.
// The importer keeps the lab exact — lab is what findNearestDmcColor and the
// photo quantizer in color-utils.ts read — and clamps only the hex, which
// exists for the screen.
//
// So the two assertions below, both of which reason about the hex, exempt a
// clamped measurement rather than calling a correct reading a defect:
// labHexDisagreement cannot be small when the hex was clamped away from its
// own lab, and #FFFFFF is a true reading of an optically brightened thread.
// labHexMismatches() is what replaces them for those entries: it still catches
// an import that paired a lab with the wrong hex, because the hex must be
// exactly what that lab converts to, clamp included.

/** An entry whose hex is a clamp of a measured Lab that falls outside sRGB.
 *  Same test as the importer's `clamped`: labToRgb pins to 0/255, so a channel
 *  resting on either rail is the clamp showing. */
export function isClampedMeasurement(c: DmcColor): boolean {
  const m = MEASURED[c.dmcNumber];
  if (!m) return false;
  const { r, g, b } = labToRgb(m.lab.l, m.lab.a, m.lab.b);
  return r === 0 || g === 0 || b === 0 || r === 255 || g === 255 || b === 255;
}

/** Measured entries whose stored hex is not what their own stored lab converts
 *  to. Exact, so it works on a clamped entry where the dE2000 check cannot, and
 *  it is the check that actually catches an import pairing a lab with the wrong
 *  hex — nothing but the importer writes either field. */
export function labHexMismatches(palette: readonly DmcColor[]): string[] {
  const out: string[] = [];
  for (const c of palette) {
    if (!MEASURED[c.dmcNumber]) continue;
    const { r, g, b } = labToRgb(c.lab.l, c.lab.a, c.lab.b);
    const expect = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0").toUpperCase()).join("");
    if (expect !== c.hex.toUpperCase()) out.push(`${c.dmcNumber} hex ${c.hex} but its lab converts to ${expect}`);
  }
  return out.sort();
}

/** Entries with all three bytes on the 8-step grid (every channel a multiple of
 *  8). The fingerprint of a value dragged off a colour-wheel picker rather than
 *  read off thread: it happens by chance about 0.2% of the time, and 213 of 480
 *  is the size of the eyeballing problem in one number. It can only fall:
 *  measuring a colour or correcting it by hand is what takes it off the grid. */
export function onEightStepGrid(palette: readonly DmcColor[]): DmcColor[] {
  return palette.filter(c => c.rgb.r % 8 === 0 && c.rgb.g % 8 === 0 && c.rgb.b % 8 === 0);
}

/** Pure #000000 / #FFFFFF. No dyed thread absorbs or reflects everything, and
 *  at the extremes darkenColor()/lightenColor() in stitch-preview.ts have
 *  nothing left to move, so the stitch gradient loses half its relief.
 *
 *  A clamped measurement is exempt per the policy above: B5200 read at L*99.95
 *  really does clamp to #FFFFFF, and losing the highlight half of one stitch
 *  gradient is the honest cost of a true reading, not a data error to refuse. */
export function impossibleExtremes(palette: readonly DmcColor[]): DmcColor[] {
  return palette.filter(c => /^#(000000|FFFFFF)$/i.test(c.hex) && !isClampedMeasurement(c));
}

/** How far an entry's stored lab is from the lab its own hex implies, in
 *  dE2000. Zero for a derived entry; an in-gamut measured one carries its
 *  instrument lab straight through (see createColor), so it only has to agree
 *  with the 8-bit hex to within quantisation, about 0.4 dE.
 *
 *  Meaningless for a clamped measurement — the clamp is exactly a move away
 *  from the lab — so callers skip those (isClampedMeasurement) and use
 *  labHexMismatches instead. 995 at L*53.91 a*-6.73 b*-47 reads 1.96 here and
 *  is a perfectly good reading. */
export function labHexDisagreement(c: DmcColor): number {
  return deltaE2000(c.lab, rgbToLab(c.rgb.r, c.rgb.g, c.rgb.b));
}

export interface ClashPair { a: DmcColor; b: DmcColor; deltaE: number; key: string }

/** Distinct DMC numbers whose on-screen colour is closer than `limit` dE2000. */
export function tooClosePairs(palette: readonly DmcColor[], limit: number): ClashPair[] {
  const out: ClashPair[] = [];
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      const d = deltaE2000(palette[i].lab, palette[j].lab);
      if (d < limit) {
        const [a, b] = [palette[i], palette[j]];
        out.push({ a, b, deltaE: d, key: [a.dmcNumber, b.dmcNumber].sort().join("=") });
      }
    }
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

export { deltaE76 };

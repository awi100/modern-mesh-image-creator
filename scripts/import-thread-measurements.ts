/**
 * Turn measured thread readings into src/lib/dmc-measured.ts.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/import-thread-measurements.ts
 *   npx tsx --tsconfig tsconfig.json scripts/import-thread-measurements.ts --csv /path/to.csv
 *   npx tsx --tsconfig tsconfig.json scripts/import-thread-measurements.ts --dry
 *   npx tsx --tsconfig tsconfig.json scripts/import-thread-measurements.ts --allow-drift
 *
 * No database, no network — a CSV in, one generated file out. Capture
 * procedure in scripts/data/README.md; which colours to shoot in
 * scripts/data/measurement-scope.json.
 *
 * The file is written whole from the CSV every time, so the CSV is the record
 * and this file is disposable output. Re-running on an unchanged CSV must
 * produce byte-identical output or the diff is noise: that means sorting by
 * palette order rather than Map order, and fixing the rounding here instead of
 * letting float formatting drift.
 *
 * Running it over a CSV with no data rows restores the empty file, which is how
 * you back an import out.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { DMC_PEARL_COTTON, labToRgb, rgbToLab } from "../src/lib/dmc-pearl-cotton";
import { deltaE2000, type Lab } from "../src/lib/dmc-palette-checks";

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const CSV = arg("--csv", join(__dirname, "data", "thread-measurements.csv"));
const OUT = arg("--out", join(__dirname, "..", "src", "lib", "dmc-measured.ts"));
const DRY = process.argv.includes("--dry");
const ALLOW_DRIFT = process.argv.includes("--allow-drift");

/** Above this the samples of one colour disagree more than the thing being
 *  measured: 2.5 dE2000 is roughly the gap between two adjacent rungs of a DMC
 *  shade ladder, so a spread that wide cannot tell them apart. Reshoot. */
const SPREAD_LIMIT = 2.5;

/** Lab a* and b* are unbounded in principle, but real surface colour lives well
 *  inside +-128 — the most chromatic thread in the palette is 995 Electric Blue
 *  at about a*-6.7 b*-47. The bound is here because a* and b* are the two
 *  SIGNED channels, so they are where a decimal point or a minus sign goes
 *  missing: a*-383.20 typed for a*-38.32 is finite, is consistent across every
 *  sample typed from the same bad reading (spread 0.02), and would be written
 *  straight into what findNearestDmcColor and the photo quantizer read. */
const AB_LIMIT = 128;

/** L* ceiling. Optically brightened whites fluoresce under a D65 source that
 *  carries UV and genuinely read a little over 100; B5200 and BLANC are both in
 *  scope and both do it. Refusing at exactly 100 threw away every other colour
 *  in the batch over one L*100.4 white, so allow a little headroom and warn.
 *  Past 101 it is arithmetic, not a brightener. */
const L_HEADROOM = 101;

/** dE2000 between a reading and the hand-written literal it replaces, past
 *  which a typo is likelier than a correction. The largest hand correction ever
 *  argued from a real skein was 33 Fuchsia at 11.63 (#D9539F -> #C32278); a
 *  dropped decimal point on a* lands near 35 and a lost minus sign near 54. 20
 *  sits between them. --allow-drift when a reading really is that far out. */
const DRIFT_LIMIT = 20;

const COLUMNS = [
  "dmcNumber", "sampleId", "L", "a", "b",
  "instrument", "geometry", "illuminant", "observer", "measuredAt", "note",
] as const;

type Row = Record<(typeof COLUMNS)[number], string> & { line: number };

/** Minimal RFC4180: quoted fields, doubled quotes inside them. Notes carry
 *  commas ("sheet A, frame 3"), which a plain split silently shifts into the
 *  next column — and a shifted column is a wrong number, not an error. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readRows(text: string): Row[] {
  const lines = parseCsv(text);
  const out: Row[] = [];
  let header: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].map((c) => c.trim());
    if (!cells.length || cells.every((c) => !c)) continue;
    // '#' comments out a line. The shipped template uses it to carry example
    // rows that document the format without ever being imported as readings.
    if (cells[0].startsWith("#")) continue;
    if (!header) {
      header = cells;
      const missing = COLUMNS.filter((c) => !header!.includes(c));
      if (missing.length) fail(`header is missing column(s): ${missing.join(", ")}`);
      continue;
    }
    const row = { line: i + 1 } as Row;
    for (const col of COLUMNS) row[col] = cells[header.indexOf(col)] ?? "";
    out.push(row);
  }
  if (!header) fail(`${CSV} has no header row`);
  return out;
}

/** Shape AND calendar. measuredAt for a colour is picked by sort().at(-1), so a
 *  date that only LOOKS right sorts above every real date in the set and becomes
 *  the recorded measurement date: "2026-13-45" passes /^\d{4}-\d{2}-\d{2}$/ and
 *  sorts after "2026-11-20". Parse it and compare the parse back. */
function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function fail(message: string): never {
  console.error(`REFUSING TO WRITE: ${message}`);
  process.exit(1);
}

/** Per-channel median, not mean: one frame that caught a specular highlight off
 *  the mercerized finish reads several dE light, and a mean lets that one frame
 *  move the answer. Taken channel by channel, which is not the multivariate
 *  median but is what every sample in a sound set agrees with anyway — a set
 *  where it matters is a set whose spread already failed. */
function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round = (n: number, places: number) => {
  // -0 prints as "-0" and would differ from a later run that happened to land
  // on +0, so normalise it away.
  const r = Number(n.toFixed(places));
  return Object.is(r, -0) ? 0 : r;
};

const hexOf = (lab: Lab) => {
  const { r, g, b } = labToRgb(lab.l, lab.a, lab.b);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
};

/** The hex literals as written in dmc-pearl-cotton.ts.
 *
 *  Not DMC_PEARL_COTTON[].hex: createColor already substitutes MEASURED, so
 *  reading the palette would compare the second run's import against itself and
 *  report 0.00 everywhere. The "how wrong were we?" baseline has to be the
 *  value that was there before anyone measured anything. */
function paletteLiterals(): Map<string, string> {
  const src = readFileSync(join(__dirname, "..", "src", "lib", "dmc-pearl-cotton.ts"), "utf8");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/createColor\("([^"]+)",\s*"[^"]*",\s*"(#[0-9A-Fa-f]{6})"\)/g))
    out.set(m[1], m[2].toUpperCase());
  if (out.size !== DMC_PEARL_COTTON.length)
    fail(`parsed ${out.size} hex literals but the palette has ${DMC_PEARL_COTTON.length} — the createColor call shape changed`);
  return out;
}

const HEADER = `// GENERATED by scripts/import-thread-measurements.ts — do not edit by hand.
//
// Spectro/camera readings of skeins we physically hold. DMC has never published
// RGB for any thread line, so every hex in dmc-pearl-cotton.ts is somebody's
// screen-eyeballing; the two best public datasets (Wolfram n=454, camelia n=455)
// disagree with EACH OTHER by a median 4.05 dE2000, the same size as their
// disagreement with ours. Swapping to either is churn. Measuring is the only
// real fix, and it is bounded: the business owns 77 of the 480 colours.
//
// Keyed by dmcNumber exactly as dmc-pearl-cotton.ts spells it ("B5200", "07",
// "BLANC"), so an entry landing here reaches every hex consumer at once.

export interface MeasuredColor {
  hex: string;                              // calibrated sRGB
  lab: { l: number; a: number; b: number };  // measured CIELAB, D65/2deg
  n: number;                                 // samples averaged
  spread: number;                            // max CIEDE2000 between samples
  measuredAt: string;                        // ISO date
  method: string;                            // e.g. "colorchecker-passport-2 + camera, polarised"
}
`;

interface Measured {
  dmcNumber: string;
  hex: string;
  lab: Lab;
  n: number;
  spread: number;
  measuredAt: string;
  method: string;
  /** Lab outside sRGB, so hex is clamped and no longer round-trips to lab.
   *
   *  OUT-OF-GAMUT POLICY, stated in the same words in dmc-palette-checks.ts:
   *  a measured Lab outside sRGB is an EXPECTED result of reading real
   *  saturated dye, not a bad reading. 995 Electric Blue reaches it with only
   *  ~5.6 b* units more chroma than the eyeballed value it replaces. The lab is
   *  kept exact because lab is what findNearestDmcColor and the photo quantizer
   *  in color-utils.ts read; only the hex, which exists for the screen, is
   *  clamped. So these entries are NOTEs here and are exempt from the
   *  lab-vs-hex and pure-black/white assertions over there — a clamped hex
   *  cannot convert back to its own lab, and a white measured at L*99.95
   *  legitimately clamps to #FFFFFF. */
  clamped: boolean;
  /** dE2000 from the hand-written palette value this reading replaces. */
  drift: number;
}

function render(colors: Measured[]): string {
  if (!colors.length) return `${HEADER}\nexport const MEASURED: Record<string, MeasuredColor> = {};\n`;
  const body = colors.map((c) =>
    `  ${JSON.stringify(c.dmcNumber)}: { hex: ${JSON.stringify(c.hex)}, ` +
    `lab: { l: ${c.lab.l}, a: ${c.lab.a}, b: ${c.lab.b} }, ` +
    `n: ${c.n}, spread: ${c.spread}, ` +
    `measuredAt: ${JSON.stringify(c.measuredAt)}, method: ${JSON.stringify(c.method)} },`
  ).join("\n");
  return `${HEADER}\nexport const MEASURED: Record<string, MeasuredColor> = {\n${body}\n};\n`;
}

function main() {
  let text: string;
  try { text = readFileSync(CSV, "utf8"); }
  catch { fail(`cannot read ${CSV}`); }

  const rows = readRows(text);
  const literals = paletteLiterals();
  const order = new Map(DMC_PEARL_COTTON.map((c, i) => [c.dmcNumber, i]));

  // Typo guard, checked across every row before anything is written: "3706"
  // mistyped as "3760" is a real colour, lands in the palette, and silently
  // repaints a colour nobody measured.
  const unknown = [...new Set(rows.filter((r) => !order.has(r.dmcNumber)).map((r) => `${r.dmcNumber} (line ${r.line})`))];
  if (unknown.length) fail(`dmcNumber not in the palette — ${unknown.join(", ")}`);

  const warnings: string[] = [];
  for (const r of rows) {
    for (const col of ["L", "a", "b"] as const)
      if (!Number.isFinite(Number(r[col])) || r[col] === "") fail(`line ${r.line}: ${col} is not a number (${JSON.stringify(r[col])})`);
    if (Number(r.L) < 0 || Number(r.L) > L_HEADROOM) fail(`line ${r.line}: L=${r.L} is outside 0..${L_HEADROOM}`);
    if (Number(r.L) > 100)
      warnings.push(`line ${r.line}: ${r.dmcNumber} L=${r.L} is over 100 — expected only of an optically brightened white under a UV-carrying D65 source. Kept as measured.`);
    for (const col of ["a", "b"] as const)
      if (Math.abs(Number(r[col])) > AB_LIMIT) fail(`line ${r.line}: ${col}=${r[col]} is outside +-${AB_LIMIT} — a surface colour cannot be that chromatic, so check for a dropped decimal point`);
    if (!isIsoDate(r.measuredAt)) fail(`line ${r.line}: measuredAt "${r.measuredAt}" is not a real YYYY-MM-DD date`);
    // dmc-measured.ts declares D65/2deg and labToRgb assumes D65. Storing a D50
    // reading as if it were D65 bakes in a 2-4 dE error that nothing downstream
    // can see, so take the refusal instead and re-develop the shot.
    if (r.illuminant.toUpperCase() !== "D65" || r.observer.replace(/deg$/i, "") !== "2")
      fail(`line ${r.line}: ${r.dmcNumber} is ${r.illuminant}/${r.observer}; this file is D65/2deg only`);
  }

  const byColor = new Map<string, Row[]>();
  for (const r of rows) byColor.set(r.dmcNumber, [...(byColor.get(r.dmcNumber) ?? []), r]);

  const colors: Measured[] = [...byColor.entries()].map(([dmcNumber, samples]) => {
    const labs: Lab[] = samples.map((s) => ({ l: Number(s.L), a: Number(s.a), b: Number(s.b) }));
    const lab: Lab = {
      l: round(median(labs.map((x) => x.l)), 2),
      a: round(median(labs.map((x) => x.a)), 2),
      b: round(median(labs.map((x) => x.b)), 2),
    };
    let spread = 0;
    for (let i = 0; i < labs.length; i++)
      for (let j = i + 1; j < labs.length; j++) spread = Math.max(spread, deltaE2000(labs[i], labs[j]));

    const methods = [...new Set(samples.map((s) => `${s.instrument}, ${s.geometry}`))].sort();
    const rgb = labToRgb(lab.l, lab.a, lab.b);
    const hex = hexOf(lab);
    const before = literals.get(dmcNumber)!;
    const beforeLab = labOfHex(before);
    return {
      dmcNumber,
      hex,
      lab,
      n: samples.length,
      spread: round(spread, 2),
      // The latest sample's date: a colour reshot in a second session is
      // described by when it was finished, not when it was first attempted.
      measuredAt: samples.map((s) => s.measuredAt).sort().at(-1)!,
      // The observer column is accepted as "2" or "2deg" (see the validation
      // above), so normalise before appending the unit — otherwise a CSV
      // written the way the README spells it lands as "D65/2degdeg" in a
      // generated file whose whole job is to record how a reading was taken.
      method: `${methods.join(" / ")}, ${samples[0].illuminant}/${samples[0].observer.replace(/deg$/i, "")}deg`,
      clamped: rgb.r === 0 || rgb.g === 0 || rgb.b === 0 || rgb.r === 255 || rgb.g === 255 || rgb.b === 255,
      drift: deltaE2000(beforeLab, lab),
    };
  }).sort((x, y) => order.get(x.dmcNumber)! - order.get(y.dmcNumber)!);

  // Checked across every colour before anything is written, like the typo guard
  // above: a reading this far from the value it replaces is a transcription
  // mistake often enough that writing it unasked is worse than stopping.
  const wild = colors.filter((c) => c.drift > DRIFT_LIMIT);
  if (wild.length && !ALLOW_DRIFT)
    fail(`${wild.map((c) => `${c.dmcNumber} reads ${c.drift.toFixed(2)} dE2000 from ${literals.get(c.dmcNumber)} (new ${c.hex})`).join("; ")}`
      + ` — over the ${DRIFT_LIMIT} dE2000 sanity bound. Re-read the row; pass --allow-drift if the skein really is that far from the palette.`);

  const out = render(colors);
  if (!DRY) writeFileSync(OUT, out);

  console.log(`${colors.length} colours from ${rows.length} samples in ${CSV}`);
  for (const w of warnings) console.log(`  WARNING: ${w}`);
  if (colors.length) {
    const spreads = colors.map((c) => c.spread);
    const worst = colors.reduce((a, b) => (b.spread > a.spread ? b : a));
    console.log(`median spread ${round(median(spreads), 2)} dE2000, worst ${worst.dmcNumber} at ${worst.spread} (n=${worst.n})`);
    const loud = colors.filter((c) => c.spread > SPREAD_LIMIT);
    for (const c of loud)
      console.log(`  WARNING: ${c.dmcNumber} spread ${c.spread} dE2000 over ${SPREAD_LIMIT} — its samples disagree by more than two shade rungs. Reshoot rather than trust it.`);
    for (const c of colors.filter((c) => c.clamped))
      console.log(`  NOTE: ${c.dmcNumber} is outside sRGB — hex ${c.hex} is clamped, lab is kept exact and is what matching reads. Expected of a saturated dye, not a bad reading; dmc-palette-checks.ts exempts it from the lab-vs-hex and pure-black/white assertions for the same reason.`);

    console.log(`\nhow wrong were we? dE2000 from the hand-written palette value, worst first:`);
    for (const c of [...colors].sort((a, b) => b.drift - a.drift))
      console.log(`  ${c.dmcNumber.padEnd(6)} ${literals.get(c.dmcNumber)} -> ${c.hex}  ${c.drift.toFixed(2)}`);
  }
  console.log(DRY ? `\nDRY RUN — ${OUT} not written.` : `\nwrote ${OUT}`);
}

/** sRGB hex -> Lab, for the baseline only. Computed from the literal rather
 *  than looked up in DMC_PEARL_COTTON, whose lab is the measured one the moment
 *  this import lands — which would make every drift read 0.00 on a re-run. */
function labOfHex(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return rgbToLab(r, g, b);
}

main();

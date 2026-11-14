/**
 * Estimate each thread's colour from a retailer's product PHOTOGRAPH, as a
 * third opinion on the palette that costs nothing and needs no colorimeter.
 *
 * WHAT THIS IS WORTH — read before trusting a number out of it.
 *
 * It is NOT ground truth, and the measurement that says so is in
 * photo-palette-consensus.ts: across 63 colours present in both, an independent
 * public table sides with our palette 34 times and with the photograph 29.
 * A coin flip. The photos also reproduce DMC's own naming ladder no better
 * than the palette does (both score 0 violations above 30% coverage), and the
 * photo-minus-palette difference is scatter rather than bias — dL* +3.2 +/-
 * 6.0, da* -1.5 +/- 7.5, db* +0.2 +/- 8.8 — so there is no global correction
 * that would fix it. A product shot has unknown white balance, exposure,
 * camera profile and JPEG history, and no colour chart in frame to solve them
 * against. Do NOT bulk-replace hexes from this.
 *
 * What it IS worth: a third independent voice. Where this AND a public table
 * agree with each other and both disagree with the palette, that is real
 * evidence about that one colour. That is what the consensus script reports.
 *
 * SOURCE IMAGES: 123stitch article 115 (DMC Pearl Cotton size 5 — our actual
 * product line, not stranded floss). One image per SKU:
 *   https://123stitch.com/pictures/original/115-5-<SKU>.jpg
 * where <SKU> is the DMC number zero-padded to 4 (0310, 0666), or the literal
 * B5200, or WHITE for BLANC. Fetch politely, a few hundred ms apart. They come
 * in two classes and both are genuine photographs of thread, not generated
 * swatches (thousands of distinct pixel values, sd 25-114): tight ~100x52
 * crops that are all thread, and whole-skein shots on white with the DMC band
 * in frame.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/estimate-colors-from-photos.ts <imageDir> [out.json]
 */
import sharp from "sharp";
import { readdirSync, writeFileSync } from "fs";
import { DMC_PEARL_COTTON, rgbToLab } from "../src/lib/dmc-pearl-cotton";
import { deltaE2000, type Lab } from "../src/lib/dmc-palette-checks";

const DIR = process.argv[2];
const srgbToLin = (c: number) => { const n = c / 255; return n > 0.04045 ? Math.pow((n + 0.055) / 1.055, 2.4) : n / 12.92; };
const linToSrgb = (v: number) => { const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };
const hexOf = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/**
 * Robust diffuse estimate of the thread colour in a product photograph.
 *
 * Segmentation is by TEXTURE, not by colour. A studio backdrop is smooth and
 * twisted pearl cotton never is, and that holds whatever colour the thread is.
 * Colour-based background removal cannot say the same: flood-filling inward
 * from the border ate the subject on every pale thread shot on white (3072 Very
 * Light Beaver Gray lost 79% of its pixels and read #abada0 against a palette
 * value of #E0E0D8), while on a tight thread crop, whose border pixels ARE
 * thread, it devoured the lot.
 *
 * Highlights are handled by the estimator rather than the mask: mercerised
 * pearl cotton throws speculars, but they are a minority of pixels, so the
 * densest Lab bin sits on the diffuse body and the shrinking mean-shift radius
 * leaves the highlights outside. Averaging happens in LINEAR RGB, since an
 * average of gamma-encoded values is not a physical mixture.
 */
async function diffuseColor(path: string) {
  const img = sharp(path);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  const N = W * H;
  const lab: Lab[] = new Array(N);
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lab[i] = rgbToLab(data[i * ch], data[i * ch + 1], data[i * ch + 2]);
    L[i] = lab[i].l;
  }

  // --- local standard deviation of L* in a 5x5 window ----------------------
  const R = 2;
  const sd = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s1 = 0, s2 = 0, n = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const v = L[yy * W + xx]; s1 += v; s2 += v * v; n++;
        }
      }
      const m = s1 / n;
      sd[y * W + x] = Math.sqrt(Math.max(0, s2 / n - m * m));
    }
  }
  const TEX = 2.0;
  const tex = new Uint8Array(N);
  for (let i = 0; i < N; i++) tex[i] = sd[i] > TEX ? 1 : 0;

  // Localise the subject before sampling it. On a tall skein shot the thread is
  // a narrow strip in a wide white frame, and the ringing along its edge is
  // textured too, so it survives the texture mask and then outvotes the thread
  // (840 Medium Beige Brown is a taupe close to the backdrop in L* and read
  // #f0ece7). Columns and rows carrying most of the texture give a bounding box
  // around the skein; the white margins fall outside it.
  const colScore = new Float64Array(W), rowScore = new Float64Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tex[y * W + x]) { colScore[x]++; rowScore[y]++; }
  const band = (score: Float64Array, len: number) => {
    const max = Math.max(...score);
    if (max <= 0) return [0, len - 1];
    let lo = 0, hi = len - 1;
    while (lo < len && score[lo] < 0.35 * max) lo++;
    while (hi > lo && score[hi] < 0.35 * max) hi--;
    return [lo, hi];
  };
  const [x0, x1] = band(colScore, W);
  const [y0, y1] = band(rowScore, H);

  let idx: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (tex[i]) idx.push(i); }
  const texFrac = idx.length / N;
  // A crop that is entirely thread but softly focused can fall under the
  // threshold; nothing has been separated, so use the frame as it stands.
  const useAll = texFrac < 0.04;
  if (useAll) { idx = []; for (let i = 0; i < N; i++) idx.push(i); }
  if (!idx.length) return null;

  // --- seed, then mean-shift in linear RGB --------------------------------
  // Two candidate seeds, because neither alone is safe. The densest Lab bin
  // gets captured by TIGHT clusters: on a dark skein the JPEG ringing along the
  // thread/backdrop edge is a knot of near-identical white, while the thread's
  // own pixels spread over many bins, so the mode picked the ringing and 801
  // Dark Coffee Brown read #f0ede5. The component-wise median is immune to that
  // but drifts when the subject is a minority of the frame, as on 825 where the
  // skein is a narrow strip. So run the refinement from both and keep whichever
  // ends up with more support — the dominant body of thread, by construction.
  const BIN = 4;
  const hist = new Map<string, number>();
  for (const i of idx) {
    const k = `${Math.round(lab[i].l / BIN)},${Math.round(lab[i].a / BIN)},${Math.round(lab[i].b / BIN)}`;
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let bk = "", bn = -1;
  for (const [k, n] of hist) if (n > bn) { bk = k; bn = n; }
  const [bl, ba, bb] = bk.split(",").map(Number);
  const med = (pick: (c: Lab) => number) => {
    const xs = idx.map((i) => pick(lab[i])).sort((p, q) => p - q);
    return xs[Math.floor(xs.length / 2)];
  };
  const seeds: Lab[] = [
    { l: bl * BIN, a: ba * BIN, b: bb * BIN },
    { l: med((c) => c.l), a: med((c) => c.a), b: med((c) => c.b) },
  ];

  const runFrom = (seed0: Lab) => {
    let center = seed0;
    let inliers = idx, radius = 14;
    for (let it = 0; it < 5; it++) {
      const keep = idx.filter((i) => deltaE2000(lab[i], center) < radius);
      if (!keep.length) break;
      inliers = keep;
      const n2 = keep.length;
      const lr = keep.reduce((s2, i) => s2 + srgbToLin(data[i * ch]), 0) / n2;
      const lg = keep.reduce((s2, i) => s2 + srgbToLin(data[i * ch + 1]), 0) / n2;
      const lb = keep.reduce((s2, i) => s2 + srgbToLin(data[i * ch + 2]), 0) / n2;
      center = rgbToLab(linToSrgb(lr), linToSrgb(lg), linToSrgb(lb));
      radius = Math.max(7, radius - 1.75);
    }
    return { center, inliers };
  };
  const cands = seeds.map(runFrom);
  const won = cands.reduce((a, b) => (b.inliers.length > a.inliers.length ? b : a));
  const center = won.center, inliers = won.inliers;
  const n = inliers.length;
  const lin = {
    r: inliers.reduce((s2, i) => s2 + srgbToLin(data[i * ch]), 0) / n,
    g: inliers.reduce((s2, i) => s2 + srgbToLin(data[i * ch + 1]), 0) / n,
    b: inliers.reduce((s2, i) => s2 + srgbToLin(data[i * ch + 2]), 0) / n,
  };
  return { lab: center, lin, coverage: n / idx.length, px: idx.length, bgPct: 1 - texFrac, useAll };
}

async function main() {
const byNum = new Map(DMC_PEARL_COTTON.map((c) => [c.dmcNumber, c]));
const rows: any[] = [];
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".jpg")).sort()) {
  const num = f.replace(".jpg", "");
  const pal = byNum.get(num);
  if (!pal) { console.log(`!! ${num} not in palette`); continue; }
  const d = await diffuseColor(`${DIR}/${f}`);
  if (!d) continue;
  rows.push({ num, name: pal.name, pal, photo: d });
}
console.log(`analysed ${rows.length} colours\n`);

// --- Fit one global 3x3 linear-RGB transform: palette -> photo -------------
const A: number[][] = rows.map((r) => [srgbToLin(r.pal.rgb.r), srgbToLin(r.pal.rgb.g), srgbToLin(r.pal.rgb.b)]);
const B: number[][] = rows.map((r) => [r.photo.lin.r, r.photo.lin.g, r.photo.lin.b]);
function solve3(AtA: number[][], Atb: number[]) {
  const m = AtA.map((r, i) => [...r, Atb[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) { if (r === c) continue; const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}
const AtA = [0, 1, 2].map((i) => [0, 1, 2].map((j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
const M = [0, 1, 2].map((out) => solve3(AtA.map((r) => [...r]), [0, 1, 2].map((i) => A.reduce((s, r, k) => s + r[i] * B[k][out], 0))));
console.log("fitted palette->photo matrix (linear RGB):");
M.forEach((r, i) => console.log("  " + ["R", "G", "B"][i] + "' = " + r.map((v, j) => `${v >= 0 ? " " : ""}${v.toFixed(4)}·${["R", "G", "B"][j]}`).join(" + ")));

for (const r of rows) {
  const p = [srgbToLin(r.pal.rgb.r), srgbToLin(r.pal.rgb.g), srgbToLin(r.pal.rgb.b)];
  const pred = M.map((row) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2]);
  r.predLab = rgbToLab(linToSrgb(pred[0]), linToSrgb(pred[1]), linToSrgb(pred[2]));
  r.residual = deltaE2000(r.predLab, r.photo.lab);
  r.rawDE = deltaE2000(r.pal.lab, r.photo.lab);
  r.photoHex = hexOf(linToSrgb(r.photo.lin.r), linToSrgb(r.photo.lin.g), linToSrgb(r.photo.lin.b));
}
const res = rows.map((r) => r.residual).sort((a, b) => a - b);
const med = res[Math.floor(res.length / 2)];
console.log(`\nresidual dE2000 after global fit:  median ${med.toFixed(2)}  mean ${(res.reduce((a, b) => a + b, 0) / res.length).toFixed(2)}  max ${res[res.length - 1].toFixed(2)}`);
console.log(`raw dE2000 (no fit):               median ${rows.map((r) => r.rawDE).sort((a, b) => a - b)[Math.floor(rows.length / 2)].toFixed(2)}`);

console.log(`\n${"dmc".padEnd(6)}${"name".padEnd(26)}${"palette".padEnd(10)}${"photo".padEnd(10)}${"resid".padStart(7)}${"raw".padStart(7)}${"cov".padStart(6)}${"bg".padStart(6)}`);
for (const r of [...rows].sort((a, b) => b.residual - a.residual)) {
  console.log(
    r.num.padEnd(6) + r.name.slice(0, 25).padEnd(26) + r.pal.hex.padEnd(10) + r.photoHex.padEnd(10) +
    r.residual.toFixed(2).padStart(7) + r.rawDE.toFixed(1).padStart(7) +
    (r.photo.coverage * 100).toFixed(0).padStart(5) + "%" + (r.photo.bgPct * 100).toFixed(0).padStart(5) + "%" + (r.photo.useAll ? "  flat" : "")
  );
}


// --- dump for validation ---------------------------------------------------
const out = rows.map((r) => ({
  dmcNumber: r.num, name: r.name,
  paletteHex: r.pal.hex, paletteLab: r.pal.lab,
  photoHex: r.photoHex, photoLab: r.photo.lab,
  residual: Number(r.residual.toFixed(3)), rawDE: Number(r.rawDE.toFixed(3)),
  coverage: Number(r.photo.coverage.toFixed(3)), bgPct: Number(r.photo.bgPct.toFixed(3)),
}));
writeFileSync(process.argv[3] ?? "photo-estimates.json", JSON.stringify(out, null, 2));
console.log(`\nwrote ${out.length} estimates -> ${process.argv[3] ?? "photo-estimates.json"}`);
}
main();

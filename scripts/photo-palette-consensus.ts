/**
 * Where do a PHOTOGRAPH of the real thread and an INDEPENDENT public table
 * agree with each other, and both disagree with our palette?
 *
 * Neither source is authoritative alone — see the header of
 * estimate-colors-from-photos.ts for the measurement showing the photos are a
 * coin flip against the public table. But two sources that cannot have copied
 * each other, landing in the same place and away from ours, is evidence about
 * that colour that neither provides by itself.
 *
 * Every source is centred on its own mean across the common set first, so a
 * global exposure or white-balance offset in the photographs cannot decide the
 * comparison; only per-colour disagreement can.
 *
 * A hit is NOT an instruction to edit the hex. A palette hex seeds the PRINT
 * colour for every design with no stored override, so check the blast radius
 * and freeze those overrides first (CLAUDE.md, "Where the palette hexes come
 * from").
 *
 *   npx tsx --tsconfig tsconfig.json scripts/photo-palette-consensus.ts \
 *     scripts/data/photo-estimates.json scripts/data/public-dmc-adrianj.csv
 */
import { readFileSync } from "fs";
import { DMC_PEARL_COTTON, rgbToLab } from "../src/lib/dmc-pearl-cotton";
import { deltaE2000, type Lab } from "../src/lib/dmc-palette-checks";
import { PROVENANCE } from "../src/lib/dmc-provenance";

const est = JSON.parse(readFileSync(process.argv[2], "utf8")) as any[];
const pub = new Map<string, { lab: Lab; hex: string }>();
for (const line of readFileSync(process.argv[3], "utf8").trim().split("\n").slice(1)) {
  const f = line.split(",");
  pub.set(f[0].trim(), { lab: rgbToLab(+f[2], +f[3], +f[4]), hex: "#" + f[5].trim().toUpperCase() });
}
const palBy = new Map(DMC_PEARL_COTTON.map((c) => [c.dmcNumber, c]));
const rows = est.filter((e) => e.coverage >= 0.3 && pub.has(e.dmcNumber)).map((e) => ({
  num: e.dmcNumber, name: e.name, palHex: e.paletteHex, phoHex: e.photoHex,
  pubHex: pub.get(e.dmcNumber)!.hex, pal: palBy.get(e.dmcNumber)!.lab,
  pho: e.photoLab as Lab, pub: pub.get(e.dmcNumber)!.lab, cov: e.coverage,
}));

// Centre each source so a global photographic offset cannot drive the result.
const centred = (get: (r: typeof rows[0]) => Lab) => {
  const m = rows.reduce((acc, r) => { const v = get(r); return { l: acc.l + v.l, a: acc.a + v.a, b: acc.b + v.b }; }, { l: 0, a: 0, b: 0 });
  m.l /= rows.length; m.a /= rows.length; m.b /= rows.length;
  return rows.map((r) => { const v = get(r); return { l: v.l - m.l, a: v.a - m.a, b: v.b - m.b }; });
};
const cPal = centred((r) => r.pal), cPho = centred((r) => r.pho), cPub = centred((r) => r.pub);
const eu = (x: Lab, y: Lab) => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
const onGrid = (hex: string) => [1, 3, 5].every((i) => parseInt(hex.slice(i, i + 2), 16) % 8 === 0);

type Hit = { num: string; name: string; palHex: string; phoHex: string; pubHex: string; agree: number; vsPal: number; cov: number; grid: boolean; prov: string };
const hits: Hit[] = [];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const agree = eu(cPho[i], cPub[i]);          // do the two independent sources agree?
  const vsPal = Math.min(eu(cPal[i], cPub[i]), eu(cPal[i], cPho[i]));  // ...and is the palette away from BOTH?
  if (agree < 6 && vsPal > 7) {
    hits.push({ num: r.num, name: r.name, palHex: r.palHex, phoHex: r.phoHex, pubHex: r.pubHex, agree, vsPal, cov: r.cov, grid: onGrid(r.palHex), prov: (PROVENANCE as any)[r.num] ?? "?" });
  }
}
hits.sort((a, b) => b.vsPal - a.vsPal);
console.log(`Two INDEPENDENT sources (a photograph of the real thread, and a public table)`);
console.log(`agreeing with each other to < 6 units, while the palette sits > 7 from both.\n`);
console.log(`${"dmc".padEnd(6)}${"name".padEnd(27)}${"palette".padEnd(10)}${"photo".padEnd(10)}${"public".padEnd(10)}${"agree".padStart(6)}${"vs pal".padStart(8)}${"cov".padStart(6)}  provenance`);
for (const h of hits) {
  console.log(`${h.num.padEnd(6)}${h.name.slice(0,26).padEnd(27)}${h.palHex.padEnd(10)}${h.phoHex.padEnd(10)}${h.pubHex.padEnd(10)}${h.agree.toFixed(1).padStart(6)}${h.vsPal.toFixed(1).padStart(8)}${(h.cov*100).toFixed(0).padStart(5)}%  ${h.prov}${h.grid ? "  [8-step grid]" : ""}`);
}
console.log(`\n${hits.length} of ${rows.length} colours have two independent sources agreeing against the palette.`);
const gridAll = DMC_PEARL_COTTON.filter((c) => onGrid(c.hex)).length;
console.log(`(${hits.filter(h => h.grid).length} of those ${hits.length} are on the 8-step grid; ${gridAll} of the full 480 are.)`);

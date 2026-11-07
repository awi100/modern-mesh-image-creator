import { prisma } from "./src/lib/prisma";
import { readFileSync, readdirSync } from "node:fs";
import { distance } from "./src/lib/unmatched-sales";

const SP = process.env.SP!;
async function main() {
  const counts = new Map<string, number>();
  for (const f of readdirSync(SP).filter((f) => f.startsWith("it_") && f.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(`${SP}/${f}`, "utf8")).data ?? [];
    for (const t of d) for (const q of t.custom_questions ?? [])
      if (/canvas/i.test(q.question ?? "")) counts.set(q.answer, (counts.get(q.answer) ?? 0) + 1);
  }
  const designs = await prisma.design.findMany({
    where: { deletedAt: null, printVersionOf: null },
    select: { id: true, name: true, meshCount: true, archivedAt: true },
  });
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const exact = new Map<string, typeof designs>();
  for (const d of designs) exact.set(norm(d.name), [...(exact.get(norm(d.name)) ?? []), d]);

  let hit = 0, miss = 0, ambiguous = 0;
  const unmatched: [string, number][] = [];
  console.log("answer                          n   ->  design (mesh)                      how");
  for (const [ans, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const cands = exact.get(norm(ans));
    if (cands?.length === 1) {
      const d = cands[0];
      console.log(`${ans.slice(0,30).padEnd(31)} ${String(n).padStart(3)}  ->  ${d.name.slice(0,30).padEnd(31)} ${d.meshCount}ct${d.archivedAt ? " ARCHIVED" : ""}   exact`);
      hit += n;
    } else if (cands && cands.length > 1) {
      console.log(`${ans.slice(0,30).padEnd(31)} ${String(n).padStart(3)}  ->  AMBIGUOUS: ${cands.map((c) => `${c.name} ${c.meshCount}ct`).join(" | ")}`);
      ambiguous += n;
    } else {
      const best = designs.map((d) => ({ d, s: distance(norm(ans), norm(d.name)) })).sort((a, b) => a.s - b.s)[0];
      console.log(`${ans.slice(0,30).padEnd(31)} ${String(n).padStart(3)}  ->  no exact; nearest "${best.d.name}" ${best.d.meshCount}ct (dist ${best.s.toFixed(2)})`);
      miss += n; unmatched.push([ans, n]);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`\nexact ${hit}/${total} tickets (${(hit/total*100).toFixed(0)}%), ambiguous ${ambiguous}, no match ${miss}`);
  console.log(`distinct answers needing a hand-made mapping: ${unmatched.length}`);
  const intro = [...counts.entries()].filter(([a]) => /intro kit/i.test(a));
  console.log(`\nintro-kit answers: ${intro.length} distinct, ${intro.reduce((s,[,n])=>s+n,0)} of ${total} tickets (${(intro.reduce((s,[,n])=>s+n,0)/total*100).toFixed(0)}%)`);
}
main().finally(() => prisma.$disconnect());

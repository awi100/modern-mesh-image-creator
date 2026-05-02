"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { Breadcrumb } from "@/components/Breadcrumb";

interface KitContent {
  dmcNumber: string;
  colorName: string;
  hex: string;
  stitchCount: number;
  fullSkeins: number;
  bobbinYards: number;
  inStock: boolean;
}

interface KitSummary {
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  meshCount: number;
  totalColors: number;
  totalSkeins: number;
  kitContents: KitContent[];
}

interface MatchedPair {
  baseName: string;
  kit14: KitSummary | null;
  kit18: KitSummary | null;
}

// Strip mesh count suffixes and common variants to find the base design name
function getBaseName(name: string): string {
  return name
    .replace(/\s*\(\d+ct\)\s*$/i, "")
    .replace(/\s*-\s*\d+\s*(ct|count|mesh)\s*$/i, "")
    .trim()
    .toLowerCase();
}

export default function KitComparePage() {
  const { data: allKits = [], isLoading } = useSWR<KitSummary[]>("/api/kits", {
    revalidateOnFocus: false,
  });

  // Match 14ct and 18ct kits by base name
  const matchedPairs = useMemo(() => {
    const nameMap = new Map<string, MatchedPair>();

    for (const kit of allKits) {
      if (kit.meshCount !== 14 && kit.meshCount !== 18) continue;

      const base = getBaseName(kit.designName);
      if (!nameMap.has(base)) {
        nameMap.set(base, { baseName: base, kit14: null, kit18: null });
      }
      const pair = nameMap.get(base)!;
      if (kit.meshCount === 14) pair.kit14 = kit;
      if (kit.meshCount === 18) pair.kit18 = kit;
    }

    // Only show pairs that have at least one match, sorted by those with both first
    const pairs = Array.from(nameMap.values());
    pairs.sort((a, b) => {
      const aHasBoth = a.kit14 && a.kit18 ? 1 : 0;
      const bHasBoth = b.kit14 && b.kit18 ? 1 : 0;
      if (bHasBoth !== aHasBoth) return bHasBoth - aHasBoth;
      return a.baseName.localeCompare(b.baseName);
    });

    return pairs;
  }, [allKits]);

  const pairedCount = matchedPairs.filter(p => p.kit14 && p.kit18).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading kits...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/kits" className="text-slate-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-white">Kit Comparison: 14ct vs 18ct</h1>
              <p className="text-sm text-slate-400">
                {pairedCount} matched pair{pairedCount !== 1 ? "s" : ""} found by name
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Breadcrumb items={[{ label: "Kits", href: "/kits" }, { label: "Compare 14ct vs 18ct" }]} className="mb-2" />

        {matchedPairs.length === 0 ? (
          <div className="text-center py-12 text-slate-500">No designs found to compare.</div>
        ) : (
          matchedPairs.map((pair) => (
            <ComparisonCard key={pair.baseName} pair={pair} />
          ))
        )}
      </div>
    </div>
  );
}

function ComparisonCard({ pair }: { pair: MatchedPair }) {
  const { kit14, kit18 } = pair;
  const hasBoth = !!kit14 && !!kit18;

  // Build color comparison
  const comparison = useMemo(() => {
    if (!kit14 || !kit18) return null;

    const colors14 = new Map(kit14.kitContents.map(c => [c.dmcNumber, c]));
    const colors18 = new Map(kit18.kitContents.map(c => [c.dmcNumber, c]));

    const allDmcNumbers = new Set([...colors14.keys(), ...colors18.keys()]);
    const sorted = Array.from(allDmcNumbers).sort((a, b) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

    const rows = sorted.map(dmc => {
      const c14 = colors14.get(dmc);
      const c18 = colors18.get(dmc);
      const color = getDmcColorByNumber(dmc);
      return {
        dmcNumber: dmc,
        hex: color?.hex || c14?.hex || c18?.hex || "#666",
        name: color?.name || c14?.colorName || c18?.colorName || "Unknown",
        skeins14: c14?.fullSkeins || 0,
        bobbinYards14: c14?.bobbinYards || 0,
        skeins18: c18?.fullSkeins || 0,
        bobbinYards18: c18?.bobbinYards || 0,
        in14Only: !!c14 && !c18,
        in18Only: !c14 && !!c18,
        same: c14 && c18 && c14.fullSkeins === c18.fullSkeins && Math.abs(c14.bobbinYards - c18.bobbinYards) < 0.5,
      };
    });

    const shared = rows.filter(r => !r.in14Only && !r.in18Only).length;
    const only14 = rows.filter(r => r.in14Only).length;
    const only18 = rows.filter(r => r.in18Only).length;
    const identical = rows.filter(r => r.same).length;

    return { rows, shared, only14, only18, identical };
  }, [kit14, kit18]);

  const displayName = (kit14?.designName || kit18?.designName || pair.baseName).replace(/\s*\(\d+ct\)\s*$/i, "");

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-lg">{displayName}</h3>
          {hasBoth && comparison && (
            <p className="text-sm text-slate-400 mt-1">
              {comparison.shared} shared colors, {comparison.only14} only in 14ct, {comparison.only18} only in 18ct
              {comparison.identical > 0 && (
                <span className="text-emerald-400 ml-2">{comparison.identical} identical quantities</span>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {kit14 && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-zinc-700 text-zinc-300">
              14ct: {kit14.totalColors} colors, {kit14.totalSkeins} skeins
            </span>
          )}
          {kit18 && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-amber-900/60 text-amber-300">
              18ct: {kit18.totalColors} colors, {kit18.totalSkeins} skeins
            </span>
          )}
        </div>
      </div>

      {!hasBoth ? (
        <div className="p-4 text-sm text-slate-500">
          {kit14 ? "No matching 18ct version found" : "No matching 14ct version found"}
        </div>
      ) : comparison && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left p-3">Color</th>
                <th className="text-left p-3">DMC</th>
                <th className="text-center p-3">14ct Skeins</th>
                <th className="text-center p-3">18ct Skeins</th>
                <th className="text-center p-3">Diff</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => {
                const format14 = row.skeins14 > 0 ? `${row.skeins14}` : row.bobbinYards14 > 0 ? `${row.bobbinYards14}yd` : "-";
                const format18 = row.skeins18 > 0 ? `${row.skeins18}` : row.bobbinYards18 > 0 ? `${row.bobbinYards18}yd` : "-";
                const skeinDiff = row.skeins18 - row.skeins14;

                return (
                  <tr
                    key={row.dmcNumber}
                    className={`border-b border-slate-700/50 ${
                      row.same ? "" : row.in14Only ? "bg-red-900/10" : row.in18Only ? "bg-blue-900/10" : ""
                    }`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded border border-slate-600" style={{ backgroundColor: row.hex }} />
                        <span className="text-slate-300 text-xs truncate max-w-[120px]">{row.name}</span>
                      </div>
                    </td>
                    <td className="p-3 text-white font-mono text-xs">{row.dmcNumber}</td>
                    <td className="p-3 text-center text-slate-300">{format14}</td>
                    <td className="p-3 text-center text-slate-300">{format18}</td>
                    <td className="p-3 text-center">
                      {row.same ? (
                        <span className="text-emerald-400">=</span>
                      ) : row.in14Only ? (
                        <span className="text-red-400">-</span>
                      ) : row.in18Only ? (
                        <span className="text-blue-400">+</span>
                      ) : skeinDiff > 0 ? (
                        <span className="text-amber-400">+{skeinDiff}</span>
                      ) : skeinDiff < 0 ? (
                        <span className="text-amber-400">{skeinDiff}</span>
                      ) : (
                        <span className="text-emerald-400">=</span>
                      )}
                    </td>
                    <td className="p-3">
                      {row.same ? (
                        <span className="text-xs text-emerald-400">Reusable</span>
                      ) : row.in14Only ? (
                        <span className="text-xs text-red-400">14ct only</span>
                      ) : row.in18Only ? (
                        <span className="text-xs text-blue-400">18ct only</span>
                      ) : (
                        <span className="text-xs text-amber-400">Qty differs</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useMemo, useState } from "react";
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
  kitsReady: number;
  kitContents: KitContent[];
  folder: { id: string; name: string } | null;
}

interface MatchedPair {
  baseName: string;
  kit14: KitSummary | null;
  kit18: KitSummary | null;
  folderName: string;
}

// Strip a trailing mesh-count suffix, preserving the original casing.
// Handles: "Martini (14)", "Aperol Spritz(14)", "Cosmopolitan (18ct)",
// "Foo - 14ct", "Foo - 14 count", etc.
function stripMeshSuffix(name: string): string {
  return name
    .replace(/\s*\(\s*\d+\s*(ct|count|mesh)?\s*\)\s*$/i, "") // "(14)", "(14ct)", "( 18 mesh )"
    .replace(/\s*-\s*\d+\s*(ct|count|mesh)\s*$/i, "")          // "- 14ct", "- 18 count"
    .trim();
}

// Strip mesh count suffixes to find the base design name (case-insensitive key)
function getBaseName(name: string): string {
  return stripMeshSuffix(name).toLowerCase();
}

export default function KitComparePage() {
  const { data: allKits = [], isLoading } = useSWR<KitSummary[]>("/api/kits", {
    revalidateOnFocus: false,
  });

  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [expandedDesigns, setExpandedDesigns] = useState<Set<string>>(new Set());

  // Match 14ct and 18ct kits by base name, grouped by collection (folder)
  const collections = useMemo(() => {
    const nameMap = new Map<string, MatchedPair>();

    for (const kit of allKits) {
      if (kit.meshCount !== 14 && kit.meshCount !== 18) continue;

      const base = getBaseName(kit.designName);
      if (!nameMap.has(base)) {
        nameMap.set(base, { baseName: base, kit14: null, kit18: null, folderName: kit.folder?.name || "Unfiled" });
      }
      const pair = nameMap.get(base)!;
      if (kit.meshCount === 14) pair.kit14 = kit;
      if (kit.meshCount === 18) { pair.kit18 = kit; pair.folderName = kit.folder?.name || "Unfiled"; }
    }

    // Group by folder
    const grouped = new Map<string, MatchedPair[]>();
    for (const pair of nameMap.values()) {
      const folder = pair.folderName;
      if (!grouped.has(folder)) grouped.set(folder, []);
      grouped.get(folder)!.push(pair);
    }

    // Sort pairs within each group
    for (const pairs of grouped.values()) {
      pairs.sort((a, b) => {
        const aHasBoth = a.kit14 && a.kit18 ? 1 : 0;
        const bHasBoth = b.kit14 && b.kit18 ? 1 : 0;
        if (bHasBoth !== aHasBoth) return bHasBoth - aHasBoth;
        return a.baseName.localeCompare(b.baseName);
      });
    }

    // Sort collections alphabetically
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allKits]);

  const totalPairs = collections.reduce((sum, [, pairs]) => sum + pairs.filter(p => p.kit14 && p.kit18).length, 0);

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
                {totalPairs} matched pair{totalPairs !== 1 ? "s" : ""} across {collections.length} collection{collections.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-3">
        <Breadcrumb items={[{ label: "Kits", href: "/kits" }, { label: "Compare 14ct vs 18ct" }]} className="mb-2" />

        {collections.length === 0 ? (
          <div className="text-center py-12 text-slate-500">No designs found to compare.</div>
        ) : (
          collections.map(([folderName, pairs]) => {
            const isCollectionExpanded = expandedCollections.has(folderName);
            const pairedInCollection = pairs.filter(p => p.kit14 && p.kit18).length;
            const ready14InCollection = pairs.reduce((sum, p) => sum + (p.kit14?.kitsReady || 0), 0);
            const ready18InCollection = pairs.reduce((sum, p) => sum + (p.kit18?.kitsReady || 0), 0);

            return (
              <div key={folderName} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                {/* Collection header */}
                <button
                  onClick={() => setExpandedCollections(prev => {
                    const next = new Set(prev);
                    if (next.has(folderName)) next.delete(folderName);
                    else next.add(folderName);
                    return next;
                  })}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${isCollectionExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-white font-semibold">📁 {folderName}</span>
                    <span className="text-xs text-slate-400">
                      {pairs.length} design{pairs.length !== 1 ? "s" : ""}
                      {pairedInCollection > 0 && `, ${pairedInCollection} matched`}
                    </span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">
                      14ct: {ready14InCollection} ready
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-900/60 text-amber-300">
                      18ct: {ready18InCollection} ready
                    </span>
                  </div>
                </button>

                {/* Designs in collection */}
                {isCollectionExpanded && (
                  <div className="border-t border-slate-700">
                    {pairs.map((pair) => {
                      const designKey = pair.baseName;
                      const isDesignExpanded = expandedDesigns.has(designKey);
                      const displayName = stripMeshSuffix(pair.kit18?.designName || pair.kit14?.designName || pair.baseName);
                      const hasBoth = !!pair.kit14 && !!pair.kit18;

                      return (
                        <div key={designKey} className="border-t border-slate-700/50 first:border-t-0">
                          {/* Design header */}
                          <button
                            onClick={() => setExpandedDesigns(prev => {
                              const next = new Set(prev);
                              if (next.has(designKey)) next.delete(designKey);
                              else next.add(designKey);
                              return next;
                            })}
                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 pl-4">
                              <svg className={`w-3 h-3 text-slate-500 transition-transform ${isDesignExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="text-slate-200 text-sm">{displayName}</span>
                              {!hasBoth && (
                                <span className="text-xs text-slate-500">
                                  ({pair.kit14 ? "14ct only" : "18ct only"})
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2 items-center">
                              {pair.kit14 && (
                                <>
                                  <span className="px-2 py-0.5 rounded text-xs bg-zinc-700 text-zinc-300">
                                    14ct: {pair.kit14.totalColors}c / {pair.kit14.totalSkeins}sk
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${pair.kit14.kitsReady > 0 ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-700 text-slate-400"}`} title="Kits in stock">
                                    {pair.kit14.kitsReady} ready
                                  </span>
                                </>
                              )}
                              {pair.kit18 && (
                                <>
                                  <span className="px-2 py-0.5 rounded text-xs bg-amber-900/60 text-amber-300">
                                    18ct: {pair.kit18.totalColors}c / {pair.kit18.totalSkeins}sk
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${pair.kit18.kitsReady > 0 ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-700 text-slate-400"}`} title="Kits in stock">
                                    {pair.kit18.kitsReady} ready
                                  </span>
                                </>
                              )}
                            </div>
                          </button>

                          {/* Expanded comparison table */}
                          {isDesignExpanded && (pair.kit14 || pair.kit18) && (
                            <ComparisonTable kit14={pair.kit14} kit18={pair.kit18} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ComparisonTable({ kit14, kit18 }: { kit14: KitSummary | null; kit18: KitSummary | null }) {
  const hasBoth = !!kit14 && !!kit18;

  const comparison = useMemo(() => {
    const colors14 = new Map((kit14?.kitContents || []).map(c => [c.dmcNumber, c]));
    const colors18 = new Map((kit18?.kitContents || []).map(c => [c.dmcNumber, c]));

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
    const identical = rows.filter(r => r.same).length;

    return { rows, shared, identical };
  }, [kit14, kit18]);

  return (
    <div className="px-4 pb-3">
      <div className="text-xs text-slate-400 mb-2 pl-4">
        {hasBoth ? (
          <>
            {comparison.shared} shared colors, {comparison.identical} identical quantities
            {comparison.identical > 0 && <span className="text-emerald-400"> — those threads are reusable</span>}
          </>
        ) : (
          <span className="text-amber-400">
            {kit14 ? "No matching 18ct version yet — showing 14ct details" : "No matching 14ct version yet — showing 18ct details"}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 bg-slate-900/50">
              <th className="text-left p-2 pl-3">Color</th>
              <th className="text-left p-2">DMC</th>
              <th className="text-center p-2">14ct</th>
              <th className="text-center p-2">18ct</th>
              <th className="text-center p-2">Diff</th>
              <th className="text-left p-2">Status</th>
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
                  className={`border-t border-slate-700/30 ${
                    row.same ? "" : row.in14Only ? "bg-red-900/10" : row.in18Only ? "bg-blue-900/10" : ""
                  }`}
                >
                  <td className="p-2 pl-3">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded border border-slate-600" style={{ backgroundColor: row.hex }} />
                      <span className="text-slate-300 text-xs truncate max-w-[100px]">{row.name}</span>
                    </div>
                  </td>
                  <td className="p-2 text-white font-mono text-xs">{row.dmcNumber}</td>
                  <td className="p-2 text-center text-slate-300">{format14}</td>
                  <td className="p-2 text-center text-slate-300">{format18}</td>
                  <td className="p-2 text-center">
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
                  <td className="p-2">
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
    </div>
  );
}

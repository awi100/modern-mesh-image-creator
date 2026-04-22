"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getDmcColorByNumber, searchDmcColors, DmcColor } from "@/lib/dmc-pearl-cotton";
import { exportPrintOrderPdf } from "@/lib/pdf-export";
import { Breadcrumb } from "@/components/Breadcrumb";

interface ColorInfo {
  dmcNumber: string;
  stitchCount: number;
  color: DmcColor | undefined;
}

interface DesignData {
  id: string;
  name: string;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  gridWidth: number;
  gridHeight: number;
  printVersionOf: string | null;
  colorsUsed: string | null;
}

export default function ColorSwapPage() {
  const params = useParams();
  const router = useRouter();
  const designId = params.id as string;

  const [design, setDesign] = useState<DesignData | null>(null);
  const [colors, setColors] = useState<ColorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDesignColors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/designs/${designId}/color-variant`);
      if (!res.ok) throw new Error("Failed to fetch colors");
      const data = await res.json();

      setColors(
        data.colors.map((c: { dmcNumber: string; stitchCount: number }) => ({
          ...c,
          color: getDmcColorByNumber(c.dmcNumber),
        }))
      );
    } catch (err) {
      console.error("Error fetching colors:", err);
      setError("Failed to load design colors. Please try refreshing.");
    }
    setLoading(false);
  }, [designId]);

  const fetchDesign = useCallback(async () => {
    try {
      const res = await fetch(`/api/designs/${designId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDesign(data);
      if (data.previewImageUrl) setPreviewUrl(data.previewImageUrl);
    } catch (err) {
      console.error("Error fetching design:", err);
    }
  }, [designId]);

  useEffect(() => {
    fetchDesignColors();
    fetchDesign();
  }, [fetchDesignColors, fetchDesign]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchDmcColors(searchQuery).slice(0, 20);
  }, [searchQuery]);

  const handleSwap = async (fromDmc: string, toDmc: string) => {
    setSwapping(fromDmc);
    try {
      const res = await fetch(`/api/designs/${designId}/color-swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDmc, toDmc }),
      });

      if (res.ok) {
        setSwapTarget(null);
        setSearchQuery("");
        await fetchDesignColors();
        await fetchDesign();
      }
    } catch (error) {
      console.error("Error swapping color:", error);
    }
    setSwapping(null);
  };

  const handleResetToOriginal = async () => {
    if (!design?.printVersionOf) return;
    if (!confirm("Reset all colors to match the original design? This will undo all swaps.")) return;

    try {
      const delRes = await fetch(`/api/designs/${design.printVersionOf}/print-version`, { method: "DELETE" });
      if (!delRes.ok) throw new Error("Failed to delete");

      const res = await fetch(`/api/designs/${design.printVersionOf}/print-version`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to recreate");

      const data = await res.json();
      router.replace(`/design/${data.id}/colors`);
    } catch (err) {
      console.error("Error resetting:", err);
      setError("Failed to reset. The original design may have been deleted.");
    }
  };

  const handleExportPrintOrder = async () => {
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/designs/${designId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const fullDesign = await res.json();

      exportPrintOrderPdf({
        grid: fullDesign.grid,
        widthInches: fullDesign.widthInches,
        heightInches: fullDesign.heightInches,
        meshCount: fullDesign.meshCount,
        gridWidth: fullDesign.gridWidth,
        gridHeight: fullDesign.gridHeight,
        designName: fullDesign.name,
        colorsUsed: fullDesign.colorsUsed ? JSON.parse(fullDesign.colorsUsed) : null,
      });
    } catch (error) {
      console.error("Export error:", error);
    }
    setExportingPdf(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => { fetchDesignColors(); fetchDesign(); }}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Breadcrumb items={[
              { label: "Designs", href: "/" },
              ...(design?.printVersionOf ? [{ label: "Kit", href: `/design/${design.printVersionOf}/kit` }] : []),
              { label: design?.name || "Colors" },
            ]} />
          </div>
          <div className="flex items-center gap-2">
            {design?.printVersionOf && (
              <button
                onClick={handleResetToOriginal}
                className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
              >
                Reset to Original
              </button>
            )}
            <button
              onClick={handleExportPrintOrder}
              disabled={exportingPdf}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {exportingPdf ? "Exporting..." : "Export Print PDF"}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 md:px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Preview */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden sticky top-24">
              <div className="aspect-square bg-slate-900 flex items-center justify-center">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={design?.name || "Preview"}
                    className="w-full h-full object-contain"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <span className="text-slate-600 text-sm">No preview</span>
                )}
              </div>
              {design && (
                <div className="p-3 text-xs text-slate-400">
                  {design.widthInches}&quot; x {design.heightInches}&quot; @ {design.meshCount} mesh
                  {design.printVersionOf && (
                    <span className="ml-2 text-emerald-400 font-medium">Print Version</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Color list */}
          <div className="lg:col-span-2">
            <div className="bg-slate-800 rounded-xl border border-slate-700">
              <div className="p-4 border-b border-slate-700">
                <h2 className="text-lg font-semibold text-white">
                  Colors ({colors.length})
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Click &quot;Swap&quot; on a color to replace it across the entire design.
                </p>
              </div>

              <div className="divide-y divide-slate-700">
                {colors.map((c) => (
                  <div key={c.dmcNumber} className="p-4">
                    <div className="flex items-center gap-3">
                      {/* Color swatch */}
                      <div
                        className="w-10 h-10 rounded-lg border border-slate-600 flex-shrink-0"
                        style={{ backgroundColor: c.color?.hex || "#666" }}
                      />
                      {/* Color info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">
                          DMC {c.dmcNumber}
                        </p>
                        <p className="text-slate-400 text-xs truncate">
                          {c.color?.name || "Unknown"} — {c.stitchCount.toLocaleString()} stitches
                        </p>
                      </div>
                      {/* Swap button */}
                      {swapTarget === c.dmcNumber ? (
                        <button
                          onClick={() => { setSwapTarget(null); setSearchQuery(""); }}
                          className="px-3 py-1.5 bg-slate-600 text-slate-300 rounded-lg text-sm"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => { setSwapTarget(c.dmcNumber); setSearchQuery(""); }}
                          disabled={!!swapping}
                          className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 disabled:opacity-50"
                        >
                          {swapping === c.dmcNumber ? "Swapping..." : "Swap"}
                        </button>
                      )}
                    </div>

                    {/* Swap picker */}
                    {swapTarget === c.dmcNumber && (
                      <div className="mt-3 p-3 bg-slate-700/50 rounded-lg">
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search DMC number or color name..."
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          autoFocus
                        />
                        {searchResults.length > 0 && (
                          <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                            {searchResults.map((result) => (
                              <button
                                key={result.dmcNumber}
                                onClick={() => handleSwap(c.dmcNumber, result.dmcNumber)}
                                disabled={!!swapping}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-600 text-left disabled:opacity-50"
                              >
                                <div
                                  className="w-6 h-6 rounded border border-slate-500 flex-shrink-0"
                                  style={{ backgroundColor: result.hex }}
                                />
                                <span className="text-sm text-white">DMC {result.dmcNumber}</span>
                                <span className="text-xs text-slate-400 truncate">{result.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { adjustColorForPrint, hexToHsl, hslToHex, exportPrintOrderPdf } from "@/lib/pdf-export";
import { Breadcrumb } from "@/components/Breadcrumb";

interface ColorInfo {
  dmcNumber: string;
  stitchCount: number;
  hex: string;
  name: string;
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
  printColorOverrides: string | null;
  grid: (string | null)[][];
}

export default function ColorSwapPage() {
  const params = useParams();
  const router = useRouter();
  const designId = params.id as string;
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [design, setDesign] = useState<DesignData | null>(null);
  const [colors, setColors] = useState<ColorInfo[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [originalGrid, setOriginalGrid] = useState<(string | null)[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch full design with grid
      const res = await fetch(`/api/designs/${designId}`);
      if (!res.ok) throw new Error("Failed to fetch design");
      const data = await res.json();
      setDesign(data);

      // Parse existing overrides or generate defaults
      let currentOverrides: Record<string, string> = {};
      if (data.printColorOverrides) {
        currentOverrides = JSON.parse(data.printColorOverrides);
      }

      // Get colors from grid
      const colorCounts = new Map<string, number>();
      for (const row of data.grid) {
        for (const cell of row) {
          if (cell) colorCounts.set(cell, (colorCounts.get(cell) || 0) + 1);
        }
      }

      const colorList: ColorInfo[] = [];
      for (const [dmcNumber, stitchCount] of colorCounts) {
        const color = getDmcColorByNumber(dmcNumber);
        colorList.push({
          dmcNumber,
          stitchCount,
          hex: color?.hex || "#666666",
          name: color?.name || "Unknown",
        });

        // Generate default override from compensation formula if not set
        if (!currentOverrides[dmcNumber] && color) {
          const adjusted = adjustColorForPrint(color.hex);
          if (adjusted !== color.hex) {
            currentOverrides[dmcNumber] = adjusted;
          }
        }
      }

      colorList.sort((a, b) => b.stitchCount - a.stitchCount);
      setColors(colorList);
      setOverrides(currentOverrides);

      // Save defaults if they were just generated and none existed before
      if (!data.printColorOverrides && Object.keys(currentOverrides).length > 0) {
        await fetch(`/api/designs/${designId}/color-swap`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: currentOverrides }),
        });
      }

      // Fetch original design grid for comparison preview
      if (data.printVersionOf) {
        const origRes = await fetch(`/api/designs/${data.printVersionOf}`);
        if (origRes.ok) {
          const origData = await origRes.json();
          setOriginalGrid(origData.grid);
        }
      }
    } catch (err) {
      console.error("Error:", err);
      setError("Failed to load. Please try refreshing.");
    }
    setLoading(false);
  }, [designId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-save overrides after slider changes (debounced)
  const saveOverrides = useCallback((newOverrides: Record<string, string>) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/designs/${designId}/color-swap`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: newOverrides }),
        });
        setLastSaved(new Date().toLocaleTimeString());
      } catch (err) {
        console.error("Error saving:", err);
      }
      setSaving(false);
    }, 500);
  }, [designId]);

  const handleLightnessChange = (dmcNumber: string, newLightness: number) => {
    const color = colors.find(c => c.dmcNumber === dmcNumber);
    if (!color) return;

    const hsl = hexToHsl(color.hex);
    const newHex = hslToHex(hsl.h, hsl.s, newLightness);

    const newOverrides = { ...overrides, [dmcNumber]: newHex };
    // If the override matches the original, remove it
    if (newHex === color.hex) {
      delete newOverrides[dmcNumber];
    }
    setOverrides(newOverrides);
    saveOverrides(newOverrides);
  };

  const handleResetColor = (dmcNumber: string) => {
    const newOverrides = { ...overrides };
    delete newOverrides[dmcNumber];
    setOverrides(newOverrides);
    saveOverrides(newOverrides);
  };

  const handleResetAll = async () => {
    if (!confirm("Reset all colors to original? This removes all adjustments.")) return;
    setOverrides({});
    setSaving(true);
    try {
      await fetch(`/api/designs/${designId}/color-swap`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: {} }),
      });
    } catch (err) {
      console.error("Error resetting:", err);
    }
    setSaving(false);
  };

  const handleAutoAdjust = async () => {
    const newOverrides: Record<string, string> = {};
    for (const c of colors) {
      const adjusted = adjustColorForPrint(c.hex);
      if (adjusted !== c.hex) {
        newOverrides[c.dmcNumber] = adjusted;
      }
    }
    setOverrides(newOverrides);
    setSaving(true);
    try {
      await fetch(`/api/designs/${designId}/color-swap`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: newOverrides }),
      });
    } catch (err) {
      console.error("Error:", err);
    }
    setSaving(false);
  };

  const handleExportPrintOrder = async () => {
    if (!design) return;
    setExportingPdf(true);
    try {
      exportPrintOrderPdf({
        grid: design.grid,
        widthInches: design.widthInches,
        heightInches: design.heightInches,
        meshCount: design.meshCount,
        gridWidth: design.gridWidth,
        gridHeight: design.gridHeight,
        designName: design.name.replace(/ \(Print\)$/, ""),
        colorOverrides: Object.keys(overrides).length > 0 ? overrides : null,
      });
    } catch (err) {
      console.error("Export error:", err);
    }
    setExportingPdf(false);
  };

  // Count adjustments
  const adjustedCount = Object.keys(overrides).length;

  // Render preview canvases from grid data
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);

  // Helper to render a grid to a canvas
  const renderGridToCanvas = useCallback((canvas: HTMLCanvasElement, grid: (string | null)[][], colorMap?: Record<string, string>) => {
    const h = grid.length;
    const w = grid[0]?.length || 0;
    if (w === 0 || h === 0) return;

    const maxSize = 400;
    const cellSize = Math.max(2, Math.min(Math.floor(maxSize / w), Math.floor(maxSize / h)));
    canvas.width = w * cellSize;
    canvas.height = h * cellSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dmc = grid[y][x];
        if (!dmc) continue;
        const color = getDmcColorByNumber(dmc);
        if (!color) continue;
        ctx.fillStyle = colorMap?.[dmc] || color.hex;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }, []);

  // Render original preview (re-run after loading clears so canvas ref is mounted)
  useEffect(() => {
    if (loading || !originalGrid || !originalCanvasRef.current) return;
    renderGridToCanvas(originalCanvasRef.current, originalGrid);
  }, [originalGrid, loading, renderGridToCanvas]);

  // Render print version preview (re-run after loading clears and on override changes)
  useEffect(() => {
    if (loading || !design?.grid || !previewCanvasRef.current) return;
    renderGridToCanvas(previewCanvasRef.current, design.grid, overrides);
  }, [design?.grid, overrides, loading, renderGridToCanvas]);

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
          <button onClick={fetchData} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">
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
              { label: "Print Colors" },
            ]} />
          </div>
          <div className="flex items-center gap-2">
            {saving ? (
              <span className="text-xs text-amber-400">Saving...</span>
            ) : lastSaved ? (
              <span className="text-xs text-slate-500">Saved {lastSaved}</span>
            ) : null}
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
          {/* Preview comparison */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden sticky top-24">
              <div className="grid grid-cols-2 gap-px bg-slate-700">
                <div className="bg-slate-900">
                  <p className="text-[10px] text-slate-500 text-center py-1 bg-slate-800">Original</p>
                  <div className="aspect-square flex items-center justify-center">
                    <canvas ref={originalCanvasRef} className="w-full h-full object-contain" style={{ imageRendering: "pixelated" }} />
                  </div>
                </div>
                <div className="bg-slate-900">
                  <p className="text-[10px] text-emerald-400 text-center py-1 bg-slate-800">Print Version</p>
                  <div className="aspect-square flex items-center justify-center">
                    <canvas ref={previewCanvasRef} className="w-full h-full object-contain" style={{ imageRendering: "pixelated" }} />
                  </div>
                </div>
              </div>
              <div className="p-3 text-xs text-slate-400 flex justify-between">
                <span>{design?.widthInches}&quot; x {design?.heightInches}&quot; @ {design?.meshCount} mesh</span>
                {adjustedCount > 0 && (
                  <span className="text-amber-400">{adjustedCount} adjusted</span>
                )}
              </div>
            </div>
          </div>

          {/* Color list with sliders */}
          <div className="lg:col-span-2">
            <div className="bg-slate-800 rounded-xl border border-slate-700">
              <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Print Colors ({colors.length})</h2>
                  <p className="text-sm text-slate-400 mt-1">Adjust lightness for each color. Changes preview in real-time.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAutoAdjust}
                    className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600"
                  >
                    Auto Adjust
                  </button>
                  <button
                    onClick={handleResetAll}
                    className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600"
                  >
                    Reset All
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-700">
                {colors.map((c) => {
                  const originalHsl = hexToHsl(c.hex);
                  const overrideHex = overrides[c.dmcNumber];
                  const currentHsl = overrideHex ? hexToHsl(overrideHex) : originalHsl;
                  const isAdjusted = !!overrideHex;

                  return (
                    <div key={c.dmcNumber} className={`p-4 ${isAdjusted ? "bg-amber-900/10" : ""}`}>
                      <div className="flex items-center gap-3 mb-2">
                        {/* Original → Adjusted swatches */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div
                            className="w-8 h-8 rounded border border-slate-600"
                            style={{ backgroundColor: c.hex }}
                            title="Original"
                          />
                          {isAdjusted && (
                            <>
                              <span className="text-slate-500 text-xs">→</span>
                              <div
                                className="w-8 h-8 rounded border-2 border-amber-500/50"
                                style={{ backgroundColor: overrideHex }}
                                title="Print adjusted"
                              />
                            </>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium">
                            DMC {c.dmcNumber}
                            {isAdjusted && (
                              <span className="ml-2 text-xs text-amber-400 font-normal">
                                L: {originalHsl.l.toFixed(0)} → {currentHsl.l.toFixed(0)}
                              </span>
                            )}
                          </p>
                          <p className="text-slate-400 text-xs truncate">
                            {c.name} — {c.stitchCount.toLocaleString()} stitches
                          </p>
                        </div>
                        {isAdjusted && (
                          <button
                            onClick={() => handleResetColor(c.dmcNumber)}
                            className="px-2 py-1 text-xs text-slate-400 hover:text-white bg-slate-700 rounded hover:bg-slate-600"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      {/* Lightness slider */}
                      <div className="flex items-center gap-3 pl-11">
                        <span className="text-[10px] text-slate-500 w-6">Dark</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round(currentHsl.l)}
                          onChange={(e) => handleLightnessChange(c.dmcNumber, parseInt(e.target.value))}
                          className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          style={{
                            background: `linear-gradient(to right, ${hslToHex(currentHsl.h, currentHsl.s, 0)}, ${hslToHex(currentHsl.h, currentHsl.s, 50)}, ${hslToHex(currentHsl.h, currentHsl.s, 100)})`,
                          }}
                        />
                        <span className="text-[10px] text-slate-500 w-6">Light</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

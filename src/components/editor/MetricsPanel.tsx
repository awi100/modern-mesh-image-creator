"use client";

import React, { useRef, useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

export default function MetricsPanel() {
  const {
    designName,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    getCompositeGrid,
    stitchType,
    bufferPercent,
    setStitchType,
    setBufferPercent,
    getUsedColors,
    getYarnUsage,
    getTotalStitches,
  } = useEditorStore();

  // Get composite grid for preview
  const grid = getCompositeGrid();

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const usedColors = getUsedColors();
  const yarnUsage = getYarnUsage();
  const totalStitches = getTotalStitches();
  const totalYardsWithoutBuffer = yarnUsage.reduce((sum, u) => sum + u.yarnYards, 0);
  const totalYardsWithBuffer = yarnUsage.reduce((sum, u) => sum + u.withBuffer, 0);

  // Draw preview thumbnail
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate cell size to fit in preview
    const maxSize = 160;
    const cellSize = Math.max(1, Math.min(
      Math.floor(maxSize / gridWidth),
      Math.floor(maxSize / gridHeight)
    ));

    const width = gridWidth * cellSize;
    const height = gridHeight * cellSize;
    canvas.width = width;
    canvas.height = height;

    // Clear with background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    // Draw pixels
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const dmcNumber = grid[y]?.[x];
        if (dmcNumber) {
          const color = getDmcColorByNumber(dmcNumber);
          if (color) {
            ctx.fillStyle = color.hex;
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }
      }
    }
  }, [getCompositeGrid, gridWidth, gridHeight]);

  return (
    <div className="bg-white dark:bg-slate-800 lg:border-l border-slate-200 dark:border-slate-700 w-full lg:w-72 flex flex-col overflow-auto">
      {/* Design Preview */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">
          Preview
        </h3>
        <div className="flex justify-center bg-slate-100 dark:bg-slate-700 rounded-lg p-2">
          <canvas
            ref={previewCanvasRef}
            className="max-w-full h-auto rounded shadow-inner"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
        <p className="text-center text-xs text-slate-500 mt-2">
          {usedColors.length} color{usedColors.length !== 1 ? "s" : ""} used
        </p>
      </div>

      {/* Design Info */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">
          Design Info
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Size</span>
            <span className="text-slate-900 dark:text-white">{widthInches}&quot; × {heightInches}&quot;</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Mesh Count</span>
            <span className="text-slate-900 dark:text-white">{meshCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Grid Size</span>
            <span className="text-slate-900 dark:text-white">{gridWidth} × {gridHeight}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Total Stitches</span>
            <span className="text-slate-900 dark:text-white">{totalStitches.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Colors Used</span>
            <span className="text-slate-900 dark:text-white">{usedColors.length}</span>
          </div>
        </div>
      </div>

      {/* Yarn Settings */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">
          Yarn Calculation
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-slate-500 dark:text-slate-400 text-sm block mb-1">Stitch Type</label>
            <select
              value={stitchType}
              onChange={(e) => setStitchType(e.target.value as "continental" | "basketweave")}
              className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
            >
              <option value="continental">Continental</option>
              <option value="basketweave">Basketweave</option>
            </select>
          </div>

          <div>
            <label className="text-slate-500 dark:text-slate-400 text-sm block mb-1">
              Buffer: {bufferPercent}%
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={bufferPercent}
              onChange={(e) => setBufferPercent(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="bg-slate-100 dark:bg-slate-700 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Base Yarn</span>
              <span className="text-slate-600 dark:text-slate-300">{totalYardsWithoutBuffer.toFixed(1)} yards</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">With Buffer</span>
              <span className="text-slate-900 dark:text-white font-medium">{totalYardsWithBuffer.toFixed(1)} yards</span>
            </div>
          </div>
        </div>
      </div>

      {/* Yarn Usage by Color */}
      <div className="p-4 flex-1 overflow-auto">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">
          Yarn by Color
        </h3>

        {yarnUsage.length === 0 ? (
          <p className="text-slate-500 text-sm">No stitches yet</p>
        ) : (
          <div className="space-y-2">
            {yarnUsage.map((usage) => {
              const color = getDmcColorByNumber(usage.dmcNumber);
              if (!color) return null;

              return (
                <div
                  key={usage.dmcNumber}
                  className="bg-slate-100 dark:bg-slate-700 rounded-lg p-2 flex items-center gap-2"
                >
                  <div
                    className="w-8 h-8 rounded-md flex-shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-900 dark:text-white text-sm font-medium truncate">
                      DMC {color.dmcNumber}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 text-xs">
                      {usage.stitchCount.toLocaleString()} stitches
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500 dark:text-slate-400 text-xs">{usage.yarnYards.toFixed(1)} yd</p>
                    <p className="text-slate-900 dark:text-white text-sm">{usage.withBuffer.toFixed(1)} yd <span className="text-slate-500 text-xs">w/ buffer</span></p>
                    <p className="text-slate-500 dark:text-slate-400 text-xs">{usage.skeinsNeeded} skein{usage.skeinsNeeded !== 1 ? "s" : ""}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

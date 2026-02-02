"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useEditorStore } from "@/lib/store";
import { scalePixelGrid, createEmptyGrid, PixelGrid } from "@/lib/color-utils";

// Built-in preset canvas sizes
const BUILTIN_PRESETS = [
  { name: "Coaster", width: 4, height: 4 },
  { name: "Small Ornament", width: 5, height: 5 },
  { name: "Ornament", width: 6, height: 6 },
  { name: "Square (8\")", width: 8, height: 8 },
  { name: "Square (10\")", width: 10, height: 10 },
  { name: "Pillow (12\")", width: 12, height: 12 },
  { name: "Pillow (14\")", width: 14, height: 14 },
  { name: "Rectangle (9×12)", width: 9, height: 12 },
  { name: "Rectangle (12×16)", width: 12, height: 16 },
  { name: "Belt (2×36)", width: 2, height: 36 },
];

type ResizeMode = "scale" | "crop";
type AnchorPosition = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";

interface CustomPreset {
  id: string;
  name: string;
  widthInches: number;
  heightInches: number;
}

interface CanvasResizeProps {
  onClose: () => void;
}

export default function CanvasResize({ onClose }: CanvasResizeProps) {
  const {
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    flattenLayers,
    setDesignInfo,
    initializeGrid,
    saveToHistory,
  } = useEditorStore();

  const [newWidthInches, setNewWidthInches] = useState(widthInches);
  const [newHeightInches, setNewHeightInches] = useState(heightInches);
  const [newMeshCount, setNewMeshCount] = useState(meshCount);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("scale");
  const [anchorPosition, setAnchorPosition] = useState<AnchorPosition>("mc"); // middle-center default
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);

  const newGridWidth = Math.round(newWidthInches * newMeshCount);
  const newGridHeight = Math.round(newHeightInches * newMeshCount);

  const isSizeChanged = newGridWidth !== gridWidth || newGridHeight !== gridHeight || newMeshCount !== meshCount;

  // Calculate offset based on anchor position
  const getAnchorOffset = (
    oldWidth: number,
    oldHeight: number,
    newWidth: number,
    newHeight: number,
    anchor: AnchorPosition
  ): { x: number; y: number } => {
    const diffX = newWidth - oldWidth;
    const diffY = newHeight - oldHeight;

    const xOffsets: Record<string, number> = {
      l: 0,
      c: Math.floor(diffX / 2),
      r: diffX,
    };

    const yOffsets: Record<string, number> = {
      t: 0,
      m: Math.floor(diffY / 2),
      b: diffY,
    };

    return {
      x: xOffsets[anchor[1]] || 0,
      y: yOffsets[anchor[0]] || 0,
    };
  };

  // Fetch custom presets on mount
  useEffect(() => {
    fetch("/api/canvas-presets")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCustomPresets(data);
        }
      })
      .catch((err) => console.error("Failed to load presets:", err));
  }, []);

  const handleApply = () => {
    if (!isSizeChanged) {
      onClose();
      return;
    }

    saveToHistory();

    // Flatten all layers before resizing
    const currentGrid = flattenLayers();
    let newGrid: PixelGrid;

    if (resizeMode === "scale") {
      // Scale existing content to fit new dimensions
      newGrid = scalePixelGrid(currentGrid, newGridWidth, newGridHeight);
    } else {
      // Crop/extend: create new grid and copy content based on anchor
      newGrid = createEmptyGrid(newGridWidth, newGridHeight);
      const offset = getAnchorOffset(gridWidth, gridHeight, newGridWidth, newGridHeight, anchorPosition);

      // Copy existing content with offset
      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const newX = x + offset.x;
          const newY = y + offset.y;

          if (newX >= 0 && newX < newGridWidth && newY >= 0 && newY < newGridHeight) {
            newGrid[newY][newX] = currentGrid[y]?.[x] ?? null;
          }
        }
      }
    }

    setDesignInfo({
      widthInches: newWidthInches,
      heightInches: newHeightInches,
      meshCount: newMeshCount as 14 | 18,
    });

    initializeGrid(newGridWidth, newGridHeight, newGrid);

    onClose();
  };

  // Preview description
  const previewDescription = useMemo(() => {
    if (!isSizeChanged) return "No changes";

    if (resizeMode === "scale") {
      return "Design will be stretched/shrunk to fit new dimensions";
    } else {
      const widthChange = newGridWidth - gridWidth;
      const heightChange = newGridHeight - gridHeight;

      const parts = [];
      if (widthChange > 0) parts.push(`${widthChange} columns added`);
      else if (widthChange < 0) parts.push(`${Math.abs(widthChange)} columns removed`);

      if (heightChange > 0) parts.push(`${heightChange} rows added`);
      else if (heightChange < 0) parts.push(`${Math.abs(heightChange)} rows removed`);

      return parts.length > 0 ? parts.join(", ") : "No change in grid size";
    }
  }, [resizeMode, newGridWidth, newGridHeight, gridWidth, gridHeight, isSizeChanged]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-white">Resize Canvas</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Current size */}
          <div className="p-3 bg-slate-700 rounded-lg">
            <p className="text-sm text-slate-400">
              Current: <span className="text-white">{widthInches}&quot; × {heightInches}&quot;</span> at{" "}
              <span className="text-white">{meshCount}</span> mesh ={" "}
              <span className="text-white font-medium">{gridWidth} × {gridHeight}</span> stitches
            </p>
          </div>

          {/* Preset sizes */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">Preset Sizes</label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {BUILTIN_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setNewWidthInches(preset.width);
                    setNewHeightInches(preset.height);
                  }}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                    newWidthInches === preset.width && newHeightInches === preset.height
                      ? "bg-rose-900/30 border-rose-800 text-rose-300"
                      : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {preset.name}
                  <span className="text-slate-500 ml-1">({preset.width}×{preset.height})</span>
                </button>
              ))}
              {customPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    setNewWidthInches(preset.widthInches);
                    setNewHeightInches(preset.heightInches);
                  }}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                    newWidthInches === preset.widthInches && newHeightInches === preset.heightInches
                      ? "bg-rose-900/30 border-rose-800 text-rose-300"
                      : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {preset.name}
                  <span className="text-slate-500 ml-1">({preset.widthInches}×{preset.heightInches})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom dimensions */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Width (in)</label>
              <input
                type="number"
                min="1"
                max="36"
                step="0.5"
                value={newWidthInches}
                onChange={(e) => setNewWidthInches(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Height (in)</label>
              <input
                type="number"
                min="1"
                max="36"
                step="0.5"
                value={newHeightInches}
                onChange={(e) => setNewHeightInches(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Mesh</label>
              <select
                value={newMeshCount}
                onChange={(e) => setNewMeshCount(Number(e.target.value) as 14 | 18)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-rose-800"
              >
                <option value={14}>14</option>
                <option value={18}>18</option>
              </select>
            </div>
          </div>

          {/* Resize mode */}
          <div>
            <label className="block text-sm text-slate-400 mb-3">How should the design be resized?</label>
            <div className="space-y-2">
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  resizeMode === "scale"
                    ? "bg-rose-900/20 border-rose-800"
                    : "bg-slate-700/50 border-slate-600 hover:border-slate-500"
                }`}
              >
                <input
                  type="radio"
                  name="resizeMode"
                  value="scale"
                  checked={resizeMode === "scale"}
                  onChange={() => setResizeMode("scale")}
                  className="mt-0.5 w-4 h-4 text-rose-900 bg-slate-700 border-slate-500"
                />
                <div>
                  <span className="text-white font-medium">Scale Design</span>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Stretch or shrink the entire design to fit the new canvas size
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  resizeMode === "crop"
                    ? "bg-rose-900/20 border-rose-800"
                    : "bg-slate-700/50 border-slate-600 hover:border-slate-500"
                }`}
              >
                <input
                  type="radio"
                  name="resizeMode"
                  value="crop"
                  checked={resizeMode === "crop"}
                  onChange={() => setResizeMode("crop")}
                  className="mt-0.5 w-4 h-4 text-rose-900 bg-slate-700 border-slate-500"
                />
                <div>
                  <span className="text-white font-medium">Crop / Extend</span>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Keep design at current scale, crop edges or add empty space
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Anchor position (only for crop mode) */}
          {resizeMode === "crop" && (
            <div>
              <label className="block text-sm text-slate-400 mb-2">Anchor Position</label>
              <p className="text-xs text-slate-500 mb-3">
                Where should the design be positioned when canvas size changes?
              </p>
              <div className="flex justify-center">
                <div className="grid grid-cols-3 gap-1 p-2 bg-slate-700 rounded-lg">
                  {(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] as AnchorPosition[]).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setAnchorPosition(pos)}
                      className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
                        anchorPosition === pos
                          ? "bg-rose-900 text-white"
                          : "bg-slate-600 text-slate-400 hover:bg-slate-500"
                      }`}
                      title={
                        pos === "tl" ? "Top Left" :
                        pos === "tc" ? "Top Center" :
                        pos === "tr" ? "Top Right" :
                        pos === "ml" ? "Middle Left" :
                        pos === "mc" ? "Center" :
                        pos === "mr" ? "Middle Right" :
                        pos === "bl" ? "Bottom Left" :
                        pos === "bc" ? "Bottom Center" :
                        "Bottom Right"
                      }
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                        <rect
                          x={pos.includes("l") ? 2 : pos.includes("r") ? 10 : 6}
                          y={pos.includes("t") ? 2 : pos.includes("b") ? 10 : 6}
                          width="4"
                          height="4"
                          rx="1"
                        />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* New size preview */}
          <div className={`p-3 rounded-lg border ${
            isSizeChanged
              ? "bg-rose-900/20 border-rose-800/50"
              : "bg-slate-700/50 border-slate-600"
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-400">New size:</span>
              <span className="text-white font-medium">{newGridWidth} × {newGridHeight} stitches</span>
            </div>
            <p className="text-xs text-slate-400">{previewDescription}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!isSizeChanged}
            className="flex-1 py-2 px-4 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

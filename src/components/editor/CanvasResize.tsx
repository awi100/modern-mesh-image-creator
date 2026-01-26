"use client";

import React, { useState } from "react";
import { useEditorStore } from "@/lib/store";
import { scalePixelGrid, createEmptyGrid } from "@/lib/color-utils";

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
    grid,
    setDesignInfo,
    initializeGrid,
    saveToHistory,
  } = useEditorStore();

  const [newWidthInches, setNewWidthInches] = useState(widthInches);
  const [newHeightInches, setNewHeightInches] = useState(heightInches);
  const [newMeshCount, setNewMeshCount] = useState(meshCount);
  const [scaleContent, setScaleContent] = useState(true);

  const newGridWidth = Math.round(newWidthInches * newMeshCount);
  const newGridHeight = Math.round(newHeightInches * newMeshCount);

  const handleApply = () => {
    saveToHistory();

    let newGrid;

    if (scaleContent && (newGridWidth !== gridWidth || newGridHeight !== gridHeight)) {
      // Scale existing content to fit new dimensions
      newGrid = scalePixelGrid(grid, newGridWidth, newGridHeight);
    } else if (!scaleContent) {
      // Create new empty grid or crop/extend existing
      newGrid = createEmptyGrid(newGridWidth, newGridHeight);

      // Copy existing content that fits
      for (let y = 0; y < Math.min(gridHeight, newGridHeight); y++) {
        for (let x = 0; x < Math.min(gridWidth, newGridWidth); x++) {
          newGrid[y][x] = grid[y]?.[x] ?? null;
        }
      }
    } else {
      newGrid = grid;
    }

    setDesignInfo({
      widthInches: newWidthInches,
      heightInches: newHeightInches,
      meshCount: newMeshCount as 14 | 18,
    });

    initializeGrid(newGridWidth, newGridHeight, newGrid);

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Resize Canvas</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Current size */}
        <div className="mb-4 p-3 bg-slate-700 rounded-lg">
          <p className="text-sm text-slate-400">
            Current: <span className="text-white">{widthInches}&quot; × {heightInches}&quot;</span> at{" "}
            <span className="text-white">{meshCount}</span> mesh ={" "}
            <span className="text-white">{gridWidth} × {gridHeight}</span> stitches
          </p>
        </div>

        {/* Width */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-1">Width (inches)</label>
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

        {/* Height */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-1">Height (inches)</label>
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

        {/* Mesh count */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-1">Mesh Count</label>
          <select
            value={newMeshCount}
            onChange={(e) => setNewMeshCount(Number(e.target.value) as 14 | 18)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-rose-800"
          >
            <option value={14}>14 mesh</option>
            <option value={18}>18 mesh</option>
          </select>
        </div>

        {/* Scale content option */}
        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={scaleContent}
              onChange={(e) => setScaleContent(e.target.checked)}
              className="w-4 h-4 text-rose-900 bg-slate-700 border-slate-600 rounded focus:ring-rose-800"
            />
            <span className="text-slate-300">Scale content to fit</span>
          </label>
          <p className="text-xs text-slate-500 mt-1 ml-6">
            {scaleContent
              ? "Existing design will be scaled to fit new dimensions"
              : "Existing design will be cropped or extended"}
          </p>
        </div>

        {/* New size preview */}
        <div className="mb-4 p-3 bg-rose-900/30 border border-rose-800/30 rounded-lg">
          <p className="text-sm text-rose-300">
            New size: <span className="text-white font-medium">{newGridWidth} × {newGridHeight}</span> stitches
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-2 px-4 bg-rose-900 text-white rounded-lg hover:bg-rose-950"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

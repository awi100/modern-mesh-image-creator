"use client";

import React, { useState, useMemo } from "react";
import { useEditorStore } from "@/lib/store";

interface PatternRepeatDialogProps {
  onClose: () => void;
}

export default function PatternRepeatDialog({ onClose }: PatternRepeatDialogProps) {
  const selection = useEditorStore((s) => s.selection);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerIndex = useEditorStore((s) => s.activeLayerIndex);

  const [repeatX, setRepeatX] = useState(2);
  const [repeatY, setRepeatY] = useState(2);
  const [gapX, setGapX] = useState(0);
  const [gapY, setGapY] = useState(0);
  const [direction, setDirection] = useState<"both" | "horizontal" | "vertical">("both");

  // Get the selected area's pixel data
  const selectedPattern = useMemo(() => {
    if (!selection) return null;

    const layer = layers[activeLayerIndex];
    if (!layer) return null;

    // Find bounds of selection (selection is a boolean[][] where true = selected)
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let y = 0; y < selection.length; y++) {
      for (let x = 0; x < (selection[y]?.length || 0); x++) {
        if (selection[y][x]) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (minX === Infinity) return null; // No selection found

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;

    const pattern: (string | null)[][] = [];
    for (let y = minY; y <= maxY; y++) {
      const row: (string | null)[] = [];
      for (let x = minX; x <= maxX; x++) {
        row.push(layer.grid[y]?.[x] || null);
      }
      pattern.push(row);
    }

    return { pattern, width, height, startX: minX, startY: minY };
  }, [selection, layers, activeLayerIndex]);

  const handleApply = () => {
    if (!selectedPattern || !selection) return;

    const layer = layers[activeLayerIndex];
    if (!layer) return;

    const { pattern, width, height, startX, startY } = selectedPattern;
    const newGrid = layer.grid.map((row) => [...row]);

    const actualRepeatX = direction === "vertical" ? 1 : repeatX;
    const actualRepeatY = direction === "horizontal" ? 1 : repeatY;

    for (let ry = 0; ry < actualRepeatY; ry++) {
      for (let rx = 0; rx < actualRepeatX; rx++) {
        // Skip the original position
        if (rx === 0 && ry === 0) continue;

        const offsetX = rx * (width + gapX);
        const offsetY = ry * (height + gapY);

        for (let py = 0; py < height; py++) {
          for (let px = 0; px < width; px++) {
            const targetX = startX + offsetX + px;
            const targetY = startY + offsetY + py;

            // Check bounds
            if (targetY >= 0 && targetY < newGrid.length && targetX >= 0 && targetX < (newGrid[0]?.length || 0)) {
              newGrid[targetY][targetX] = pattern[py][px];
            }
          }
        }
      }
    }

    // Update the layer through setState
    useEditorStore.setState((state) => ({
      layers: state.layers.map((l, i) =>
        i === activeLayerIndex ? { ...l, grid: newGrid } : l
      ),
      isDirty: true,
    }));
    onClose();
  };

  if (!selection || !selectedPattern) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 rounded-xl w-full max-w-md p-6 shadow-xl">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto mb-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            <h2 className="text-xl font-semibold text-white mb-2">No Selection</h2>
            <p className="text-slate-400 mb-4">
              Please select an area first using the selection tool, then use pattern repeat.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Pattern Repeat</h2>
            <p className="text-sm text-slate-400">
              Tile your selection across the canvas
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Selection info */}
          <div className="p-3 bg-slate-700/50 rounded-lg text-sm text-slate-300">
            Selection: {selectedPattern.width} × {selectedPattern.height} pixels
          </div>

          {/* Direction */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Repeat Direction
            </label>
            <div className="flex gap-2">
              {(["both", "horizontal", "vertical"] as const).map((dir) => (
                <button
                  key={dir}
                  onClick={() => setDirection(dir)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium capitalize ${
                    direction === dir
                      ? "bg-rose-900 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {dir}
                </button>
              ))}
            </div>
          </div>

          {/* Repeat counts */}
          <div className="grid grid-cols-2 gap-4">
            {direction !== "vertical" && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Horizontal Repeats
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={repeatX}
                  onChange={(e) => setRepeatX(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                />
              </div>
            )}
            {direction !== "horizontal" && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Vertical Repeats
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={repeatY}
                  onChange={(e) => setRepeatY(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                />
              </div>
            )}
          </div>

          {/* Gap */}
          <div className="grid grid-cols-2 gap-4">
            {direction !== "vertical" && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Horizontal Gap
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={gapX}
                  onChange={(e) => setGapX(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                />
              </div>
            )}
            {direction !== "horizontal" && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Vertical Gap
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={gapY}
                  onChange={(e) => setGapY(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                />
              </div>
            )}
          </div>

          {/* Preview info */}
          <div className="p-3 bg-slate-700/30 rounded-lg text-sm text-slate-400">
            Will create {(direction === "vertical" ? 1 : repeatX) * (direction === "horizontal" ? 1 : repeatY) - 1} additional copies
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-950"
          >
            Apply Repeat
          </button>
        </div>
      </div>
    </div>
  );
}

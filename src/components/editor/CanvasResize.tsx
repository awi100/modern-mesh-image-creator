"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import { scalePixelGrid, createEmptyGrid, PixelGrid } from "@/lib/color-utils";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

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
type DragHandle = "top" | "bottom" | "left" | "right" | null;

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

  // Interactive crop state
  const [cropOffsets, setCropOffsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  const [dragHandle, setDragHandle] = useState<DragHandle>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, offset: 0 });
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const newGridWidth = Math.round(newWidthInches * newMeshCount);
  const newGridHeight = Math.round(newHeightInches * newMeshCount);

  // Check if using interactive crop (has crop offsets)
  const hasInteractiveCrop = cropOffsets.top > 0 || cropOffsets.bottom > 0 || cropOffsets.left > 0 || cropOffsets.right > 0;

  const isSizeChanged = newGridWidth !== gridWidth || newGridHeight !== gridHeight || newMeshCount !== meshCount || hasInteractiveCrop;

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

  // Get current grid for preview
  const currentGrid = useMemo(() => flattenLayers(), [flattenLayers]);

  // Calculate effective crop dimensions based on drag offsets
  const effectiveCrop = useMemo(() => {
    const keepWidth = gridWidth - cropOffsets.left - cropOffsets.right;
    const keepHeight = gridHeight - cropOffsets.top - cropOffsets.bottom;
    return {
      left: cropOffsets.left,
      top: cropOffsets.top,
      width: Math.max(1, keepWidth),
      height: Math.max(1, keepHeight),
    };
  }, [gridWidth, gridHeight, cropOffsets]);

  // Update newWidthInches/newHeightInches when crop offsets change
  useEffect(() => {
    if (resizeMode === "crop" && (cropOffsets.top !== 0 || cropOffsets.bottom !== 0 || cropOffsets.left !== 0 || cropOffsets.right !== 0)) {
      const newWidth = effectiveCrop.width / meshCount;
      const newHeight = effectiveCrop.height / meshCount;
      setNewWidthInches(Math.round(newWidth * 10) / 10);
      setNewHeightInches(Math.round(newHeight * 10) / 10);
    }
  }, [cropOffsets, effectiveCrop, meshCount, resizeMode]);

  // Reset crop offsets when switching modes or dimensions change manually
  useEffect(() => {
    setCropOffsets({ top: 0, bottom: 0, left: 0, right: 0 });
  }, [resizeMode]);

  // Draw preview canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || resizeMode !== "crop") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate preview scale to fit in container
    const maxPreviewWidth = 280;
    const maxPreviewHeight = 200;
    const scale = Math.min(
      maxPreviewWidth / gridWidth,
      maxPreviewHeight / gridHeight,
      4 // Max 4px per cell
    );

    canvas.width = gridWidth * scale;
    canvas.height = gridHeight * scale;

    // Draw grid with crop overlay
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const dmcNumber = currentGrid[y]?.[x];
        const isCropped = x < cropOffsets.left ||
                          x >= gridWidth - cropOffsets.right ||
                          y < cropOffsets.top ||
                          y >= gridHeight - cropOffsets.bottom;

        if (dmcNumber) {
          const color = getDmcColorByNumber(dmcNumber);
          ctx.fillStyle = color?.hex || "#808080";
        } else {
          ctx.fillStyle = "#f0f0f0";
        }

        ctx.fillRect(x * scale, y * scale, scale, scale);

        // Add dark overlay for cropped areas
        if (isCropped) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    // Draw crop boundary lines
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      cropOffsets.left * scale,
      cropOffsets.top * scale,
      effectiveCrop.width * scale,
      effectiveCrop.height * scale
    );
    ctx.setLineDash([]);
  }, [currentGrid, gridWidth, gridHeight, cropOffsets, effectiveCrop, resizeMode]);

  // Mouse/touch handlers for draggable crop handles
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, handle: DragHandle) => {
    e.preventDefault();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const currentOffset = handle === "top" ? cropOffsets.top :
                          handle === "bottom" ? cropOffsets.bottom :
                          handle === "left" ? cropOffsets.left :
                          cropOffsets.right;

    setDragHandle(handle);
    setDragStart({ x: clientX, y: clientY, offset: currentOffset });
  }, [cropOffsets]);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragHandle || !canvasRef.current) return;

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const canvas = canvasRef.current;
    const scale = canvas.width / gridWidth;

    let delta: number;
    if (dragHandle === "top" || dragHandle === "bottom") {
      delta = (clientY - dragStart.y) / scale;
    } else {
      delta = (clientX - dragStart.x) / scale;
    }

    // For top/left, moving down/right increases crop, for bottom/right, moving up/left increases crop
    if (dragHandle === "bottom" || dragHandle === "right") {
      delta = -delta;
    }

    const newOffset = Math.max(0, Math.round(dragStart.offset + delta));

    // Limit so we don't crop more than available
    const maxCrop = dragHandle === "top" || dragHandle === "bottom"
      ? gridHeight - 1 - (dragHandle === "top" ? cropOffsets.bottom : cropOffsets.top)
      : gridWidth - 1 - (dragHandle === "left" ? cropOffsets.right : cropOffsets.left);

    setCropOffsets(prev => ({
      ...prev,
      [dragHandle]: Math.min(newOffset, maxCrop),
    }));
  }, [dragHandle, dragStart, gridWidth, gridHeight, cropOffsets]);

  const handleDragEnd = useCallback(() => {
    setDragHandle(null);
  }, []);

  // Add/remove global mouse listeners for dragging
  useEffect(() => {
    if (dragHandle) {
      window.addEventListener("mousemove", handleDragMove);
      window.addEventListener("mouseup", handleDragEnd);
      window.addEventListener("touchmove", handleDragMove);
      window.addEventListener("touchend", handleDragEnd);
      return () => {
        window.removeEventListener("mousemove", handleDragMove);
        window.removeEventListener("mouseup", handleDragEnd);
        window.removeEventListener("touchmove", handleDragMove);
        window.removeEventListener("touchend", handleDragEnd);
      };
    }
  }, [dragHandle, handleDragMove, handleDragEnd]);

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
    if (!isSizeChanged && !hasInteractiveCrop) {
      onClose();
      return;
    }

    saveToHistory();

    // Get flattened grid
    const sourceGrid = flattenLayers();
    let newGrid: PixelGrid;

    if (resizeMode === "scale") {
      // Scale existing content to fit new dimensions
      newGrid = scalePixelGrid(sourceGrid, newGridWidth, newGridHeight);
    } else if (hasInteractiveCrop) {
      // Use interactive crop offsets
      const cropWidth = effectiveCrop.width;
      const cropHeight = effectiveCrop.height;
      newGrid = createEmptyGrid(cropWidth, cropHeight);

      for (let y = 0; y < cropHeight; y++) {
        for (let x = 0; x < cropWidth; x++) {
          const sourceX = x + effectiveCrop.left;
          const sourceY = y + effectiveCrop.top;
          newGrid[y][x] = sourceGrid[sourceY]?.[sourceX] ?? null;
        }
      }

      // Update dimensions to match crop
      setDesignInfo({
        widthInches: cropWidth / meshCount,
        heightInches: cropHeight / meshCount,
        meshCount: meshCount as 14 | 18,
      });

      initializeGrid(cropWidth, cropHeight, newGrid);
      onClose();
      return;
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
            newGrid[newY][newX] = sourceGrid[y]?.[x] ?? null;
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
    } else if (hasInteractiveCrop) {
      const parts = [];
      if (cropOffsets.top > 0) parts.push(`${cropOffsets.top} from top`);
      if (cropOffsets.bottom > 0) parts.push(`${cropOffsets.bottom} from bottom`);
      if (cropOffsets.left > 0) parts.push(`${cropOffsets.left} from left`);
      if (cropOffsets.right > 0) parts.push(`${cropOffsets.right} from right`);
      return `Cropping ${parts.join(", ")}`;
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
  }, [resizeMode, newGridWidth, newGridHeight, gridWidth, gridHeight, isSizeChanged, hasInteractiveCrop, cropOffsets]);

  // Final dimensions for display (use effectiveCrop when using interactive crop)
  const finalWidth = hasInteractiveCrop ? effectiveCrop.width : newGridWidth;
  const finalHeight = hasInteractiveCrop ? effectiveCrop.height : newGridHeight;

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

          {/* Interactive Crop Preview (only for crop mode) */}
          {resizeMode === "crop" && (
            <div>
              <label className="block text-sm text-slate-400 mb-2">Drag edges to crop</label>
              <p className="text-xs text-slate-500 mb-3">
                Drag the red handles to adjust what gets cropped from each side
              </p>
              <div ref={previewRef} className="relative flex justify-center items-center bg-slate-900 rounded-lg p-4">
                <div className="relative">
                  <canvas ref={canvasRef} className="border border-slate-600 rounded" />

                  {/* Drag handles */}
                  {/* Top handle */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 cursor-ns-resize group"
                    style={{ top: `${(cropOffsets.top / gridHeight) * 100}%` }}
                    onMouseDown={(e) => handleDragStart(e, "top")}
                    onTouchStart={(e) => handleDragStart(e, "top")}
                  >
                    <div className={`w-12 h-3 -mt-1.5 rounded-full flex items-center justify-center transition-colors ${
                      dragHandle === "top" ? "bg-rose-500" : "bg-rose-600 group-hover:bg-rose-500"
                    }`}>
                      <div className="w-6 h-0.5 bg-white/70 rounded" />
                    </div>
                    {cropOffsets.top > 0 && (
                      <span className="absolute left-1/2 -translate-x-1/2 -top-5 text-xs text-rose-400 whitespace-nowrap">
                        -{cropOffsets.top} rows
                      </span>
                    )}
                  </div>

                  {/* Bottom handle */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 cursor-ns-resize group"
                    style={{ bottom: `${(cropOffsets.bottom / gridHeight) * 100}%` }}
                    onMouseDown={(e) => handleDragStart(e, "bottom")}
                    onTouchStart={(e) => handleDragStart(e, "bottom")}
                  >
                    <div className={`w-12 h-3 -mb-1.5 rounded-full flex items-center justify-center transition-colors ${
                      dragHandle === "bottom" ? "bg-rose-500" : "bg-rose-600 group-hover:bg-rose-500"
                    }`}>
                      <div className="w-6 h-0.5 bg-white/70 rounded" />
                    </div>
                    {cropOffsets.bottom > 0 && (
                      <span className="absolute left-1/2 -translate-x-1/2 -bottom-5 text-xs text-rose-400 whitespace-nowrap">
                        -{cropOffsets.bottom} rows
                      </span>
                    )}
                  </div>

                  {/* Left handle */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 cursor-ew-resize group"
                    style={{ left: `${(cropOffsets.left / gridWidth) * 100}%` }}
                    onMouseDown={(e) => handleDragStart(e, "left")}
                    onTouchStart={(e) => handleDragStart(e, "left")}
                  >
                    <div className={`w-3 h-12 -ml-1.5 rounded-full flex items-center justify-center transition-colors ${
                      dragHandle === "left" ? "bg-rose-500" : "bg-rose-600 group-hover:bg-rose-500"
                    }`}>
                      <div className="w-0.5 h-6 bg-white/70 rounded" />
                    </div>
                    {cropOffsets.left > 0 && (
                      <span className="absolute top-1/2 -translate-y-1/2 -left-8 text-xs text-rose-400 whitespace-nowrap">
                        -{cropOffsets.left}
                      </span>
                    )}
                  </div>

                  {/* Right handle */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 cursor-ew-resize group"
                    style={{ right: `${(cropOffsets.right / gridWidth) * 100}%` }}
                    onMouseDown={(e) => handleDragStart(e, "right")}
                    onTouchStart={(e) => handleDragStart(e, "right")}
                  >
                    <div className={`w-3 h-12 -mr-1.5 rounded-full flex items-center justify-center transition-colors ${
                      dragHandle === "right" ? "bg-rose-500" : "bg-rose-600 group-hover:bg-rose-500"
                    }`}>
                      <div className="w-0.5 h-6 bg-white/70 rounded" />
                    </div>
                    {cropOffsets.right > 0 && (
                      <span className="absolute top-1/2 -translate-y-1/2 -right-8 text-xs text-rose-400 whitespace-nowrap">
                        -{cropOffsets.right}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Reset crop button */}
              {hasInteractiveCrop && (
                <button
                  onClick={() => setCropOffsets({ top: 0, bottom: 0, left: 0, right: 0 })}
                  className="mt-2 w-full py-1.5 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  ↩️ Reset Crop
                </button>
              )}

              {/* Crop summary */}
              {hasInteractiveCrop && (
                <div className="mt-2 p-2 bg-rose-900/20 border border-rose-800/50 rounded text-xs text-rose-300">
                  Cropping to {effectiveCrop.width} × {effectiveCrop.height} stitches
                </div>
              )}
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
              <span className="text-white font-medium">{finalWidth} × {finalHeight} stitches</span>
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

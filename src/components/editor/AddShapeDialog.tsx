"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import { DmcColor, getDmcColorByNumber, DMC_PEARL_COTTON } from "@/lib/dmc-pearl-cotton";
import {
  SHAPES,
  Shape,
  scaleShape,
  shapeToGrid,
  getShapeAspectRatio,
} from "@/lib/shapes";

interface AddShapeDialogProps {
  onClose: () => void;
  onAddShape: (
    pixels: (string | null)[][],
    width: number,
    height: number,
    basePixels?: boolean[][],
    dmcNumber?: string
  ) => void;
}

export default function AddShapeDialog({ onClose, onAddShape }: AddShapeDialogProps) {
  const { currentColor, setCurrentColor } = useEditorStore();
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Shape settings
  const [selectedShape, setSelectedShape] = useState<Shape>(SHAPES[0]);
  const [size, setSize] = useState(20); // Size in stitches (width or height depending on aspect ratio)
  const [keepAspectRatio, setKeepAspectRatio] = useState(true);
  const [customWidth, setCustomWidth] = useState(20);
  const [customHeight, setCustomHeight] = useState(20);
  const [filled, setFilled] = useState(true);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorSearch, setColorSearch] = useState("");

  // Use local color state that syncs with store
  const [selectedColor, setSelectedColor] = useState<DmcColor | null>(currentColor);

  const dmcNumber = selectedColor?.dmcNumber || "310"; // Default to black
  const fillColor = selectedColor?.hex || "#000000";

  // Filter colors based on search
  const filteredColors = colorSearch
    ? DMC_PEARL_COTTON.filter(
        (c) =>
          c.dmcNumber.includes(colorSearch) ||
          c.name.toLowerCase().includes(colorSearch.toLowerCase())
      ).slice(0, 50)
    : DMC_PEARL_COTTON.slice(0, 50);

  // Calculate dimensions based on size and aspect ratio
  const aspectRatio = getShapeAspectRatio(selectedShape);
  const displayWidth = keepAspectRatio
    ? (aspectRatio >= 1 ? size : Math.round(size * aspectRatio))
    : customWidth;
  const displayHeight = keepAspectRatio
    ? (aspectRatio >= 1 ? Math.round(size / aspectRatio) : size)
    : customHeight;

  // Update custom dimensions when shape changes
  useEffect(() => {
    if (keepAspectRatio) {
      setCustomWidth(displayWidth);
      setCustomHeight(displayHeight);
    }
  }, [selectedShape, size, keepAspectRatio, displayWidth, displayHeight]);

  // Draw preview
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Scale shape to current size
    const scaledPixels = scaleShape(
      selectedShape.basePixels,
      displayWidth,
      displayHeight
    );

    // Calculate cell size to fit in preview
    const maxWidth = canvas.width;
    const maxHeight = canvas.height;
    const cellSize = Math.min(
      Math.floor(maxWidth / displayWidth),
      Math.floor(maxHeight / displayHeight),
      10 // Max cell size
    );

    // Calculate offset to center
    const totalWidth = displayWidth * cellSize;
    const totalHeight = displayHeight * cellSize;
    const offsetX = Math.floor((maxWidth - totalWidth) / 2);
    const offsetY = Math.floor((maxHeight - totalHeight) / 2);

    // Clear canvas
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, maxWidth, maxHeight);

    // Draw grid background
    ctx.fillStyle = "#334155";
    ctx.fillRect(offsetX, offsetY, totalWidth, totalHeight);

    // Draw pixels
    for (let y = 0; y < scaledPixels.length; y++) {
      for (let x = 0; x < scaledPixels[y].length; x++) {
        if (scaledPixels[y][x]) {
          ctx.fillStyle = fillColor;
          ctx.fillRect(
            offsetX + x * cellSize,
            offsetY + y * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }

    // Draw subtle grid lines
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= displayWidth; x++) {
      ctx.beginPath();
      ctx.moveTo(offsetX + x * cellSize, offsetY);
      ctx.lineTo(offsetX + x * cellSize, offsetY + totalHeight);
      ctx.stroke();
    }
    for (let y = 0; y <= displayHeight; y++) {
      ctx.beginPath();
      ctx.moveTo(offsetX, offsetY + y * cellSize);
      ctx.lineTo(offsetX + totalWidth, offsetY + y * cellSize);
      ctx.stroke();
    }
  }, [selectedShape, displayWidth, displayHeight, fillColor]);

  const handleAdd = useCallback(() => {
    const scaledPixels = scaleShape(
      selectedShape.basePixels,
      displayWidth,
      displayHeight
    );
    const grid = shapeToGrid(scaledPixels, dmcNumber);
    // Pass basePixels and dmcNumber for resize capability during placement
    onAddShape(grid, displayWidth, displayHeight, selectedShape.basePixels, dmcNumber);
  }, [selectedShape, displayWidth, displayHeight, dmcNumber, onAddShape]);

  // Group shapes by category
  const categories = [...new Set(SHAPES.map(s => s.category))];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Add Shape</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Shape selection */}
        {categories.map(category => (
          <div key={category} className="mb-4">
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">{category}</label>
            <div className="grid grid-cols-5 gap-2">
              {SHAPES.filter(s => s.category === category).map((shape) => (
                <button
                  key={shape.id}
                  onClick={() => setSelectedShape(shape)}
                  className={`p-2 rounded-lg border transition-colors flex flex-col items-center ${
                    selectedShape.id === shape.id
                      ? "bg-rose-900/30 border-rose-800"
                      : "bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500"
                  }`}
                  title={shape.name}
                >
                  {/* Mini preview of shape */}
                  <div className="w-8 h-8 flex items-center justify-center">
                    <ShapeMiniPreview shape={shape} />
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate w-full text-center">
                    {shape.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Size controls */}
        <div className="mb-4 p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={keepAspectRatio}
                onChange={(e) => setKeepAspectRatio(e.target.checked)}
                className="w-4 h-4 text-rose-900 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-rose-800"
              />
              <span className="text-slate-600 dark:text-slate-300 text-sm">Keep aspect ratio</span>
            </label>
          </div>

          {keepAspectRatio ? (
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Size (stitches)
              </label>
              <input
                type="range"
                min="5"
                max="100"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>5</span>
                <span className="text-rose-400">{size}</span>
                <span>100</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Width</label>
                <input
                  type="number"
                  min="3"
                  max="200"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Height</label>
                <input
                  type="number"
                  min="3"
                  max="200"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                />
              </div>
            </div>
          )}
        </div>

        {/* Color selector */}
        <div className="mb-4 p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Fill Color</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600"
            >
              <div
                className="w-6 h-6 rounded border border-slate-300 dark:border-slate-500"
                style={{ backgroundColor: fillColor }}
              />
              <span className="text-sm text-slate-600 dark:text-slate-300">
                DMC {dmcNumber}
              </span>
              <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <span className="text-xs text-slate-500">
              {selectedColor?.name || "Black"}
            </span>
          </div>

          {/* Color picker dropdown */}
          {showColorPicker && (
            <div className="mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-300 dark:border-slate-600">
              <input
                type="text"
                value={colorSearch}
                onChange={(e) => setColorSearch(e.target.value)}
                placeholder="Search by number or name..."
                className="w-full px-3 py-2 mb-3 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
              <div className="grid grid-cols-8 gap-1 max-h-32 overflow-y-auto">
                {filteredColors.map((color) => (
                  <button
                    key={color.dmcNumber}
                    onClick={() => {
                      setSelectedColor(color);
                      setCurrentColor(color);
                      setShowColorPicker(false);
                      setColorSearch("");
                    }}
                    className={`w-7 h-7 rounded border-2 transition-all ${
                      selectedColor?.dmcNumber === color.dmcNumber
                        ? "border-white scale-110"
                        : "border-transparent hover:border-slate-400"
                    }`}
                    style={{ backgroundColor: color.hex }}
                    title={`DMC ${color.dmcNumber} - ${color.name}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="mb-4">
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Preview</label>
          <canvas
            ref={previewCanvasRef}
            width={300}
            height={200}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600"
          />
          <p className="text-xs text-slate-500 mt-2 text-center">
            Size: {displayWidth} × {displayHeight} stitches
          </p>
        </div>

        {/* Tip */}
        <p className="text-xs text-slate-500 mb-4">
          Tip: After adding, click on the canvas to place the shape, then drag to reposition.
          Click Confirm or press Enter to commit.
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            className="flex-1 py-2.5 px-4 bg-rose-900 text-white rounded-lg hover:bg-rose-950 font-medium"
          >
            Add to Canvas
          </button>
        </div>
      </div>
    </div>
  );
}

// Mini preview component for shape buttons
function ShapeMiniPreview({ shape }: { shape: Shape }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 24;
    canvas.width = size;
    canvas.height = size;

    // Scale to fit
    const srcHeight = shape.basePixels.length;
    const srcWidth = shape.basePixels[0]?.length || 1;
    const scale = Math.min(size / srcWidth, size / srcHeight) * 0.9;
    const drawWidth = srcWidth * scale;
    const drawHeight = srcHeight * scale;
    const offsetX = (size - drawWidth) / 2;
    const offsetY = (size - drawHeight) / 2;

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Draw pixels
    ctx.fillStyle = "#f8fafc";
    const cellW = drawWidth / srcWidth;
    const cellH = drawHeight / srcHeight;

    for (let y = 0; y < srcHeight; y++) {
      for (let x = 0; x < srcWidth; x++) {
        if (shape.basePixels[y]?.[x]) {
          ctx.fillRect(
            offsetX + x * cellW,
            offsetY + y * cellH,
            cellW + 0.5,
            cellH + 0.5
          );
        }
      }
    }
  }, [shape]);

  return <canvas ref={canvasRef} width={24} height={24} />;
}

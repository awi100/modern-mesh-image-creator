"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useEditorStore } from "@/lib/store";
import {
  generateStitchPreviewDataUrl,
  generateCanvasPreviewDataUrl,
} from "@/lib/stitch-preview";

interface DesignPreviewProps {
  onClose: () => void;
}

type PreviewMode = "canvas" | "completed";

const CANVAS_COLORS = [
  { name: "Natural", color: "#f5f0e6" },
  { name: "White", color: "#ffffff" },
  { name: "Cream", color: "#fffdd0" },
  { name: "Light Blue", color: "#e6f0f5" },
  { name: "Light Pink", color: "#f5e6e6" },
  { name: "Light Green", color: "#e6f5e6" },
];

export default function DesignPreview({ onClose }: DesignPreviewProps) {
  const { flattenLayers, gridWidth, gridHeight, stitchType, designName } =
    useEditorStore();

  const grid = useMemo(() => flattenLayers(), [flattenLayers]);

  const [mode, setMode] = useState<PreviewMode>("canvas");
  const [canvasColor, setCanvasColor] = useState("#f5f0e6");
  const [showMesh, setShowMesh] = useState(true);
  const [cellSize, setCellSize] = useState(16);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(true);
  const [zoom, setZoom] = useState(1);
  const previewRef = useRef<HTMLDivElement>(null);

  // Calculate optimal cell size based on grid dimensions
  // Larger cells = more detail visible in thread texture
  useEffect(() => {
    const maxDimension = Math.max(gridWidth, gridHeight);
    if (maxDimension <= 40) {
      setCellSize(28);
    } else if (maxDimension <= 70) {
      setCellSize(24);
    } else if (maxDimension <= 100) {
      setCellSize(20);
    } else if (maxDimension <= 150) {
      setCellSize(16);
    } else {
      setCellSize(12);
    }
  }, [gridWidth, gridHeight]);

  // Generate preview based on mode
  useEffect(() => {
    setGenerating(true);

    const timeoutId = setTimeout(() => {
      try {
        let url: string;

        if (mode === "canvas") {
          url = generateCanvasPreviewDataUrl({
            grid,
            cellSize,
            canvasColor,
            showMesh,
          });
        } else {
          url = generateStitchPreviewDataUrl({
            grid,
            cellSize,
            stitchType: stitchType as "continental" | "basketweave",
            showGrid: showMesh,
            canvasColor,
          });
        }

        setPreviewUrl(url);
      } catch (error) {
        console.error("Failed to generate preview:", error);
      } finally {
        setGenerating(false);
      }
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [grid, cellSize, stitchType, showMesh, canvasColor, mode]);

  const handleDownload = () => {
    if (!previewUrl) return;

    const suffix = mode === "canvas" ? "canvas_preview" : "stitch_preview";
    const link = document.createElement("a");
    link.download = `${designName.replace(/\s+/g, "_")}_${suffix}.png`;
    link.href = previewUrl;
    link.click();
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.25, 4));
  const handleZoomOut = () => setZoom((z) => Math.max(z / 1.25, 0.25));
  const handleResetZoom = () => setZoom(1);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <svg
                className="w-5 h-5 text-rose-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              Design Preview
            </h2>
            <p className="text-sm text-slate-400">
              {mode === "canvas"
                ? "See how your printed canvas will look"
                : "See how your design will look when stitched"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-4 pt-3 pb-0 border-b border-slate-700">
          <div className="flex gap-1">
            <button
              onClick={() => setMode("canvas")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                mode === "canvas"
                  ? "bg-slate-700 text-white border-b-2 border-rose-500"
                  : "text-slate-400 hover:text-white hover:bg-slate-700/50"
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Canvas Preview
              </span>
            </button>
            <button
              onClick={() => setMode("completed")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                mode === "completed"
                  ? "bg-slate-700 text-white border-b-2 border-rose-500"
                  : "text-slate-400 hover:text-white hover:bg-slate-700/50"
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                Completed Preview
              </span>
            </button>
          </div>
        </div>

        {/* Options Bar */}
        <div className="p-3 border-b border-slate-700 flex flex-wrap items-center gap-4 bg-slate-750">
          {/* Canvas Color */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Canvas:</span>
            <div className="flex gap-1">
              {CANVAS_COLORS.map((c) => (
                <button
                  key={c.color}
                  onClick={() => setCanvasColor(c.color)}
                  className={`w-6 h-6 rounded border-2 transition-all ${
                    canvasColor === c.color
                      ? "border-rose-500 scale-110"
                      : "border-slate-600 hover:border-slate-400"
                  }`}
                  style={{ backgroundColor: c.color }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Show Mesh Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showMesh}
              onChange={(e) => setShowMesh(e.target.checked)}
              className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-rose-600 focus:ring-rose-500"
            />
            <span className="text-xs text-slate-300">Show mesh</span>
          </label>

          {/* Stitch Type Indicator (only for completed mode) */}
          {mode === "completed" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Stitch:</span>
              <span className="text-xs text-white bg-slate-700 px-2 py-0.5 rounded">
                {stitchType === "continental" ? "Continental" : "Basketweave"}
              </span>
            </div>
          )}

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={handleZoomOut}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
              title="Zoom out"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <button
              onClick={handleResetZoom}
              className="px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 rounded"
              title="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
              title="Zoom in"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Preview Area */}
        <div
          ref={previewRef}
          className="flex-1 overflow-auto bg-slate-900 p-4 flex items-center justify-center"
        >
          {generating ? (
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-slate-600 border-t-rose-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-400">Generating preview...</p>
            </div>
          ) : previewUrl ? (
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center",
                transition: "transform 0.2s ease",
              }}
            >
              <img
                src={previewUrl}
                alt={mode === "canvas" ? "Canvas preview" : "Stitch preview"}
                className="max-w-none shadow-xl rounded"
                style={{ imageRendering: "auto" }}
              />
            </div>
          ) : (
            <p className="text-slate-400">Failed to generate preview</p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {gridWidth} x {gridHeight} stitches at {cellSize}px per stitch
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
            >
              Close
            </button>
            <button
              onClick={handleDownload}
              disabled={!previewUrl || generating}
              className="px-4 py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Download Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { useEditorStore, Tool } from "@/lib/store";

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: "pencil", label: "Pencil", icon: "✏️" },
  { id: "brush", label: "Brush", icon: "🖌️" },
  { id: "eraser", label: "Eraser", icon: "🧹" },
  { id: "fill", label: "Fill", icon: "🪣" },
  { id: "line", label: "Line", icon: "📏" },
  { id: "rectangle", label: "Rectangle", icon: "⬜" },
  { id: "select", label: "Select", icon: "⬚" },
  { id: "magicWand", label: "Magic Wand", icon: "🪄" },
  { id: "eyedropper", label: "Eyedropper", icon: "💧" },
];

export default function Toolbar() {
  const {
    currentTool,
    setTool,
    canUndo,
    canRedo,
    undo,
    redo,
    zoom,
    setZoom,
    resetView,
    showGrid,
    setShowGrid,
    brushSize,
    setBrushSize,
    mirrorHorizontal,
    mirrorVertical,
    rotate90,
    clearSelection,
    selectAll,
    copySelectionToClipboard,
    cutSelectionToClipboard,
    deleteSelection,
    selection,
  } = useEditorStore();

  return (
    <div className="bg-slate-800 border-b border-slate-700 p-2 overflow-x-auto">
      <div className="flex items-center gap-2 md:gap-4 min-w-max">
        {/* Tools - scrollable on mobile */}
        <div className="flex items-center gap-1">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setTool(tool.id)}
              className={`p-2 md:px-2 md:py-1.5 rounded-lg transition-colors flex items-center gap-1 touch-manipulation ${
                currentTool === tool.id
                  ? "bg-rose-900 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600 active:bg-slate-500"
              }`}
              title={tool.label}
            >
              <span className="text-lg md:text-base">{tool.icon}</span>
              <span className="text-xs font-medium hidden lg:inline">{tool.label}</span>
            </button>
          ))}
        </div>

        {/* Brush size (shown when brush tool is active) */}
        {currentTool === "brush" && (
          <>
            <div className="w-px h-8 bg-slate-600 hidden md:block" />
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm hidden sm:inline">Size:</span>
              <button
                onClick={() => setBrushSize(brushSize - 1)}
                disabled={brushSize <= 1}
                className="p-2 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 touch-manipulation"
              >
                -
              </button>
              <span className="text-slate-300 text-sm w-6 text-center">{brushSize}</span>
              <button
                onClick={() => setBrushSize(brushSize + 1)}
                disabled={brushSize >= 10}
                className="p-2 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 touch-manipulation"
              >
                +
              </button>
            </div>
          </>
        )}

        <div className="w-px h-8 bg-slate-600 hidden md:block" />

        {/* Undo/Redo - hidden on mobile (shown in bottom bar) */}
        <div className="hidden md:flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo()}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            ↩️
          </button>
          <button
            onClick={redo}
            disabled={!canRedo()}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Redo (Ctrl+Y)"
          >
            ↪️
          </button>
        </div>

        <div className="w-px h-8 bg-slate-600 hidden md:block" />

        {/* Zoom */}
        <div className="flex items-center gap-1 md:gap-2">
          <button
            onClick={() => setZoom(zoom / 1.2)}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 touch-manipulation"
            title="Zoom Out"
          >
            ➖
          </button>
          <span className="text-slate-300 text-xs md:text-sm w-12 md:w-16 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(zoom * 1.2)}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 touch-manipulation"
            title="Zoom In"
          >
            ➕
          </button>
          <button
            onClick={resetView}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 touch-manipulation hidden sm:block"
            title="Reset View"
          >
            🔄
          </button>
        </div>

        <div className="w-px h-8 bg-slate-600" />

        {/* Grid toggle */}
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`p-2 rounded-lg transition-colors touch-manipulation ${
            showGrid
              ? "bg-rose-900 text-white"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
          title="Toggle Grid"
        >
          #️⃣
        </button>

        <div className="w-px h-8 bg-slate-600 hidden sm:block" />

        {/* Transform - hidden on very small screens */}
        <div className="hidden sm:flex items-center gap-1">
          <button
            onClick={mirrorHorizontal}
            className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center gap-1 touch-manipulation"
            title="Mirror Horizontal"
          >
            <span>↔️</span>
            <span className="text-xs hidden lg:inline">Flip H</span>
          </button>
          <button
            onClick={mirrorVertical}
            className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center gap-1 touch-manipulation"
            title="Mirror Vertical"
          >
            <span>↕️</span>
            <span className="text-xs hidden lg:inline">Flip V</span>
          </button>
          <button
            onClick={() => rotate90(true)}
            className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center gap-1 touch-manipulation"
            title="Rotate 90° Clockwise"
          >
            <span>↻</span>
            <span className="text-xs hidden lg:inline">Rotate</span>
          </button>
        </div>

        {/* Selection actions */}
        {selection && (
          <>
            <div className="w-px h-8 bg-slate-600" />
            <div className="flex items-center gap-1">
              <button
                onClick={copySelectionToClipboard}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs md:text-sm touch-manipulation"
                title="Copy (Ctrl+C)"
              >
                Copy
              </button>
              <button
                onClick={cutSelectionToClipboard}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs md:text-sm touch-manipulation hidden sm:block"
                title="Cut (Ctrl+X)"
              >
                Cut
              </button>
              <button
                onClick={deleteSelection}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs md:text-sm touch-manipulation"
                title="Delete"
              >
                Delete
              </button>
              <button
                onClick={clearSelection}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs md:text-sm touch-manipulation hidden sm:block"
                title="Clear Selection"
              >
                Deselect
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

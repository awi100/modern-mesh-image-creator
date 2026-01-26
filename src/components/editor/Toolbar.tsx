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
    <div className="bg-slate-800 border-b border-slate-700 p-2 flex items-center gap-4 flex-wrap">
      {/* Tools */}
      <div className="flex items-center gap-1">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setTool(tool.id)}
            className={`px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${
              currentTool === tool.id
                ? "bg-purple-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
            title={tool.label}
          >
            <span className="text-base">{tool.icon}</span>
            <span className="text-xs font-medium hidden sm:inline">{tool.label}</span>
          </button>
        ))}
      </div>

      {/* Brush size (shown when brush tool is active) */}
      {currentTool === "brush" && (
        <>
          <div className="w-px h-8 bg-slate-600" />
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">Size:</span>
            <button
              onClick={() => setBrushSize(brushSize - 1)}
              disabled={brushSize <= 1}
              className="p-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50"
            >
              -
            </button>
            <span className="text-slate-300 text-sm w-6 text-center">{brushSize}</span>
            <button
              onClick={() => setBrushSize(brushSize + 1)}
              disabled={brushSize >= 10}
              className="p-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50"
            >
              +
            </button>
          </div>
        </>
      )}

      <div className="w-px h-8 bg-slate-600" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
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

      <div className="w-px h-8 bg-slate-600" />

      {/* Zoom */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setZoom(zoom / 1.2)}
          className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
          title="Zoom Out"
        >
          ➖
        </button>
        <span className="text-slate-300 text-sm w-16 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(zoom * 1.2)}
          className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
          title="Zoom In"
        >
          ➕
        </button>
        <button
          onClick={resetView}
          className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
          title="Reset View"
        >
          🔄
        </button>
      </div>

      <div className="w-px h-8 bg-slate-600" />

      {/* Grid toggle */}
      <button
        onClick={() => setShowGrid(!showGrid)}
        className={`p-2 rounded-lg transition-colors ${
          showGrid
            ? "bg-purple-600 text-white"
            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
        }`}
        title="Toggle Grid"
      >
        #️⃣
      </button>

      <div className="w-px h-8 bg-slate-600" />

      {/* Transform */}
      <div className="flex items-center gap-1">
        <button
          onClick={mirrorHorizontal}
          className="px-2 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center gap-1"
          title="Mirror Horizontal"
        >
          <span>↔️</span>
          <span className="text-xs hidden sm:inline">Flip H</span>
        </button>
        <button
          onClick={mirrorVertical}
          className="px-2 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center gap-1"
          title="Mirror Vertical"
        >
          <span>↕️</span>
          <span className="text-xs hidden sm:inline">Flip V</span>
        </button>
        <button
          onClick={() => rotate90(true)}
          className="px-2 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center gap-1"
          title="Rotate 90° Clockwise"
        >
          <span>↻</span>
          <span className="text-xs hidden sm:inline">Rotate</span>
        </button>
      </div>

      {/* Selection actions */}
      {selection && (
        <>
          <div className="w-px h-8 bg-slate-600" />
          <div className="flex items-center gap-1">
            <button
              onClick={copySelectionToClipboard}
              className="px-3 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm"
              title="Copy (Ctrl+C)"
            >
              Copy
            </button>
            <button
              onClick={cutSelectionToClipboard}
              className="px-3 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm"
              title="Cut (Ctrl+X)"
            >
              Cut
            </button>
            <button
              onClick={deleteSelection}
              className="px-3 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm"
              title="Delete"
            >
              Delete
            </button>
            <button
              onClick={clearSelection}
              className="px-3 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm"
              title="Clear Selection"
            >
              Deselect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

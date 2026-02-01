"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useEditorStore, Tool } from "@/lib/store";

interface ToolbarProps {
  onEnterPasteMode?: () => void;
}

const tools: { id: Tool; label: string; icon: string; description: string }[] = [
  { id: "pencil", label: "Pencil", icon: "✏️", description: "Draw single pixels. Tap to place, drag to pan." },
  { id: "pan", label: "Pan", icon: "✋", description: "Move around the canvas without drawing. Perfect for touch devices." },
  { id: "brush", label: "Brush", icon: "🖌️", description: "Draw multiple pixels at once. Adjust size with +/- buttons." },
  { id: "eraser", label: "Eraser", icon: "🧼", description: "Remove color from pixels. Choose S/M/L size." },
  { id: "fill", label: "Fill", icon: "🪣", description: "Fill an area with the current color." },
  { id: "rectangle", label: "Rectangle", icon: "⬜", description: "Draw rectangles on the canvas." },
  { id: "select", label: "Select", icon: "⬚", description: "Select an area to copy, cut, or delete." },
  { id: "magicWand", label: "Magic Wand", icon: "🪄", description: "Select all pixels of the same color." },
  { id: "eyedropper", label: "Eyedropper", icon: "💧", description: "Pick a color from the canvas." },
];

export default function Toolbar({ onEnterPasteMode }: ToolbarProps) {
  const {
    currentTool,
    setTool,
    canUndo,
    canRedo,
    undo,
    redo,
    zoom,
    resetView,
    showGrid,
    setShowGrid,
    showSymbols,
    setShowSymbols,
    brushSize,
    setBrushSize,
    eraserSize,
    setEraserSize,
    mirrorHorizontal,
    mirrorVertical,
    rotate90,
    clearSelection,
    centerSelection,
    selectAll,
    copySelectionToClipboard,
    cutSelectionToClipboard,
    deleteSelection,
    selection,
    clipboard,
  } = useEditorStore();

  const [showHelp, setShowHelp] = useState(false);

  // Get current tool info for the mobile label
  const currentToolInfo = tools.find((t) => t.id === currentTool);

  return (
    <>
    {/* Help Modal */}
    {showHelp && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 rounded-xl p-4 w-full max-w-md shadow-xl max-h-[80vh] overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Tool Guide</h2>
            <button
              onClick={() => setShowHelp(false)}
              className="p-1 text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="space-y-3">
            {tools.map((tool) => (
              <div key={tool.id} className="flex items-start gap-3 p-2 bg-slate-700/50 rounded-lg">
                <span className="text-xl">{tool.icon}</span>
                <div>
                  <p className="text-white font-medium">{tool.label}</p>
                  <p className="text-sm text-slate-400">{tool.description}</p>
                </div>
              </div>
            ))}
            <div className="border-t border-slate-600 pt-3 mt-3">
              <p className="text-sm text-slate-400">
                <strong className="text-white">Tip:</strong> On iPad, use two fingers to zoom and pan the canvas.
              </p>
            </div>
            <div className="border-t border-slate-600 pt-3 mt-3">
              <Link
                href="/help"
                target="_blank"
                className="block w-full py-2 px-4 bg-rose-900 text-white text-center rounded-lg hover:bg-rose-800 text-sm font-medium"
              >
                View Full User Guide
              </Link>
            </div>
          </div>
        </div>
      </div>
    )}
    <div className="bg-slate-800 border-b border-slate-700 p-2 overflow-x-auto">
      <div className="flex items-center gap-2 md:gap-4 min-w-max">
        {/* Current tool indicator - visible on mobile/tablet */}
        <div
          className="lg:hidden flex items-center gap-1 px-2 py-1 bg-rose-900/50 rounded-lg border border-rose-800"
          title={currentToolInfo?.description}
        >
          <span className="text-xs text-rose-200 font-medium">
            {currentToolInfo?.label || currentTool}
          </span>
        </div>

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
              title={`${tool.label}: ${tool.description}`}
            >
              <span className="text-lg md:text-base">{tool.icon}</span>
              <span className="text-xs font-medium hidden lg:inline">{tool.label}</span>
            </button>
          ))}
          {/* Help button */}
          <button
            onClick={() => setShowHelp(true)}
            className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 touch-manipulation"
            title="Tool Guide"
          >
            <span className="text-lg md:text-base">❓</span>
          </button>
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

        {/* Eraser size (shown when eraser tool is active) */}
        {currentTool === "eraser" && (
          <>
            <div className="w-px h-8 bg-slate-600 hidden md:block" />
            <div className="flex items-center gap-1">
              <span className="text-slate-400 text-sm hidden sm:inline">Size:</span>
              {([
                { label: "S", size: 1 },
                { label: "M", size: 3 },
                { label: "L", size: 7 },
              ] as const).map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setEraserSize(opt.size)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors touch-manipulation ${
                    eraserSize === opt.size
                      ? "bg-rose-900 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
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

        {/* Zoom indicator & reset */}
        <div className="flex items-center gap-1 md:gap-2">
          <span className="text-slate-300 text-xs md:text-sm w-12 md:w-16 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={resetView}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 touch-manipulation"
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

        {/* Symbols toggle */}
        <button
          onClick={() => setShowSymbols(!showSymbols)}
          className={`p-2 rounded-lg transition-colors touch-manipulation ${
            showSymbols
              ? "bg-rose-900 text-white"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
          title="Toggle Symbols"
        >
          <span className="text-base">Aa</span>
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

        {/* Clipboard actions - always visible */}
        <div className="w-px h-8 bg-slate-600 hidden sm:block" />
        <div className="hidden sm:flex items-center gap-1">
          <button
            onClick={copySelectionToClipboard}
            disabled={!selection}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            title="Copy (Ctrl+C)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            onClick={cutSelectionToClipboard}
            disabled={!selection}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            title="Cut (Ctrl+X)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
            </svg>
          </button>
          <button
            onClick={onEnterPasteMode}
            disabled={!clipboard}
            className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            title="Paste (Ctrl+V) - Click to place"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </button>
        </div>

        {/* Selection actions - contextual when selection exists */}
        {selection && (
          <>
            <div className="w-px h-8 bg-slate-600" />
            <div className="flex items-center gap-1">
              <button
                onClick={centerSelection}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs md:text-sm touch-manipulation"
                title="Center selection on canvas"
              >
                <span className="hidden sm:inline">Center</span>
                <span className="sm:hidden">⊕</span>
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
    </>
  );
}

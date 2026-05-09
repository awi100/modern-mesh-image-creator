"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useEditorStore, Tool } from "@/lib/store";
import Tooltip from "@/components/Tooltip";

interface ToolbarProps {
  onEnterPasteMode?: () => void;
  onShowPatternRepeat?: () => void;
  onShowReplaceColor?: () => void;
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

export default function Toolbar({ onEnterPasteMode, onShowPatternRepeat, onShowReplaceColor }: ToolbarProps) {
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
    mirrorSelectionToOpposite,
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

  return (
    <>
    {/* Help Modal */}
    {showHelp && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 w-full max-w-md shadow-xl max-h-[80vh] overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Tool Guide</h2>
            <button
              onClick={() => setShowHelp(false)}
              className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="space-y-3">
            {tools.map((tool) => (
              <div key={tool.id} className="flex items-start gap-3 p-2 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
                <span className="text-xl">{tool.icon}</span>
                <div>
                  <p className="text-slate-900 dark:text-white font-medium">{tool.label}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{tool.description}</p>
                </div>
              </div>
            ))}
            <div className="border-t border-slate-200 dark:border-slate-600 pt-3 mt-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <strong className="text-slate-900 dark:text-white">Tip:</strong> On iPad, use two fingers to zoom and pan the canvas.
              </p>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-600 pt-3 mt-3">
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
    <div className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-2 overflow-x-auto">
      <div className="flex items-center gap-2 md:gap-4 min-w-max">
        {/* Tools - scrollable on mobile, labels show on all breakpoints */}
        <div className="flex items-center gap-1">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setTool(tool.id)}
              className={`px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1 touch-manipulation ${
                currentTool === tool.id
                  ? "bg-rose-900 text-white"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 active:bg-slate-500"
              }`}
              title={`${tool.label}: ${tool.description}`}
            >
              <span className="text-base">{tool.icon}</span>
              <span className="text-xs font-medium">{tool.label}</span>
            </button>
          ))}
          {/* Replace Color button */}
          {onShowReplaceColor && (
            <Tooltip label="Replace Color">
              <button
                onClick={onShowReplaceColor}
                className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 touch-manipulation flex items-center gap-1"
                aria-label="Replace Color"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-xs font-medium hidden lg:inline">Replace</span>
              </button>
            </Tooltip>
          )}
          {/* Help button */}
          <Tooltip label="Tool Guide">
            <button
              onClick={() => setShowHelp(true)}
              className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 touch-manipulation"
              aria-label="Tool Guide"
            >
              <span className="text-lg md:text-base">❓</span>
            </button>
          </Tooltip>
        </div>

        {/* Brush size (shown when brush tool is active) */}
        {currentTool === "brush" && (
          <>
            <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 hidden md:block" />
            <div className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400 text-sm hidden sm:inline">Size:</span>
              <button
                onClick={() => setBrushSize(brushSize - 1)}
                disabled={brushSize <= 1}
                className="p-2 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 touch-manipulation"
                aria-label="Decrease brush size"
              >
                -
              </button>
              <span className="text-slate-300 text-sm w-6 text-center">{brushSize}</span>
              <button
                onClick={() => setBrushSize(brushSize + 1)}
                disabled={brushSize >= 10}
                className="p-2 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 touch-manipulation"
                aria-label="Increase brush size"
              >
                +
              </button>
            </div>
          </>
        )}

        {/* Eraser size (shown when eraser tool is active) */}
        {currentTool === "eraser" && (
          <>
            <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 hidden md:block" />
            <div className="flex items-center gap-1">
              <span className="text-slate-500 dark:text-slate-400 text-sm hidden sm:inline">Size:</span>
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
                      : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 hidden md:block" />

        {/* Undo/Redo - hidden on mobile (shown in bottom bar) */}
        <div className="hidden md:flex items-center gap-1">
          <Tooltip label="Undo" position="bottom" shortcut="⌘Z">
            <button
              onClick={undo}
              disabled={!canUndo()}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ↩️
            </button>
          </Tooltip>
          <Tooltip label="Redo" position="bottom" shortcut="⌘⇧Z">
            <button
              onClick={redo}
              disabled={!canRedo()}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ↪️
            </button>
          </Tooltip>
        </div>

        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 hidden md:block" />

        {/* Zoom indicator & reset */}
        <div className="flex items-center gap-1 md:gap-2">
          <span className="text-slate-600 dark:text-slate-300 text-xs md:text-sm w-12 md:w-16 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Tooltip label="Reset View" position="bottom">
            <button
              onClick={resetView}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 touch-manipulation"
            >
              🔄
            </button>
          </Tooltip>
        </div>

        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600" />

        {/* Grid toggle */}
        <Tooltip label="Toggle Grid" position="bottom">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-2 rounded-lg transition-colors touch-manipulation ${
              showGrid
                ? "bg-rose-900 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            #️⃣
          </button>
        </Tooltip>

        {/* Symbols toggle */}
        <Tooltip label="Toggle Symbols" position="bottom">
          <button
            onClick={() => setShowSymbols(!showSymbols)}
            className={`p-2 rounded-lg transition-colors touch-manipulation ${
              showSymbols
                ? "bg-rose-900 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            <span className="text-base">Aa</span>
          </button>
        </Tooltip>

        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 hidden sm:block" />

        {/* Transform - hidden on very small screens */}
        <div className="hidden sm:flex items-center gap-1">
          <Tooltip label="Flip Horizontal" position="bottom">
            <button
              onClick={mirrorHorizontal}
              className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center gap-1 touch-manipulation"
            >
              <span>↔️</span>
              <span className="text-xs hidden lg:inline">Flip H</span>
            </button>
          </Tooltip>
          <Tooltip label="Flip Vertical" position="bottom">
            <button
              onClick={mirrorVertical}
              className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center gap-1 touch-manipulation"
            >
              <span>↕️</span>
              <span className="text-xs hidden lg:inline">Flip V</span>
            </button>
          </Tooltip>
          <Tooltip label="Rotate 90°" position="bottom">
            <button
              onClick={() => rotate90(true)}
              className="p-2 md:px-2 md:py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center gap-1 touch-manipulation"
            >
              <span>↻</span>
              <span className="text-xs hidden lg:inline">Rotate</span>
            </button>
          </Tooltip>
        </div>

        {/* Clipboard actions - always visible */}
        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 hidden sm:block" />
        <div className="hidden sm:flex items-center gap-1">
          <Tooltip label="Copy" position="bottom" shortcut="⌘C">
            <button
              onClick={copySelectionToClipboard}
              disabled={!selection}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Cut" position="bottom" shortcut="⌘X">
            <button
              onClick={cutSelectionToClipboard}
              disabled={!selection}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Paste" position="bottom" shortcut="⌘V">
            <button
              onClick={onEnterPasteMode}
              disabled={!clipboard}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Selection actions - contextual when selection exists */}
        {selection && (
          <>
            <div className="w-px h-8 bg-slate-300 dark:bg-slate-600" />
            <div className="flex items-center gap-1">
              <button
                onClick={centerSelection}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs md:text-sm touch-manipulation"
                title="Center selection on canvas"
              >
                <span className="hidden sm:inline">Center</span>
                <span className="sm:hidden">⊕</span>
              </button>
              {/* Mirror to opposite side buttons */}
              <button
                onClick={() => mirrorSelectionToOpposite("horizontal")}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs md:text-sm touch-manipulation hidden sm:flex items-center gap-1"
                title="Mirror selection to opposite horizontal side"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-8 4h8M12 3v18" />
                </svg>
                <span className="hidden lg:inline">Mirror ↔</span>
              </button>
              <button
                onClick={() => mirrorSelectionToOpposite("vertical")}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs md:text-sm touch-manipulation hidden sm:flex items-center gap-1"
                title="Mirror selection to opposite vertical side"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8v8m4-8v8m4-8v8M3 12h18" />
                </svg>
                <span className="hidden lg:inline">Mirror ↕</span>
              </button>
              {onShowPatternRepeat && (
                <button
                  onClick={onShowPatternRepeat}
                  className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs md:text-sm touch-manipulation hidden sm:flex items-center gap-1"
                  title="Pattern Repeat - Tile selection across canvas"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                  <span className="hidden lg:inline">Repeat</span>
                </button>
              )}
              <button
                onClick={deleteSelection}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs md:text-sm touch-manipulation"
                title="Delete"
              >
                Delete
              </button>
              <button
                onClick={clearSelection}
                className="px-2 md:px-3 py-1.5 md:py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs md:text-sm touch-manipulation hidden sm:block"
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

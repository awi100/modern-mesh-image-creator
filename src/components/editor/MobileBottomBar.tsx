"use client";

import React from "react";
import { useEditorStore } from "@/lib/store";

interface MobileBottomBarProps {
  onShowColors: () => void;
  onShowMetrics: () => void;
  onShowLayers?: () => void;
}

export default function MobileBottomBar({ onShowColors, onShowMetrics, onShowLayers }: MobileBottomBarProps) {
  const { currentColor, undo, redo, canUndo, canRedo } = useEditorStore();

  return (
    <div className="md:hidden bg-slate-800 border-t border-slate-700 px-2 py-2 flex items-center justify-around safe-area-bottom">
      {/* Current color indicator + open color picker */}
      <button
        onClick={onShowColors}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
      >
        <div
          className="w-6 h-6 rounded border border-white/30"
          style={{ backgroundColor: currentColor?.hex || "#ccc" }}
        />
        <span className="text-white text-sm">Colors</span>
      </button>

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={undo}
          disabled={!canUndo()}
          className="p-3 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-lg">↩️</span>
        </button>
        <button
          onClick={redo}
          disabled={!canRedo()}
          className="p-3 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-lg">↪️</span>
        </button>
      </div>

      {/* Layers panel */}
      {onShowLayers && (
        <button
          onClick={onShowLayers}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-white text-sm hidden xs:inline">Layers</span>
        </button>
      )}

      {/* Info panel */}
      <button
        onClick={onShowMetrics}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
      >
        <span className="text-lg">📊</span>
        <span className="text-white text-sm hidden xs:inline">Info</span>
      </button>
    </div>
  );
}

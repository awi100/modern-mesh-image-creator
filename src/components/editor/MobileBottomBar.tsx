"use client";

import React from "react";
import { useEditorStore } from "@/lib/store";

interface MobileBottomBarProps {
  onShowColors: () => void;
  onShowMetrics: () => void;
}

export default function MobileBottomBar({ onShowColors, onShowMetrics }: MobileBottomBarProps) {
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

      {/* Info panel */}
      <button
        onClick={onShowMetrics}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
      >
        <span className="text-lg">📊</span>
        <span className="text-white text-sm">Info</span>
      </button>
    </div>
  );
}

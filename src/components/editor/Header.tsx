"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/lib/store";
import pako from "pako";

interface HeaderProps {
  onShowImageImport: () => void;
  onShowCanvasResize: () => void;
  onShowExport: () => void;
}

export default function Header({
  onShowImageImport,
  onShowCanvasResize,
  onShowExport,
}: HeaderProps) {
  const router = useRouter();

  const {
    designId,
    designName,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    grid,
    stitchType,
    bufferPercent,
    referenceImageUrl,
    referenceImageOpacity,
    isDirty,
    setDesignInfo,
    markClean,
  } = useEditorStore();

  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(designName);

  const handleSave = useCallback(async () => {
    setSaving(true);

    try {
      // Compress pixel data
      const pixelDataJson = JSON.stringify(grid);
      const compressed = pako.deflate(pixelDataJson);
      const base64 = btoa(String.fromCharCode(...compressed));

      const body = {
        name: designName,
        widthInches,
        heightInches,
        meshCount,
        gridWidth,
        gridHeight,
        pixelData: base64,
        stitchType,
        bufferPercent,
        referenceImageUrl,
        referenceImageOpacity,
      };

      const url = designId ? `/api/designs/${designId}` : "/api/designs";
      const method = designId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error("Failed to save design");
      }

      const data = await response.json();

      if (!designId) {
        setDesignInfo({ designId: data.id });
        router.replace(`/design/${data.id}`);
      }

      markClean();
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    designId,
    designName,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    grid,
    stitchType,
    bufferPercent,
    referenceImageUrl,
    referenceImageOpacity,
    setDesignInfo,
    markClean,
    router,
  ]);

  const handleNameSubmit = () => {
    setDesignInfo({ designName: tempName });
    setEditingName(false);
  };

  return (
    <header className="bg-slate-800 border-b border-slate-700 px-2 md:px-4 py-2 md:py-3">
      <div className="flex items-center justify-between gap-2">
        {/* Left side - Logo and name */}
        <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
          <button
            onClick={() => router.push("/")}
            className="flex-shrink-0 flex items-center gap-2 text-slate-400 hover:text-white"
          >
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
          </button>

          {/* Design name */}
          <div className="min-w-0 flex-1">
            {editingName ? (
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
            ) : (
              <button
                onClick={() => {
                  setTempName(designName);
                  setEditingName(true);
                }}
                className="text-white text-sm md:text-base font-medium hover:text-purple-400 transition-colors flex items-center gap-1 truncate max-w-full"
              >
                <span className="truncate">{designName}</span>
                {isDirty && <span className="text-purple-400 flex-shrink-0">•</span>}
              </button>
            )}
            <span className="text-slate-500 text-xs md:text-sm hidden sm:block">
              {widthInches}&quot; × {heightInches}&quot; @ {meshCount} mesh
            </span>
          </div>
        </div>

        {/* Right side - Actions */}
        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          {/* Show icons on mobile, text on desktop */}
          <button
            onClick={onShowImageImport}
            className="p-2 md:px-3 md:py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm touch-manipulation"
            title="Import Image"
          >
            <span className="md:hidden">📷</span>
            <span className="hidden md:inline">Import</span>
          </button>
          <button
            onClick={onShowCanvasResize}
            className="p-2 md:px-3 md:py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm touch-manipulation"
            title="Resize Canvas"
          >
            <span className="md:hidden">📐</span>
            <span className="hidden md:inline">Resize</span>
          </button>
          <button
            onClick={onShowExport}
            className="p-2 md:px-3 md:py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm touch-manipulation"
            title="Export"
          >
            <span className="md:hidden">📤</span>
            <span className="hidden md:inline">Export</span>
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 md:px-4 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium touch-manipulation"
          >
            {saving ? "..." : "Save"}
          </button>
        </div>
      </div>
    </header>
  );
}

"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/lib/store";
import { useAutoSave } from "@/hooks/useAutoSave";
import pako from "pako";

interface HeaderProps {
  onShowImageImport: () => void;
  onShowCanvasResize: () => void;
  onShowExport: () => void;
  onShowTextDialog: () => void;
}

export default function Header({
  onShowImageImport,
  onShowCanvasResize,
  onShowExport,
  onShowTextDialog,
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
    setLastSavedAt,
  } = useEditorStore();

  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(designName);

  // Auto-save hook
  const { autoSaveStatus, lastSavedAt } = useAutoSave();

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
      setLastSavedAt(new Date());
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
    setLastSavedAt,
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
            <div className="w-8 h-8 bg-gradient-to-br from-rose-900 to-rose-800 rounded-lg flex items-center justify-center">
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
                className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                autoFocus
              />
            ) : (
              <button
                onClick={() => {
                  setTempName(designName);
                  setEditingName(true);
                }}
                className="text-white text-sm md:text-base font-medium hover:text-rose-400 transition-colors flex items-center gap-1 truncate max-w-full"
              >
                <span className="truncate">{designName}</span>
                {isDirty && <span className="text-rose-400 flex-shrink-0">•</span>}
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
            onClick={onShowTextDialog}
            className="p-2 md:px-3 md:py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm touch-manipulation"
            title="Add Text"
          >
            <span className="md:hidden">Aa</span>
            <span className="hidden md:inline">Text</span>
          </button>
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

          {/* Auto-save status indicator */}
          {designId && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
              {autoSaveStatus === 'saving' && (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Saving...</span>
                </>
              )}
              {autoSaveStatus === 'saved' && (
                <>
                  <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-400">Saved</span>
                </>
              )}
              {autoSaveStatus === 'error' && (
                <>
                  <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-red-400">Save failed</span>
                </>
              )}
              {autoSaveStatus === 'idle' && lastSavedAt && !isDirty && (
                <span>Saved</span>
              )}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || autoSaveStatus === 'saving'}
            className="px-3 md:px-4 py-1.5 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 text-sm font-medium touch-manipulation"
          >
            {saving || autoSaveStatus === 'saving' ? "..." : designId ? "Save" : "Save"}
          </button>
        </div>
      </div>
    </header>
  );
}

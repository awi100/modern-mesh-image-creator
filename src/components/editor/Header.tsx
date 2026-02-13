"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEditorStore } from "@/lib/store";
import { useAutoSave } from "@/hooks/useAutoSave";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import pako from "pako";
import { triggerSessionExpired } from "@/components/SessionExpiredModal";
import { OfflineStatusIndicator } from "@/components/OfflineStatusIndicator";
import { useToast } from "@/components/Toast";
import { ThemeToggle } from "@/components/ThemeToggle";

// Generate a small preview image as base64 data URL
function generatePreviewImage(
  grid: (string | null)[][],
  gridWidth: number,
  gridHeight: number
): string {
  const maxSize = 200; // Max dimension for preview
  const cellSize = Math.max(1, Math.min(
    Math.floor(maxSize / gridWidth),
    Math.floor(maxSize / gridHeight)
  ));

  const width = gridWidth * cellSize;
  const height = gridHeight * cellSize;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Fill background
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  // Draw pixels
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y]?.[x];
      if (dmcNumber) {
        const color = getDmcColorByNumber(dmcNumber);
        if (color) {
          ctx.fillStyle = color.hex;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  return canvas.toDataURL("image/png", 0.8);
}

interface HeaderProps {
  onShowImageImport: () => void;
  onShowCanvasResize: () => void;
  onShowExport: () => void;
  onShowTextDialog: () => void;
  onShowShapeDialog: () => void;
  onShowDesignPreview: () => void;
}

export default function Header({
  onShowImageImport,
  onShowCanvasResize,
  onShowExport,
  onShowTextDialog,
  onShowShapeDialog,
  onShowDesignPreview,
}: HeaderProps) {
  const router = useRouter();

  const {
    designId,
    designName,
    folderId,
    isDraft,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    flattenLayers,
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

  const { showToast } = useToast();

  // Auto-save hook
  const { autoSaveStatus, lastSavedAt } = useAutoSave();

  const handleSave = useCallback(async () => {
    setSaving(true);

    try {
      // Flatten all layers for storage (save as single grid)
      const grid = flattenLayers();

      // Compress pixel data
      const pixelDataJson = JSON.stringify(grid);
      const compressed = pako.deflate(pixelDataJson);
      const base64 = btoa(String.fromCharCode(...compressed));

      // Generate preview image
      const previewImageUrl = generatePreviewImage(grid, gridWidth, gridHeight);

      const body = {
        name: designName,
        folderId,
        isDraft,
        widthInches,
        heightInches,
        meshCount,
        gridWidth,
        gridHeight,
        pixelData: base64,
        previewImageUrl,
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
        const errorText = await response.text();
        console.error("[Manual save] Server error:", {
          status: response.status,
          statusText: response.statusText,
          designId,
          designName,
          gridWidth,
          gridHeight,
          errorResponse: errorText,
        });

        // If unauthorized (401), trigger session expired modal
        if (response.status === 401) {
          triggerSessionExpired();
          throw new Error("Session expired - please sign in again");
        }

        throw new Error(`Failed to save: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!designId) {
        setDesignInfo({ designId: data.id });
        router.replace(`/design/${data.id}`);
      }

      markClean();
      setLastSavedAt(new Date());
    } catch (error) {
      console.error("[Manual save] Error:", error);
      // Don't show toast for session expired - the modal handles it
      if (error instanceof Error && !error.message.includes("Session expired")) {
        showToast("Failed to save. Please try again.", "error");
      }
    } finally {
      setSaving(false);
    }
  }, [
    designId,
    designName,
    folderId,
    isDraft,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    flattenLayers,
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
            title="Home"
          >
            <div className="w-8 h-8 bg-gradient-to-br from-rose-900 to-rose-800 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
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
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-xs md:text-sm hidden sm:block">
                {widthInches}&quot; × {heightInches}&quot; @ {meshCount} mesh
              </span>
              {/* Draft toggle */}
              <button
                onClick={() => setDesignInfo({ isDraft: !isDraft })}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  isDraft
                    ? "bg-slate-500 text-slate-200"
                    : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                }`}
                title={isDraft ? "Click to mark as complete" : "Click to mark as draft"}
              >
                {isDraft ? "DRAFT" : "Complete"}
              </button>
            </div>
          </div>
        </div>

        {/* Right side - Actions */}
        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          {/* Show icons on mobile, text on desktop */}
          {designId && (
            <Link
              href={`/design/${designId}/kit`}
              className="p-2 md:px-3 md:py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm touch-manipulation flex items-center"
              title="Kit"
            >
              <span className="md:hidden">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </span>
              <span className="hidden md:inline">Kit</span>
            </Link>
          )}
          <button
            onClick={onShowTextDialog}
            className="p-2 md:px-3 md:py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm touch-manipulation"
            title="Add Text"
          >
            <span className="md:hidden">Aa</span>
            <span className="hidden md:inline">Text</span>
          </button>
          <button
            onClick={onShowShapeDialog}
            className="p-2 md:px-3 md:py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm touch-manipulation"
            title="Add Shape"
          >
            <span className="md:hidden">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </span>
            <span className="hidden md:inline">Shapes</span>
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
          <button
            onClick={onShowDesignPreview}
            className="p-2 md:px-3 md:py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm touch-manipulation"
            title="Preview Design"
          >
            <span className="md:hidden">👁️</span>
            <span className="hidden md:inline">Preview</span>
          </button>

          {/* Offline status indicator */}
          <div className="hidden sm:block">
            <OfflineStatusIndicator showText={false} className="px-2" />
          </div>

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

          <ThemeToggle />
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

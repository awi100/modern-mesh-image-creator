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
    <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
      {/* Left side - Logo and name */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2 text-slate-400 hover:text-white"
        >
          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
        </button>

        {/* Design name */}
        {editingName ? (
          <input
            type="text"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
            className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            autoFocus
          />
        ) : (
          <button
            onClick={() => {
              setTempName(designName);
              setEditingName(true);
            }}
            className="text-white font-medium hover:text-purple-400 transition-colors flex items-center gap-1"
          >
            {designName}
            {isDirty && <span className="text-purple-400">•</span>}
          </button>
        )}

        <span className="text-slate-500 text-sm">
          {widthInches}&quot; × {heightInches}&quot; @ {meshCount} mesh
        </span>
      </div>

      {/* Right side - Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onShowImageImport}
          className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
        >
          Import Image
        </button>
        <button
          onClick={onShowCanvasResize}
          className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
        >
          Resize
        </button>
        <button
          onClick={onShowExport}
          className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
        >
          Export
        </button>

        <div className="w-px h-6 bg-slate-600 mx-2" />

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </header>
  );
}

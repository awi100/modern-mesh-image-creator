"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/lib/store";

// Built-in preset canvas sizes for common needlepoint projects
const BUILTIN_PRESETS = [
  { name: "Coaster", width: 4, height: 4, description: "Perfect for drink coasters" },
  { name: "Small Ornament", width: 5, height: 5, description: "Mini ornaments & keychains" },
  { name: "Ornament", width: 6, height: 6, description: "Standard tree ornaments" },
  { name: "Square (8\")", width: 8, height: 8, description: "Small pillows & decor" },
  { name: "Square (10\")", width: 10, height: 10, description: "Medium projects" },
  { name: "Pillow (12\")", width: 12, height: 12, description: "Standard throw pillow" },
  { name: "Pillow (14\")", width: 14, height: 14, description: "Large throw pillow" },
  { name: "Rectangle (9×12)", width: 9, height: 12, description: "Wall hangings" },
  { name: "Rectangle (12×16)", width: 12, height: 16, description: "Large wall art" },
  { name: "Belt (2×36)", width: 2, height: 36, description: "Needlepoint belts" },
];

interface CustomPreset {
  id: string;
  name: string;
  widthInches: number;
  heightInches: number;
  description: string | null;
}

interface NewDesignDialogProps {
  onClose: () => void;
}

export default function NewDesignDialog({ onClose }: NewDesignDialogProps) {
  const router = useRouter();
  const { setDesignInfo, initializeGrid, reset } = useEditorStore();

  const [widthInches, setWidthInches] = useState(8);
  const [heightInches, setHeightInches] = useState(8);
  const [meshCount, setMeshCount] = useState<14 | 18>(14);
  const [designName, setDesignName] = useState("Untitled Design");
  const [showCustom, setShowCustom] = useState(false);

  // Custom presets from database
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  // Fetch custom presets on mount
  useEffect(() => {
    fetch("/api/canvas-presets")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCustomPresets(data);
        }
      })
      .catch((err) => console.error("Failed to load presets:", err));
  }, []);

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) return;

    setSavingPreset(true);
    try {
      const response = await fetch("/api/canvas-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPresetName,
          widthInches,
          heightInches,
          description: `${widthInches}" × ${heightInches}"`,
        }),
      });

      if (response.ok) {
        const preset = await response.json();
        setCustomPresets([...customPresets, preset]);
        setNewPresetName("");
        setShowAddPreset(false);
      }
    } catch (error) {
      console.error("Failed to save preset:", error);
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/canvas-presets/${id}`, { method: "DELETE" });
      setCustomPresets(customPresets.filter((p) => p.id !== id));
    } catch (error) {
      console.error("Failed to delete preset:", error);
    }
  };

  const gridWidth = Math.round(widthInches * meshCount);
  const gridHeight = Math.round(heightInches * meshCount);

  const handleSelectPreset = (width: number, height: number) => {
    setWidthInches(width);
    setHeightInches(height);
    setShowCustom(false);
  };

  const handleCreate = () => {
    reset();
    setDesignInfo({
      designId: null,
      designName,
      widthInches,
      heightInches,
      meshCount,
    });
    initializeGrid(gridWidth, gridHeight);
    router.push("/design/new");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">New Design</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Design name */}
        <div className="mb-6">
          <label className="block text-sm text-slate-400 mb-2">Design Name</label>
          <input
            type="text"
            value={designName}
            onChange={(e) => setDesignName(e.target.value)}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-rose-800"
            placeholder="Enter design name..."
          />
        </div>

        {/* Preset sizes */}
        <div className="mb-6">
          <label className="block text-sm text-slate-400 mb-3">Choose a Size</label>
          <div className="grid grid-cols-2 gap-2">
            {BUILTIN_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => handleSelectPreset(preset.width, preset.height)}
                className={`p-3 text-left rounded-lg border transition-colors ${
                  widthInches === preset.width && heightInches === preset.height && !showCustom
                    ? "bg-rose-900/30 border-rose-800"
                    : "bg-slate-700 border-slate-600 hover:border-slate-500"
                }`}
              >
                <p className={`font-medium ${
                  widthInches === preset.width && heightInches === preset.height && !showCustom
                    ? "text-rose-300"
                    : "text-white"
                }`}>
                  {preset.name}
                </p>
                <p className="text-xs text-slate-400">{preset.width}" × {preset.height}"</p>
              </button>
            ))}
            <button
              onClick={() => setShowCustom(true)}
              className={`p-3 text-left rounded-lg border transition-colors ${
                showCustom
                  ? "bg-rose-900/30 border-rose-800"
                  : "bg-slate-700 border-slate-600 hover:border-slate-500"
              }`}
            >
              <p className={`font-medium ${showCustom ? "text-rose-300" : "text-white"}`}>
                Custom Size
              </p>
              <p className="text-xs text-slate-400">Enter dimensions</p>
            </button>
          </div>
        </div>

        {/* Custom saved presets */}
        {customPresets.length > 0 && (
          <div className="mb-6">
            <label className="block text-sm text-slate-400 mb-3">Your Saved Sizes</label>
            <div className="grid grid-cols-2 gap-2">
              {customPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset.widthInches, preset.heightInches)}
                  className={`p-3 text-left rounded-lg border transition-colors relative group ${
                    widthInches === preset.widthInches && heightInches === preset.heightInches && !showCustom
                      ? "bg-rose-900/30 border-rose-800"
                      : "bg-slate-700 border-slate-600 hover:border-slate-500"
                  }`}
                >
                  <p className={`font-medium ${
                    widthInches === preset.widthInches && heightInches === preset.heightInches && !showCustom
                      ? "text-rose-300"
                      : "text-white"
                  }`}>
                    {preset.name}
                  </p>
                  <p className="text-xs text-slate-400">{preset.widthInches}" × {preset.heightInches}"</p>
                  <button
                    onClick={(e) => handleDeletePreset(preset.id, e)}
                    className="absolute top-1 right-1 p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete preset"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom size inputs */}
        {showCustom && (
          <div className="mb-6 p-4 bg-slate-700/50 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Width (inches)</label>
                <input
                  type="number"
                  min="1"
                  max="36"
                  step="0.5"
                  value={widthInches}
                  onChange={(e) => setWidthInches(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Height (inches)</label>
                <input
                  type="number"
                  min="1"
                  max="36"
                  step="0.5"
                  value={heightInches}
                  onChange={(e) => setHeightInches(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                />
              </div>
            </div>

            {/* Save as preset */}
            {!showAddPreset ? (
              <button
                onClick={() => setShowAddPreset(true)}
                className="text-sm text-rose-400 hover:text-rose-300 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Save as preset
              </button>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Preset name (e.g., Medium Size)"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                  autoFocus
                />
                <button
                  onClick={handleSavePreset}
                  disabled={!newPresetName.trim() || savingPreset}
                  className="px-3 py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 text-sm"
                >
                  {savingPreset ? "..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setShowAddPreset(false);
                    setNewPresetName("");
                  }}
                  className="px-3 py-2 bg-slate-600 text-slate-300 rounded-lg hover:bg-slate-500 text-sm"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Mesh count */}
        <div className="mb-6">
          <label className="block text-sm text-slate-400 mb-2">Mesh Count</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMeshCount(14)}
              className={`p-3 rounded-lg border transition-colors ${
                meshCount === 14
                  ? "bg-rose-900/30 border-rose-800 text-rose-300"
                  : "bg-slate-700 border-slate-600 text-white hover:border-slate-500"
              }`}
            >
              <p className="font-medium">14 Mesh</p>
              <p className="text-xs text-slate-400">Larger stitches</p>
            </button>
            <button
              onClick={() => setMeshCount(18)}
              className={`p-3 rounded-lg border transition-colors ${
                meshCount === 18
                  ? "bg-rose-900/30 border-rose-800 text-rose-300"
                  : "bg-slate-700 border-slate-600 text-white hover:border-slate-500"
              }`}
            >
              <p className="font-medium">18 Mesh</p>
              <p className="text-xs text-slate-400">More detail</p>
            </button>
          </div>
        </div>

        {/* Preview info */}
        <div className="mb-6 p-3 bg-rose-900/20 border border-rose-800/30 rounded-lg">
          <p className="text-sm text-rose-300">
            Canvas: <span className="text-white font-medium">{widthInches}" × {heightInches}"</span> at {meshCount} mesh
          </p>
          <p className="text-sm text-rose-300">
            Grid: <span className="text-white font-medium">{gridWidth} × {gridHeight}</span> stitches
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="flex-1 py-2.5 px-4 bg-rose-900 text-white rounded-lg hover:bg-rose-950 font-medium"
          >
            Create Design
          </button>
        </div>
      </div>
    </div>
  );
}

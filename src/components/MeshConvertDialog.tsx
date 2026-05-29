"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface MeshConvertDialogProps {
  designId: string;
  designName: string;
  currentMeshCount: number;
  widthInches: number;
  heightInches: number;
  open: boolean;
  onClose: () => void;
  onSuccess?: (newDesignId: string) => void;
}

const MESH_OPTIONS = [13, 14, 18] as const;

export default function MeshConvertDialog({
  designId,
  designName,
  currentMeshCount,
  widthInches,
  heightInches,
  open,
  onClose,
  onSuccess,
}: MeshConvertDialogProps) {
  const router = useRouter();
  const availableOptions = MESH_OPTIONS.filter((m) => m !== currentMeshCount);
  const [targetMeshCount, setTargetMeshCount] = useState<number>(availableOptions[0]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openAfterConvert, setOpenAfterConvert] = useState(true);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      const options = MESH_OPTIONS.filter((m) => m !== currentMeshCount);
      setTargetMeshCount(options[0]);
      setName("");
      setLoading(false);
      setError(null);
      setOpenAfterConvert(true);
    }
  }, [open, currentMeshCount]);

  if (!open) return null;

  const defaultName = `${designName} (${targetMeshCount}ct)`;

  const currentGridW = Math.round(widthInches * currentMeshCount);
  const currentGridH = Math.round(heightInches * currentMeshCount);
  const targetGridW = Math.round(widthInches * targetMeshCount);
  const targetGridH = Math.round(heightInches * targetMeshCount);

  const handleConvert = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/designs/${designId}/mesh-variant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetMeshCount,
          name: name.trim() || defaultName,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to convert design");
      }

      const data = await response.json();
      onSuccess?.(data.id);
      onClose();

      if (openAfterConvert) {
        router.push(`/design/${data.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            Convert Mesh Count
          </h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Current mesh count */}
        <div className="mb-6">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Current mesh count:{" "}
            <span className="text-slate-900 dark:text-white font-medium">
              {currentMeshCount} count
            </span>
          </p>
        </div>

        {/* Target mesh count */}
        <div className="mb-6">
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">
            Target Mesh Count
          </label>
          <div className="flex gap-2">
            {availableOptions.map((m) => (
              <button
                key={m}
                onClick={() => setTargetMeshCount(m)}
                disabled={loading}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  targetMeshCount === m
                    ? "bg-rose-900 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600"
                }`}
              >
                {m} count
              </button>
            ))}
          </div>
        </div>

        {/* Dimension preview */}
        <div className="mb-6 p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">{currentMeshCount}ct</span>{" "}
            {currentGridW}×{currentGridH}{" "}
            <span className="text-slate-400 mx-1">→</span>{" "}
            <span className="font-medium">{targetMeshCount}ct</span>{" "}
            {targetGridW}×{targetGridH}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            Same {widthInches}&quot; × {heightInches}&quot; canvas
          </p>
        </div>

        {/* Name override */}
        <div className="mb-6">
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">
            Design Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
            disabled={loading}
            className="w-full px-4 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 disabled:opacity-50"
          />
        </div>

        {/* Open in editor checkbox */}
        <label className="mb-6 flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={openAfterConvert}
            onChange={(e) => setOpenAfterConvert(e.target.checked)}
            disabled={loading}
            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-rose-900 focus:ring-rose-800"
          />
          <span className="text-sm text-slate-600 dark:text-slate-300">
            Open in editor after conversion
          </span>
        </label>

        {/* Preview info */}
        <div className="mb-6 p-3 bg-rose-900/20 border border-rose-800/30 rounded-lg">
          <p className="text-sm text-rose-300">
            This will create a new {targetMeshCount}-count design using
            nearest-neighbor resampling. You may need to adjust the result.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-800/30 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 px-4 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConvert}
            disabled={loading}
            className="flex-1 py-2.5 px-4 bg-rose-900 text-white rounded-lg hover:bg-rose-950 font-medium disabled:opacity-50"
          >
            {loading ? "Converting..." : "Convert"}
          </button>
        </div>
      </div>
    </div>
  );
}

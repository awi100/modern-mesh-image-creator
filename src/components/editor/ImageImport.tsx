"use client";

import React, { useState, useRef, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import { processImageToGrid } from "@/lib/color-utils";

interface ImageImportProps {
  onClose: () => void;
}

export default function ImageImport({ onClose }: ImageImportProps) {
  const { gridWidth, gridHeight, initializeGrid, saveToHistory } = useEditorStore();

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [maxColors, setMaxColors] = useState(16);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImageUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleImport = useCallback(async () => {
    if (!imageUrl) return;

    setProcessing(true);

    try {
      const img = new Image();
      img.src = imageUrl;

      await new Promise((resolve) => {
        img.onload = resolve;
      });

      // Create canvas and get image data
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Could not get canvas context");
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);

      // Process image to pixel grid
      const { grid, usedColors } = processImageToGrid(
        imageData,
        gridWidth,
        gridHeight,
        maxColors
      );

      // Save to history and update grid
      saveToHistory();
      initializeGrid(gridWidth, gridHeight, grid);

      onClose();
    } catch (error) {
      console.error("Error importing image:", error);
      alert("Failed to import image. Please try again.");
    } finally {
      setProcessing(false);
    }
  }, [imageUrl, gridWidth, gridHeight, maxColors, saveToHistory, initializeGrid, onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Import Image</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* File input */}
        <div className="mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-3 px-4 bg-slate-700 border-2 border-dashed border-slate-500 rounded-lg text-slate-300 hover:border-purple-500 hover:text-white transition-colors"
          >
            {imageUrl ? "Change Image" : "Select Image"}
          </button>
        </div>

        {/* Preview */}
        {imageUrl && (
          <div className="mb-4">
            <img
              src={imageUrl}
              alt="Preview"
              className="w-full h-48 object-contain bg-slate-900 rounded-lg"
            />
          </div>
        )}

        {/* Max colors slider */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2">
            Maximum Colors: {maxColors}
          </label>
          <input
            type="range"
            min="2"
            max="64"
            value={maxColors}
            onChange={(e) => setMaxColors(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-slate-500 mt-1">
            Fewer colors = simpler design, more colors = more detail
          </p>
        </div>

        {/* Target size info */}
        <div className="mb-4 p-3 bg-slate-700 rounded-lg">
          <p className="text-sm text-slate-300">
            Output size: <span className="text-white font-medium">{gridWidth} × {gridHeight}</span> stitches
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!imageUrl || processing}
            className="flex-1 py-2 px-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? "Processing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

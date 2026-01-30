"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useEditorStore } from "@/lib/store";
import { processImageToGrid, PixelGrid } from "@/lib/color-utils";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

interface ImageImportProps {
  onClose: () => void;
}

export default function ImageImport({ onClose }: ImageImportProps) {
  const { gridWidth, gridHeight, initializeGrid, saveToHistory } = useEditorStore();

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [maxColors, setMaxColors] = useState(16);
  const [processing, setProcessing] = useState(false);
  const [previewGrid, setPreviewGrid] = useState<PixelGrid | null>(null);
  const [previewColors, setPreviewColors] = useState<number>(0);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load image and extract ImageData
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      setImageUrl(url);

      // Load image and extract ImageData for preview
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          setImageData(ctx.getImageData(0, 0, img.width, img.height));
        }
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  // Debounced preview generation
  useEffect(() => {
    if (!imageData) {
      setPreviewGrid(null);
      return;
    }

    // Clear existing timeout
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }

    setIsGeneratingPreview(true);

    // Debounce preview generation
    previewTimeoutRef.current = setTimeout(() => {
      const { grid, usedColors } = processImageToGrid(
        imageData,
        gridWidth,
        gridHeight,
        maxColors
      );
      setPreviewGrid(grid);
      setPreviewColors(usedColors.length);
      setIsGeneratingPreview(false);
    }, 150);

    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [imageData, maxColors, gridWidth, gridHeight]);

  // Render preview to canvas
  useEffect(() => {
    if (!previewGrid || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const maxPreviewSize = 300;
    const aspectRatio = gridWidth / gridHeight;
    let canvasWidth = maxPreviewSize;
    let canvasHeight = maxPreviewSize;

    if (aspectRatio > 1) {
      canvasHeight = maxPreviewSize / aspectRatio;
    } else {
      canvasWidth = maxPreviewSize * aspectRatio;
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const cellWidth = canvasWidth / gridWidth;
    const cellHeight = canvasHeight / gridHeight;

    // Clear canvas
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw pixels
    for (let y = 0; y < previewGrid.length; y++) {
      for (let x = 0; x < previewGrid[y].length; x++) {
        const dmcNumber = previewGrid[y][x];
        if (dmcNumber) {
          const color = getDmcColorByNumber(dmcNumber);
          if (color) {
            ctx.fillStyle = color.hex;
            ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
          }
        }
      }
    }
  }, [previewGrid, gridWidth, gridHeight]);

  const handleImport = useCallback(async () => {
    if (!imageData) return;

    setProcessing(true);

    try {
      // Use the preview grid if available, otherwise recompute
      let grid: PixelGrid;
      if (previewGrid) {
        grid = previewGrid;
      } else {
        const result = processImageToGrid(imageData, gridWidth, gridHeight, maxColors);
        grid = result.grid;
      }

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
  }, [imageData, previewGrid, gridWidth, gridHeight, maxColors, saveToHistory, initializeGrid, onClose]);

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
            className="w-full py-3 px-4 bg-slate-700 border-2 border-dashed border-slate-500 rounded-lg text-slate-300 hover:border-rose-800 hover:text-white transition-colors"
          >
            {imageUrl ? "Change Image" : "Select Image"}
          </button>
        </div>

        {/* Preview - show original and processed side by side */}
        {imageUrl && (
          <div className="mb-4">
            <div className="flex gap-3">
              {/* Original image */}
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1 text-center">Original</p>
                <img
                  src={imageUrl}
                  alt="Original"
                  className="w-full h-36 object-contain bg-slate-900 rounded-lg"
                />
              </div>
              {/* Processed preview */}
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1 text-center">
                  Preview {isGeneratingPreview ? "(updating...)" : `(${previewColors} colors)`}
                </p>
                <div className="w-full h-36 bg-slate-900 rounded-lg flex items-center justify-center overflow-hidden">
                  <canvas
                    ref={previewCanvasRef}
                    className="max-w-full max-h-full object-contain"
                    style={{ imageRendering: "pixelated" }}
                  />
                </div>
              </div>
            </div>
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
            disabled={!imageData || processing || isGeneratingPreview}
            className="flex-1 py-2 px-4 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? "Importing..." : isGeneratingPreview ? "Generating preview..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

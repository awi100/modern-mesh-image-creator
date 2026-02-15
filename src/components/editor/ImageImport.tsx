"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useEditorStore } from "@/lib/store";
import { processImageToGrid, PixelGrid, getUsedColors } from "@/lib/color-utils";
import { getDmcColorByNumber, searchDmcColors, DMC_PEARL_COTTON, DmcColor } from "@/lib/dmc-pearl-cotton";
import { useToast } from "@/components/Toast";

interface ImageImportProps {
  onClose: () => void;
}

interface DetectedColor {
  dmcNumber: string;
  pixelCount: number;
}

export default function ImageImport({ onClose }: ImageImportProps) {
  const { gridWidth, gridHeight, initializeGrid, saveToHistory, layers, activeLayerIndex } = useEditorStore();
  const { showToast } = useToast();

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [maxColors, setMaxColors] = useState(16);
  const [processing, setProcessing] = useState(false);
  const [previewGrid, setPreviewGrid] = useState<PixelGrid | null>(null);
  const [previewColors, setPreviewColors] = useState<DetectedColor[]>([]);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [treatWhiteAsEmpty, setTreatWhiteAsEmpty] = useState(true);
  const [useExistingPalette, setUseExistingPalette] = useState(false);
  const [colorMappings, setColorMappings] = useState<Map<string, string>>(new Map());
  const [editingColor, setEditingColor] = useState<string | null>(null);
  const [colorSearchQuery, setColorSearchQuery] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get existing colors from current design (all layers combined)
  const existingPalette = useMemo(() => {
    const allColors = new Set<string>();
    for (const layer of layers) {
      const usedDmcNumbers = getUsedColors(layer.grid);
      for (const num of usedDmcNumbers) {
        allColors.add(num);
      }
    }
    return Array.from(allColors)
      .map(num => getDmcColorByNumber(num))
      .filter((c): c is DmcColor => c !== null);
  }, [layers]);

  // File validation constants
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  // Load image and extract ImageData
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast("Please select a valid image file (JPEG, PNG, GIF, or WebP)", "error");
      e.target.value = "";
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      showToast(`File is too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`, "error");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      setImageUrl(url);
      setColorMappings(new Map()); // Reset mappings on new image

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
      setPreviewColors([]);
      return;
    }

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }

    setIsGeneratingPreview(true);

    previewTimeoutRef.current = setTimeout(() => {
      // Determine which DMC subset to use
      const dmcSubset = useExistingPalette && existingPalette.length > 0
        ? existingPalette
        : undefined;

      const { grid, usedColors } = processImageToGrid(
        imageData,
        gridWidth,
        gridHeight,
        maxColors,
        dmcSubset,
        treatWhiteAsEmpty
      );

      // Count pixels per color
      const colorCounts = new Map<string, number>();
      for (const row of grid) {
        for (const cell of row) {
          if (cell) {
            colorCounts.set(cell, (colorCounts.get(cell) || 0) + 1);
          }
        }
      }

      const detectedColors: DetectedColor[] = usedColors
        .map(c => ({
          dmcNumber: c.dmcNumber,
          pixelCount: colorCounts.get(c.dmcNumber) || 0,
        }))
        .sort((a, b) => b.pixelCount - a.pixelCount);

      setPreviewGrid(grid);
      setPreviewColors(detectedColors);
      setIsGeneratingPreview(false);
    }, 150);

    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [imageData, maxColors, gridWidth, gridHeight, treatWhiteAsEmpty, useExistingPalette, existingPalette]);

  // Apply color mappings to grid for display
  const displayGrid = useMemo(() => {
    if (!previewGrid || colorMappings.size === 0) return previewGrid;

    return previewGrid.map(row =>
      row.map(cell => {
        if (cell && colorMappings.has(cell)) {
          return colorMappings.get(cell)!;
        }
        return cell;
      })
    );
  }, [previewGrid, colorMappings]);

  // Render preview to canvas
  useEffect(() => {
    if (!displayGrid || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (let y = 0; y < displayGrid.length; y++) {
      for (let x = 0; x < displayGrid[y].length; x++) {
        const dmcNumber = displayGrid[y][x];
        if (dmcNumber) {
          const color = getDmcColorByNumber(dmcNumber);
          if (color) {
            ctx.fillStyle = color.hex;
            ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
          }
        }
      }
    }
  }, [displayGrid, gridWidth, gridHeight]);

  // Handle color mapping
  const handleColorMap = useCallback((from: string, to: string) => {
    setColorMappings(prev => {
      const next = new Map(prev);
      if (from === to) {
        next.delete(from);
      } else {
        next.set(from, to);
      }
      return next;
    });
    setEditingColor(null);
    setColorSearchQuery("");
  }, []);

  const handleClearMapping = useCallback((dmcNumber: string) => {
    setColorMappings(prev => {
      const next = new Map(prev);
      next.delete(dmcNumber);
      return next;
    });
  }, []);

  // Filter colors for the picker
  const filteredColors = useMemo(() => {
    if (!colorSearchQuery.trim()) {
      return DMC_PEARL_COTTON.slice(0, 100);
    }
    return searchDmcColors(colorSearchQuery).slice(0, 100);
  }, [colorSearchQuery]);

  // Get contrast color for text
  const getContrastColor = (hex: string): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#FFFFFF";
  };

  // Get the final color (with mapping applied)
  const getFinalColor = (dmcNumber: string): string => {
    return colorMappings.get(dmcNumber) || dmcNumber;
  };

  const handleImport = useCallback(async () => {
    if (!imageData || !previewGrid) return;

    setProcessing(true);

    try {
      // Apply color mappings to the grid
      let finalGrid = previewGrid;
      if (colorMappings.size > 0) {
        finalGrid = previewGrid.map(row =>
          row.map(cell => {
            if (cell && colorMappings.has(cell)) {
              return colorMappings.get(cell)!;
            }
            return cell;
          })
        );
      }

      saveToHistory();
      initializeGrid(gridWidth, gridHeight, finalGrid);
      onClose();
    } catch (error) {
      console.error("Error importing image:", error);
      showToast("Failed to import image. Please try again.", "error");
    } finally {
      setProcessing(false);
    }
  }, [imageData, previewGrid, colorMappings, gridWidth, gridHeight, saveToHistory, initializeGrid, onClose, showToast]);

  const mappedCount = colorMappings.size;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Import Image</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
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
              className="w-full py-3 px-4 bg-slate-100 dark:bg-slate-700 border-2 border-dashed border-slate-300 dark:border-slate-500 rounded-lg text-slate-600 dark:text-slate-300 hover:border-rose-800 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              {imageUrl ? "Change Image" : "Select Image"}
            </button>
          </div>

          {/* Preview - show original and processed side by side */}
          {imageUrl && (
            <div className="mb-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 text-center">Original</p>
                  <img
                    src={imageUrl}
                    alt="Original image to import"
                    className="w-full h-36 object-contain bg-slate-200 dark:bg-slate-900 rounded-lg"
                  />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 text-center">
                    Preview {isGeneratingPreview ? "(updating...)" : `(${previewColors.length} colors)`}
                  </p>
                  <div className="w-full h-36 bg-slate-200 dark:bg-slate-900 rounded-lg flex items-center justify-center overflow-hidden">
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

          {/* Settings */}
          <div className="space-y-4 mb-4">
            {/* Max colors slider */}
            <div>
              <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">
                Maximum Colors: {maxColors}
              </label>
              <input
                type="range"
                min="2"
                max="64"
                value={maxColors}
                onChange={(e) => {
                  setMaxColors(Number(e.target.value));
                  setColorMappings(new Map()); // Reset mappings when changing color count
                }}
                className="w-full"
              />
              <p className="text-xs text-slate-500 mt-1">
                Fewer colors = simpler design, more colors = more detail
              </p>
            </div>

            {/* Checkboxes */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={treatWhiteAsEmpty}
                  onChange={(e) => setTreatWhiteAsEmpty(e.target.checked)}
                  className="w-4 h-4 text-rose-900 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-rose-800"
                />
                <span className="text-slate-600 dark:text-slate-300 text-sm">Treat white/light backgrounds as empty</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useExistingPalette}
                  onChange={(e) => {
                    setUseExistingPalette(e.target.checked);
                    setColorMappings(new Map());
                  }}
                  disabled={existingPalette.length === 0}
                  className="w-4 h-4 text-rose-900 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-rose-800 disabled:opacity-50"
                />
                <span className={`text-sm ${existingPalette.length === 0 ? "text-slate-500" : "text-slate-600 dark:text-slate-300"}`}>
                  Use only colors from existing design ({existingPalette.length} colors)
                </span>
              </label>
            </div>

            {/* Output size info */}
            <div className="p-3 bg-slate-100 dark:bg-slate-700 rounded-lg">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Output size: <span className="text-slate-900 dark:text-white font-medium">{gridWidth} × {gridHeight}</span> stitches
              </p>
            </div>
          </div>

          {/* Detected Colors with mapping */}
          {previewColors.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-slate-500 dark:text-slate-400">
                  Detected Colors {mappedCount > 0 && `(${mappedCount} remapped)`}
                </label>
                {mappedCount > 0 && (
                  <button
                    onClick={() => setColorMappings(new Map())}
                    className="text-xs text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    Reset all
                  </button>
                )}
              </div>
              <div className="bg-slate-100 dark:bg-slate-700/50 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                {previewColors.map((detected) => {
                  const originalColor = getDmcColorByNumber(detected.dmcNumber);
                  const mappedTo = colorMappings.get(detected.dmcNumber);
                  const finalColor = mappedTo ? getDmcColorByNumber(mappedTo) : originalColor;
                  const isEditing = editingColor === detected.dmcNumber;

                  if (!originalColor) return null;

                  return (
                    <div key={detected.dmcNumber} className="relative">
                      <div className="flex items-center gap-2">
                        {/* Original color swatch */}
                        <div
                          className="w-8 h-8 rounded border border-slate-500 flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                          style={{
                            backgroundColor: originalColor.hex,
                            color: getContrastColor(originalColor.hex),
                          }}
                          title={`${originalColor.dmcNumber} - ${originalColor.name}`}
                        >
                          {originalColor.dmcNumber}
                        </div>

                        {/* Arrow if mapped */}
                        {mappedTo && (
                          <>
                            <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                            <div
                              className="w-8 h-8 rounded border-2 border-emerald-500 flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                              style={{
                                backgroundColor: finalColor?.hex || "#888",
                                color: finalColor ? getContrastColor(finalColor.hex) : "#fff",
                              }}
                              title={`${finalColor?.dmcNumber} - ${finalColor?.name}`}
                            >
                              {mappedTo}
                            </div>
                          </>
                        )}

                        {/* Color name and pixel count */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-900 dark:text-white truncate">
                            {mappedTo ? finalColor?.name : originalColor.name}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            {detected.pixelCount} stitches
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          {mappedTo && (
                            <button
                              onClick={() => handleClearMapping(detected.dmcNumber)}
                              className="p-1 text-slate-500 dark:text-slate-400 hover:text-red-400"
                              title="Clear mapping"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingColor(isEditing ? null : detected.dmcNumber);
                              setColorSearchQuery("");
                            }}
                            className={`px-2 py-1 text-xs rounded transition-colors ${
                              isEditing
                                ? "bg-rose-900 text-white"
                                : "bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-500"
                            }`}
                          >
                            {isEditing ? "Cancel" : "Swap"}
                          </button>
                        </div>
                      </div>

                      {/* Color picker dropdown */}
                      {isEditing && (
                        <div className="mt-2 p-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-300 dark:border-slate-600">
                          <input
                            type="text"
                            value={colorSearchQuery}
                            onChange={(e) => setColorSearchQuery(e.target.value)}
                            placeholder="Search by name or DMC #..."
                            className="w-full px-2 py-1.5 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-rose-800 mb-2"
                            autoFocus
                          />
                          <div className="grid grid-cols-10 gap-1 max-h-32 overflow-y-auto">
                            {filteredColors.map((c) => (
                              <button
                                key={c.dmcNumber}
                                onClick={() => handleColorMap(detected.dmcNumber, c.dmcNumber)}
                                className={`w-6 h-6 rounded text-[8px] font-bold border transition-transform hover:scale-110 ${
                                  c.dmcNumber === detected.dmcNumber
                                    ? "border-slate-400 opacity-50"
                                    : "border-slate-300 dark:border-slate-600 hover:border-slate-900 dark:hover:border-white"
                                }`}
                                style={{
                                  backgroundColor: c.hex,
                                  color: getContrastColor(c.hex),
                                }}
                                title={`${c.dmcNumber} - ${c.name}`}
                                disabled={c.dmcNumber === detected.dmcNumber}
                              >
                                {c.dmcNumber}
                              </button>
                            ))}
                          </div>
                          {filteredColors.length === 100 && (
                            <p className="text-[10px] text-slate-500 mt-1 text-center">
                              Type to search more colors
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!imageData || processing || isGeneratingPreview}
            className="flex-1 py-2 px-4 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? "Importing..." : isGeneratingPreview ? "Generating..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

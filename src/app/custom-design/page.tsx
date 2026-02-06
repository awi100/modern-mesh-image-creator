"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import pako from "pako";
import { processImageToGrid, PixelGrid, ProcessingOptions } from "@/lib/color-utils";
import { getDmcColorByNumber, searchDmcColors, DMC_PEARL_COTTON } from "@/lib/dmc-pearl-cotton";

// Canvas size presets
const CANVAS_PRESETS = [
  { name: "Small (4×4\")", width: 56, height: 56, inches: "4×4" },
  { name: "Medium (6×6\")", width: 84, height: 84, inches: "6×6" },
  { name: "Large (8×8\")", width: 112, height: 112, inches: "8×8" },
  { name: "Wide (8×6\")", width: 112, height: 84, inches: "8×6" },
  { name: "Tall (6×8\")", width: 84, height: 112, inches: "6×8" },
  { name: "Square (10×10\")", width: 140, height: 140, inches: "10×10" },
];

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetectedColor {
  dmcNumber: string;
  pixelCount: number;
}

type Step = "upload" | "prepare" | "settings" | "preview" | "create";

export default function CustomDesignPage() {
  const router = useRouter();

  // Step state
  const [currentStep, setCurrentStep] = useState<Step>("upload");

  // Image state
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [processedImageData, setProcessedImageData] = useState<ImageData | null>(null);

  // Crop state
  const [cropRegion, setCropRegion] = useState<CropRegion>({ x: 0, y: 0, width: 1, height: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<"move" | "resize" | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  // Background removal state
  const [removeBackground, setRemoveBackground] = useState(false);
  const [bgColor, setBgColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [bgTolerance, setBgTolerance] = useState(30);
  const [isPickingBgColor, setIsPickingBgColor] = useState(false);

  // Canvas settings state
  const [selectedPreset, setSelectedPreset] = useState(1); // Medium
  const [customWidth, setCustomWidth] = useState(84);
  const [customHeight, setCustomHeight] = useState(84);
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [meshCount, setMeshCount] = useState<14 | 18>(14);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);

  // Preview state
  const [maxColors, setMaxColors] = useState(16);
  const [previewGrid, setPreviewGrid] = useState<PixelGrid | null>(null);
  const [previewColors, setPreviewColors] = useState<DetectedColor[]>([]);
  const [colorMappings, setColorMappings] = useState<Map<string, string>>(new Map());
  const [editingColor, setEditingColor] = useState<string | null>(null);
  const [colorSearchQuery, setColorSearchQuery] = useState("");
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Advanced settings state
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [dithering, setDithering] = useState<'none' | 'floydSteinberg'>('none');
  const [ditheringStrength, setDitheringStrength] = useState(50);
  const [contrastEnhance, setContrastEnhance] = useState(0);
  const [sharpen, setSharpen] = useState(0);

  // Quality presets
  const applyPreset = useCallback((preset: 'photo' | 'graphic' | 'detailed') => {
    switch (preset) {
      case 'photo':
        setDithering('floydSteinberg');
        setDitheringStrength(60);
        setContrastEnhance(20);
        setSharpen(30);
        break;
      case 'graphic':
        setDithering('none');
        setDitheringStrength(0);
        setContrastEnhance(40);
        setSharpen(0);
        break;
      case 'detailed':
        setDithering('floydSteinberg');
        setDitheringStrength(40);
        setContrastEnhance(30);
        setSharpen(50);
        break;
    }
  }, []);

  // Create state
  const [designName, setDesignName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Get canvas dimensions
  const canvasWidth = useCustomSize ? customWidth : CANVAS_PRESETS[selectedPreset].width;
  const canvasHeight = useCustomSize ? customHeight : CANVAS_PRESETS[selectedPreset].height;

  // Handle file upload
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      setImageUrl(url);

      const img = new Image();
      img.onload = () => {
        setOriginalImage(img);
        setCropRegion({ x: 0, y: 0, width: 1, height: 1 });
        setBgColor(null);
        setCurrentStep("prepare");
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  // Handle drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      setImageUrl(url);

      const img = new Image();
      img.onload = () => {
        setOriginalImage(img);
        setCropRegion({ x: 0, y: 0, width: 1, height: 1 });
        setBgColor(null);
        setCurrentStep("prepare");
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  // Crop interaction handlers
  const handleCropMouseDown = useCallback((e: React.MouseEvent, type: "move" | "resize", handle?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragType(type);
    setDragStart({ x: e.clientX, y: e.clientY });
    if (handle) setResizeHandle(handle);
  }, []);

  const handleCropMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !cropContainerRef.current) return;

    const rect = cropContainerRef.current.getBoundingClientRect();
    const deltaX = (e.clientX - dragStart.x) / rect.width;
    const deltaY = (e.clientY - dragStart.y) / rect.height;

    setCropRegion(prev => {
      const newRegion = { ...prev };

      if (dragType === "move") {
        newRegion.x = Math.max(0, Math.min(1 - prev.width, prev.x + deltaX));
        newRegion.y = Math.max(0, Math.min(1 - prev.height, prev.y + deltaY));
      } else if (dragType === "resize" && resizeHandle) {
        const aspectRatio = lockAspectRatio ? canvasWidth / canvasHeight : null;

        switch (resizeHandle) {
          case "se":
            newRegion.width = Math.max(0.1, Math.min(1 - prev.x, prev.width + deltaX));
            if (aspectRatio) {
              newRegion.height = newRegion.width / aspectRatio;
            } else {
              newRegion.height = Math.max(0.1, Math.min(1 - prev.y, prev.height + deltaY));
            }
            break;
          case "sw":
            const newWidth = Math.max(0.1, prev.width - deltaX);
            newRegion.x = prev.x + prev.width - newWidth;
            newRegion.width = newWidth;
            if (aspectRatio) {
              newRegion.height = newRegion.width / aspectRatio;
            } else {
              newRegion.height = Math.max(0.1, Math.min(1 - prev.y, prev.height + deltaY));
            }
            break;
          case "ne":
            newRegion.width = Math.max(0.1, Math.min(1 - prev.x, prev.width + deltaX));
            if (aspectRatio) {
              const newH = newRegion.width / aspectRatio;
              newRegion.y = prev.y + prev.height - newH;
              newRegion.height = newH;
            } else {
              const newH = Math.max(0.1, prev.height - deltaY);
              newRegion.y = prev.y + prev.height - newH;
              newRegion.height = newH;
            }
            break;
          case "nw":
            const nwWidth = Math.max(0.1, prev.width - deltaX);
            newRegion.x = prev.x + prev.width - nwWidth;
            newRegion.width = nwWidth;
            if (aspectRatio) {
              const newH = newRegion.width / aspectRatio;
              newRegion.y = prev.y + prev.height - newH;
              newRegion.height = newH;
            } else {
              const newH = Math.max(0.1, prev.height - deltaY);
              newRegion.y = prev.y + prev.height - newH;
              newRegion.height = newH;
            }
            break;
        }

        // Constrain to bounds
        newRegion.x = Math.max(0, newRegion.x);
        newRegion.y = Math.max(0, newRegion.y);
        newRegion.width = Math.min(1 - newRegion.x, newRegion.width);
        newRegion.height = Math.min(1 - newRegion.y, newRegion.height);
      }

      return newRegion;
    });

    setDragStart({ x: e.clientX, y: e.clientY });
  }, [isDragging, dragType, dragStart, resizeHandle, lockAspectRatio, canvasWidth, canvasHeight]);

  const handleCropMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragType(null);
    setResizeHandle(null);
  }, []);

  // Pick background color from image
  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPickingBgColor || !originalImage || !cropContainerRef.current) return;

    const rect = cropContainerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Get color from image at this position
    const canvas = document.createElement("canvas");
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(originalImage, 0, 0);
    const imgX = Math.floor(x * originalImage.width);
    const imgY = Math.floor(y * originalImage.height);
    const pixel = ctx.getImageData(imgX, imgY, 1, 1).data;

    setBgColor({ r: pixel[0], g: pixel[1], b: pixel[2] });
    setIsPickingBgColor(false);
    setRemoveBackground(true);
  }, [isPickingBgColor, originalImage]);

  // Process image with crop and background removal
  const processImage = useCallback(() => {
    if (!originalImage) return null;

    const canvas = document.createElement("canvas");
    const cropX = Math.floor(cropRegion.x * originalImage.width);
    const cropY = Math.floor(cropRegion.y * originalImage.height);
    const cropW = Math.floor(cropRegion.width * originalImage.width);
    const cropH = Math.floor(cropRegion.height * originalImage.height);

    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(originalImage, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Apply background removal if enabled
    if (removeBackground && bgColor) {
      const imageData = ctx.getImageData(0, 0, cropW, cropH);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const distance = Math.sqrt(
          Math.pow(r - bgColor.r, 2) +
          Math.pow(g - bgColor.g, 2) +
          Math.pow(b - bgColor.b, 2)
        );

        if (distance <= bgTolerance * 2.55) { // Scale tolerance to 0-255 range
          data[i + 3] = 0; // Make transparent
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }

    return ctx.getImageData(0, 0, cropW, cropH);
  }, [originalImage, cropRegion, removeBackground, bgColor, bgTolerance]);

  // Generate preview when settings change
  useEffect(() => {
    if (currentStep !== "preview" || !processedImageData) return;

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }

    setIsGeneratingPreview(true);

    previewTimeoutRef.current = setTimeout(() => {
      const processingOptions: ProcessingOptions = {
        maxColors,
        treatWhiteAsEmpty: true,
        whiteThreshold: 250,
        // New advanced options
        colorSpace: 'lab',
        kmeansInit: 'kmeans++',
        samplingMethod: 'weighted',
        dithering,
        ditheringStrength,
        contrastEnhance,
        sharpen,
      };

      const { grid, usedColors } = processImageToGrid(
        processedImageData,
        canvasWidth,
        canvasHeight,
        processingOptions
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
    }, 200);

    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [currentStep, processedImageData, canvasWidth, canvasHeight, maxColors, dithering, ditheringStrength, contrastEnhance, sharpen]);

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

    const maxPreviewSize = 400;
    const aspectRatio = canvasWidth / canvasHeight;
    let cvWidth = maxPreviewSize;
    let cvHeight = maxPreviewSize;

    if (aspectRatio > 1) {
      cvHeight = maxPreviewSize / aspectRatio;
    } else {
      cvWidth = maxPreviewSize * aspectRatio;
    }

    canvas.width = cvWidth;
    canvas.height = cvHeight;

    const cellWidth = cvWidth / canvasWidth;
    const cellHeight = cvHeight / canvasHeight;

    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, cvWidth, cvHeight);

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
  }, [displayGrid, canvasWidth, canvasHeight]);

  // Handle step transitions
  const goToSettings = useCallback(() => {
    const imageData = processImage();
    if (imageData) {
      setProcessedImageData(imageData);
      setCurrentStep("settings");
    }
  }, [processImage]);

  const goToPreview = useCallback(() => {
    setColorMappings(new Map());
    setCurrentStep("preview");
  }, []);

  // Color mapping handlers
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

  const filteredColors = useMemo(() => {
    if (!colorSearchQuery.trim()) {
      return DMC_PEARL_COTTON.slice(0, 100);
    }
    return searchDmcColors(colorSearchQuery).slice(0, 100);
  }, [colorSearchQuery]);

  const getContrastColor = (hex: string): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#FFFFFF";
  };

  // Create design
  const handleCreate = useCallback(async () => {
    if (!previewGrid || !designName.trim()) return;

    setIsCreating(true);
    setCreateError(null);

    try {
      // Apply color mappings to final grid
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

      // Compress the grid data
      const gridJson = JSON.stringify(finalGrid);
      const compressed = pako.deflate(gridJson);
      const base64Data = btoa(String.fromCharCode.apply(null, Array.from(compressed)));

      // Calculate dimensions in inches based on mesh count
      const widthInches = canvasWidth / meshCount;
      const heightInches = canvasHeight / meshCount;

      // Create the design via API
      const response = await fetch("/api/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: designName.trim(),
          widthInches,
          heightInches,
          gridWidth: canvasWidth,
          gridHeight: canvasHeight,
          meshCount,
          pixelData: base64Data,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create design");
      }

      const { id } = await response.json();
      router.push(`/design/${id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create design");
      setIsCreating(false);
    }
  }, [previewGrid, designName, colorMappings, canvasWidth, canvasHeight, meshCount, router]);

  // Step indicator
  const steps = [
    { key: "upload", label: "Upload" },
    { key: "prepare", label: "Prepare" },
    { key: "settings", label: "Settings" },
    { key: "preview", label: "Preview" },
    { key: "create", label: "Create" },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-slate-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold text-white">Custom Design from Photo</h1>
          </div>
        </div>
      </header>

      {/* Progress indicator */}
      <div className="bg-slate-800/50 border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            {steps.map((step, index) => (
              <React.Fragment key={step.key}>
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                    index === currentStepIndex
                      ? "bg-rose-900 text-white"
                      : index < currentStepIndex
                      ? "bg-emerald-900/50 text-emerald-300"
                      : "bg-slate-700 text-slate-400"
                  }`}
                >
                  <span className="w-5 h-5 flex items-center justify-center rounded-full bg-black/20 text-xs">
                    {index < currentStepIndex ? "✓" : index + 1}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 ${index < currentStepIndex ? "bg-emerald-800" : "bg-slate-700"}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Step 1: Upload */}
        {currentStep === "upload" && (
          <div className="max-w-xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Upload Customer Photo</h2>
              <p className="text-slate-400">Select an image to convert into a needlepoint design</p>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-slate-600 rounded-xl p-12 text-center hover:border-rose-800 transition-colors"
            >
              <svg className="w-16 h-16 mx-auto text-slate-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-slate-300 mb-4">Drag and drop an image here, or</p>
              <label className="inline-block px-6 py-3 bg-rose-900 text-white rounded-lg cursor-pointer hover:bg-rose-950 transition-colors">
                Select Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <p className="text-sm text-slate-500 mt-4">Supports JPG, PNG, GIF, WebP</p>
            </div>
          </div>
        )}

        {/* Step 2: Prepare Image */}
        {currentStep === "prepare" && originalImage && (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Image editor */}
            <div className="lg:col-span-2">
              <div className="bg-slate-800 rounded-xl p-4">
                <h3 className="text-lg font-medium text-white mb-4">Select Area to Use</h3>

                <div
                  ref={cropContainerRef}
                  className={`relative bg-slate-900 rounded-lg overflow-hidden select-none ${
                    isPickingBgColor ? "cursor-crosshair" : ""
                  }`}
                  style={{ maxHeight: "500px" }}
                  onMouseMove={handleCropMouseMove}
                  onMouseUp={handleCropMouseUp}
                  onMouseLeave={handleCropMouseUp}
                  onClick={handleImageClick}
                >
                  <img
                    src={imageUrl!}
                    alt="Original"
                    className="w-full h-auto"
                    style={{ maxHeight: "500px", objectFit: "contain" }}
                    draggable={false}
                  />

                  {/* Darkened overlay outside crop region */}
                  <div
                    className="absolute inset-0 bg-black/60 pointer-events-none"
                    style={{
                      clipPath: `polygon(
                        0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                        ${cropRegion.x * 100}% ${cropRegion.y * 100}%,
                        ${cropRegion.x * 100}% ${(cropRegion.y + cropRegion.height) * 100}%,
                        ${(cropRegion.x + cropRegion.width) * 100}% ${(cropRegion.y + cropRegion.height) * 100}%,
                        ${(cropRegion.x + cropRegion.width) * 100}% ${cropRegion.y * 100}%,
                        ${cropRegion.x * 100}% ${cropRegion.y * 100}%
                      )`,
                    }}
                  />

                  {/* Crop region */}
                  {!isPickingBgColor && (
                    <div
                      className="absolute border-2 border-white cursor-move"
                      style={{
                        left: `${cropRegion.x * 100}%`,
                        top: `${cropRegion.y * 100}%`,
                        width: `${cropRegion.width * 100}%`,
                        height: `${cropRegion.height * 100}%`,
                      }}
                      onMouseDown={(e) => handleCropMouseDown(e, "move")}
                    >
                      {/* Rule of thirds grid */}
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                        <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                        <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                        <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
                      </div>

                      {/* Resize handles */}
                      {["nw", "ne", "sw", "se"].map((handle) => (
                        <div
                          key={handle}
                          className="absolute w-4 h-4 bg-white rounded-full border-2 border-slate-800 cursor-nwse-resize"
                          style={{
                            top: handle.includes("n") ? "-8px" : "auto",
                            bottom: handle.includes("s") ? "-8px" : "auto",
                            left: handle.includes("w") ? "-8px" : "auto",
                            right: handle.includes("e") ? "-8px" : "auto",
                            cursor: handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize",
                          }}
                          onMouseDown={(e) => handleCropMouseDown(e, "resize", handle)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {isPickingBgColor && (
                  <div className="mt-3 p-3 bg-rose-900/30 border border-rose-800 rounded-lg text-center">
                    <p className="text-rose-300 text-sm">Click on the background color you want to remove</p>
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-4">
              {/* Crop controls */}
              <div className="bg-slate-800 rounded-xl p-4">
                <h3 className="text-lg font-medium text-white mb-4">Crop Options</h3>

                <label className="flex items-center gap-2 cursor-pointer mb-4">
                  <input
                    type="checkbox"
                    checked={lockAspectRatio}
                    onChange={(e) => setLockAspectRatio(e.target.checked)}
                    className="w-4 h-4 text-rose-900 bg-slate-700 border-slate-600 rounded"
                  />
                  <span className="text-slate-300 text-sm">Lock to canvas aspect ratio</span>
                </label>

                <button
                  onClick={() => setCropRegion({ x: 0, y: 0, width: 1, height: 1 })}
                  className="w-full px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
                >
                  Reset to Full Image
                </button>
              </div>

              {/* Background removal */}
              <div className="bg-slate-800 rounded-xl p-4">
                <h3 className="text-lg font-medium text-white mb-4">Background Removal</h3>

                <label className="flex items-center gap-2 cursor-pointer mb-4">
                  <input
                    type="checkbox"
                    checked={removeBackground}
                    onChange={(e) => setRemoveBackground(e.target.checked)}
                    className="w-4 h-4 text-rose-900 bg-slate-700 border-slate-600 rounded"
                  />
                  <span className="text-slate-300 text-sm">Remove background</span>
                </label>

                {removeBackground && (
                  <>
                    <div className="mb-4">
                      <button
                        onClick={() => setIsPickingBgColor(true)}
                        className={`w-full px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 ${
                          isPickingBgColor
                            ? "bg-rose-900 text-white"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        }`}
                      >
                        {bgColor ? (
                          <>
                            <span
                              className="w-4 h-4 rounded border border-slate-500"
                              style={{ backgroundColor: `rgb(${bgColor.r},${bgColor.g},${bgColor.b})` }}
                            />
                            Change Background Color
                          </>
                        ) : (
                          "Pick Background Color"
                        )}
                      </button>
                    </div>

                    {bgColor && (
                      <div>
                        <label className="block text-sm text-slate-400 mb-2">
                          Tolerance: {bgTolerance}%
                        </label>
                        <input
                          type="range"
                          min="5"
                          max="100"
                          value={bgTolerance}
                          onChange={(e) => setBgTolerance(Number(e.target.value))}
                          className="w-full"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                          Higher = removes more similar colors
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Navigation */}
              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep("upload")}
                  className="flex-1 px-4 py-3 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
                >
                  Back
                </button>
                <button
                  onClick={goToSettings}
                  className="flex-1 px-4 py-3 bg-rose-900 text-white rounded-lg hover:bg-rose-950"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Canvas Settings */}
        {currentStep === "settings" && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Canvas Settings</h2>
              <p className="text-slate-400">Choose the size and mesh count for your design</p>
            </div>

            <div className="bg-slate-800 rounded-xl p-6 mb-6">
              {/* Mesh count */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-3">Mesh Count</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setMeshCount(14)}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-colors ${
                      meshCount === 14
                        ? "border-rose-800 bg-rose-900/30 text-white"
                        : "border-slate-600 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    <span className="block text-lg font-bold">14 Mesh</span>
                    <span className="text-xs opacity-75">Larger stitches, easier to see</span>
                  </button>
                  <button
                    onClick={() => setMeshCount(18)}
                    className={`flex-1 px-4 py-3 rounded-lg border-2 transition-colors ${
                      meshCount === 18
                        ? "border-rose-800 bg-rose-900/30 text-white"
                        : "border-slate-600 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    <span className="block text-lg font-bold">18 Mesh</span>
                    <span className="text-xs opacity-75">Finer detail, more stitches</span>
                  </button>
                </div>
              </div>

              {/* Size presets */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-3">Canvas Size</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                  {CANVAS_PRESETS.map((preset, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setSelectedPreset(index);
                        setUseCustomSize(false);
                      }}
                      className={`px-4 py-3 rounded-lg border-2 transition-colors text-left ${
                        !useCustomSize && selectedPreset === index
                          ? "border-rose-800 bg-rose-900/30 text-white"
                          : "border-slate-600 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      <span className="block text-sm font-medium">{preset.name}</span>
                      <span className="text-xs opacity-75">{preset.width}×{preset.height} stitches</span>
                    </button>
                  ))}
                </div>

                {/* Custom size toggle */}
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={useCustomSize}
                    onChange={(e) => setUseCustomSize(e.target.checked)}
                    className="w-4 h-4 text-rose-900 bg-slate-700 border-slate-600 rounded"
                  />
                  <span className="text-slate-300 text-sm">Use custom size</span>
                </label>

                {useCustomSize && (
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Width (stitches)</label>
                      <input
                        type="number"
                        min="20"
                        max="300"
                        value={customWidth}
                        onChange={(e) => setCustomWidth(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Height (stitches)</label>
                      <input
                        type="number"
                        min="20"
                        max="300"
                        value={customHeight}
                        onChange={(e) => setCustomHeight(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Size info */}
              <div className="p-4 bg-slate-700 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Canvas Size:</span>
                  <span className="text-white font-medium">{canvasWidth} × {canvasHeight} stitches</span>
                </div>
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-slate-400">Finished Size ({meshCount} mesh):</span>
                  <span className="text-white font-medium">
                    {(canvasWidth / meshCount).toFixed(1)}&quot; × {(canvasHeight / meshCount).toFixed(1)}&quot;
                  </span>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex gap-3">
              <button
                onClick={() => setCurrentStep("prepare")}
                className="flex-1 px-4 py-3 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
              >
                Back
              </button>
              <button
                onClick={goToPreview}
                className="flex-1 px-4 py-3 bg-rose-900 text-white rounded-lg hover:bg-rose-950"
              >
                Generate Preview
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Preview */}
        {currentStep === "preview" && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Preview canvas */}
            <div className="bg-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-white">Design Preview</h3>
                <span className="text-sm text-slate-400">
                  {isGeneratingPreview ? "Generating..." : `${previewColors.length} colors`}
                </span>
              </div>

              <div className="bg-slate-900 rounded-lg p-4 flex items-center justify-center min-h-[400px]">
                <canvas
                  ref={previewCanvasRef}
                  className="max-w-full max-h-full"
                  style={{ imageRendering: "pixelated" }}
                />
              </div>

              {/* Max colors slider */}
              <div className="mt-4">
                <label className="block text-sm text-slate-400 mb-2">
                  Maximum Colors: {maxColors}
                </label>
                <input
                  type="range"
                  min="4"
                  max="48"
                  value={maxColors}
                  onChange={(e) => {
                    setMaxColors(Number(e.target.value));
                    setColorMappings(new Map());
                  }}
                  className="w-full"
                />
              </div>

              {/* Advanced Settings */}
              <div className="mt-4 border-t border-slate-700 pt-4">
                <button
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <span className="text-sm font-medium text-slate-300">Advanced Settings</span>
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${showAdvancedSettings ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showAdvancedSettings && (
                  <div className="mt-4 space-y-4">
                    {/* Quick Presets */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-2">Quick Presets</label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => applyPreset('photo')}
                          className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg text-xs hover:bg-slate-600 transition-colors"
                        >
                          Photo
                        </button>
                        <button
                          onClick={() => applyPreset('graphic')}
                          className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg text-xs hover:bg-slate-600 transition-colors"
                        >
                          Graphic
                        </button>
                        <button
                          onClick={() => applyPreset('detailed')}
                          className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg text-xs hover:bg-slate-600 transition-colors"
                        >
                          Detailed
                        </button>
                      </div>
                    </div>

                    {/* Dithering */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-2">Dithering (smooths gradients)</label>
                      <select
                        value={dithering}
                        onChange={(e) => setDithering(e.target.value as 'none' | 'floydSteinberg')}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                      >
                        <option value="none">None (solid colors)</option>
                        <option value="floydSteinberg">Floyd-Steinberg (smooth gradients)</option>
                      </select>
                      {dithering !== 'none' && (
                        <div className="mt-2">
                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span>Strength</span>
                            <span>{ditheringStrength}%</span>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="100"
                            value={ditheringStrength}
                            onChange={(e) => setDitheringStrength(Number(e.target.value))}
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>

                    {/* Contrast */}
                    <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Contrast Enhancement</span>
                        <span>{contrastEnhance}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={contrastEnhance}
                        onChange={(e) => setContrastEnhance(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>

                    {/* Sharpen */}
                    <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Sharpening</span>
                        <span>{sharpen}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={sharpen}
                        onChange={(e) => setSharpen(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>

                    <p className="text-xs text-slate-500 italic">
                      Tip: Use &quot;Photo&quot; for photographs with gradients, &quot;Graphic&quot; for logos/clipart, &quot;Detailed&quot; for complex images.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Color mapping */}
            <div className="bg-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-white">Colors</h3>
                {colorMappings.size > 0 && (
                  <button
                    onClick={() => setColorMappings(new Map())}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Reset all
                  </button>
                )}
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {previewColors.map((detected) => {
                  const originalColor = getDmcColorByNumber(detected.dmcNumber);
                  const mappedTo = colorMappings.get(detected.dmcNumber);
                  const finalColor = mappedTo ? getDmcColorByNumber(mappedTo) : originalColor;
                  const isEditing = editingColor === detected.dmcNumber;

                  if (!originalColor) return null;

                  return (
                    <div key={detected.dmcNumber} className="relative">
                      <div className="flex items-center gap-2 p-2 bg-slate-700/50 rounded-lg">
                        <div
                          className="w-8 h-8 rounded border border-slate-500 flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                          style={{
                            backgroundColor: originalColor.hex,
                            color: getContrastColor(originalColor.hex),
                          }}
                        >
                          {originalColor.dmcNumber}
                        </div>

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
                            >
                              {mappedTo}
                            </div>
                          </>
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white truncate">
                            {mappedTo ? finalColor?.name : originalColor.name}
                          </p>
                          <p className="text-[10px] text-slate-400">{detected.pixelCount} stitches</p>
                        </div>

                        <button
                          onClick={() => {
                            setEditingColor(isEditing ? null : detected.dmcNumber);
                            setColorSearchQuery("");
                          }}
                          className={`px-2 py-1 text-xs rounded ${
                            isEditing
                              ? "bg-rose-900 text-white"
                              : "bg-slate-600 text-slate-300 hover:bg-slate-500"
                          }`}
                        >
                          {isEditing ? "Cancel" : "Swap"}
                        </button>
                      </div>

                      {isEditing && (
                        <div className="mt-2 p-2 bg-slate-700 rounded-lg">
                          <input
                            type="text"
                            value={colorSearchQuery}
                            onChange={(e) => setColorSearchQuery(e.target.value)}
                            placeholder="Search colors..."
                            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-white text-xs mb-2"
                            autoFocus
                          />
                          <div className="grid grid-cols-10 gap-1 max-h-32 overflow-y-auto">
                            {filteredColors.map((c) => (
                              <button
                                key={c.dmcNumber}
                                onClick={() => handleColorMap(detected.dmcNumber, c.dmcNumber)}
                                className="w-6 h-6 rounded text-[8px] font-bold border border-slate-600 hover:border-white hover:scale-110 transition-transform"
                                style={{
                                  backgroundColor: c.hex,
                                  color: getContrastColor(c.hex),
                                }}
                                title={`${c.dmcNumber} - ${c.name}`}
                              >
                                {c.dmcNumber}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Navigation - full width */}
            <div className="lg:col-span-2 flex gap-3">
              <button
                onClick={() => setCurrentStep("settings")}
                className="flex-1 px-4 py-3 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
              >
                Back
              </button>
              <button
                onClick={() => setCurrentStep("create")}
                disabled={isGeneratingPreview || previewColors.length === 0}
                className="flex-1 px-4 py-3 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Create */}
        {currentStep === "create" && (
          <div className="max-w-xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Name Your Design</h2>
              <p className="text-slate-400">Give this custom design a name and create it</p>
            </div>

            <div className="bg-slate-800 rounded-xl p-6">
              {/* Preview thumbnail */}
              <div className="mb-6 flex justify-center">
                <div className="bg-slate-900 rounded-lg p-4">
                  <canvas
                    ref={previewCanvasRef}
                    className="max-w-full"
                    style={{ imageRendering: "pixelated", maxHeight: "200px" }}
                  />
                </div>
              </div>

              {/* Design name input */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Design Name</label>
                <input
                  type="text"
                  value={designName}
                  onChange={(e) => setDesignName(e.target.value)}
                  placeholder="Enter a name for this design..."
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
                  autoFocus
                />
              </div>

              {/* Summary */}
              <div className="p-4 bg-slate-700 rounded-lg mb-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Size:</span>
                    <span className="text-white ml-2">{canvasWidth}×{canvasHeight}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Mesh:</span>
                    <span className="text-white ml-2">{meshCount} count</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Colors:</span>
                    <span className="text-white ml-2">{previewColors.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Finished:</span>
                    <span className="text-white ml-2">
                      {(canvasWidth / meshCount).toFixed(1)}×{(canvasHeight / meshCount).toFixed(1)}"
                    </span>
                  </div>
                </div>
              </div>

              {/* Error message */}
              {createError && (
                <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm mb-6">
                  {createError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep("preview")}
                  disabled={isCreating}
                  className="flex-1 px-4 py-3 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isCreating || !designName.trim()}
                  className="flex-1 px-4 py-3 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Creating...
                    </>
                  ) : (
                    "Create Design"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

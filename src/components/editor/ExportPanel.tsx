"use client";

import React, { useState } from "react";
import { useEditorStore } from "@/lib/store";
import { exportArtworkPdf, exportStitchGuideImage, generatePreviewImage, generateFullResImage, generateOneToOneImage } from "@/lib/pdf-export";

interface ExportPanelProps {
  onClose: () => void;
}

export default function ExportPanel({ onClose }: ExportPanelProps) {
  const {
    flattenLayers,
    gridWidth,
    gridHeight,
    widthInches,
    heightInches,
    meshCount,
    designName,
    getUsedColors,
  } = useEditorStore();

  // Get flattened grid for export
  const grid = flattenLayers();

  const [exporting, setExporting] = useState(false);

  const usedColors = getUsedColors();

  const handleExportArtwork = async () => {
    setExporting(true);
    try {
      const doc = exportArtworkPdf({
        grid,
        widthInches,
        heightInches,
        meshCount,
        designName,
        usedColors,
      });

      doc.save(`${designName.replace(/\s+/g, "_")}_artwork.pdf`);
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportGuide = async () => {
    setExporting(true);
    try {
      const dataUrl = exportStitchGuideImage({
        grid,
        widthInches,
        heightInches,
        meshCount,
        designName,
        usedColors,
      });

      if (dataUrl) {
        const link = document.createElement("a");
        link.download = `${designName.replace(/\s+/g, "_")}_stitch_guide.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export stitch guide. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportImage = async (format: "png" | "jpeg") => {
    setExporting(true);
    try {
      const dataUrl = generateFullResImage(grid, meshCount, format);
      if (dataUrl) {
        const link = document.createElement("a");
        const ext = format === "jpeg" ? "jpg" : "png";
        link.download = `${designName.replace(/\s+/g, "_")}.${ext}`;
        link.href = dataUrl;
        link.click();
      }
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export image. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // Export 1:1 pixel image (1 pixel per stitch)
  const handleExportOneToOne = async () => {
    setExporting(true);
    try {
      const dataUrl = generateOneToOneImage(grid, "png");
      if (dataUrl) {
        const link = document.createElement("a");
        link.download = `${designName.replace(/\s+/g, "_")}_1to1.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export image. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Export Design</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white"
            disabled={exporting}
          >
            ✕
          </button>
        </div>

        {/* Design info */}
        <div className="mb-6 p-3 bg-slate-700 rounded-lg">
          <p className="text-white font-medium">{designName}</p>
          <p className="text-sm text-slate-400">
            {widthInches}&quot; × {heightInches}&quot; at {meshCount} mesh
          </p>
          <p className="text-sm text-slate-400">
            {usedColors.length} colors used
          </p>
        </div>

        {/* Export options */}
        <div className="space-y-3">
          {/* Artwork PDF */}
          <button
            onClick={handleExportArtwork}
            disabled={exporting}
            className="w-full p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-left disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🖼️</span>
              <div>
                <p className="text-white font-medium">Print Artwork (PDF)</p>
                <p className="text-sm text-slate-400">
                  Exact size, no grid - for printing/framing
                </p>
              </div>
            </div>
          </button>

          {/* Stitch Guide Image */}
          <button
            onClick={handleExportGuide}
            disabled={exporting}
            className="w-full p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-left disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📋</span>
              <div>
                <p className="text-white font-medium">Stitch Guide (PNG)</p>
                <p className="text-sm text-slate-400">
                  Image with color legend
                </p>
              </div>
            </div>
          </button>

          {/* 1:1 Pixel Export - 1 pixel per stitch */}
          <button
            onClick={handleExportOneToOne}
            disabled={exporting}
            className="w-full p-4 bg-rose-900/50 rounded-lg hover:bg-rose-800/50 transition-colors text-left disabled:opacity-50 border border-rose-700"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎯</span>
              <div>
                <p className="text-white font-medium">Canvas Print (1:1)</p>
                <p className="text-sm text-slate-400">
                  {gridWidth} × {gridHeight} px (1 pixel per stitch)
                </p>
              </div>
            </div>
          </button>

          {/* Image Exports */}
          <div className="flex gap-2">
            <button
              onClick={() => handleExportImage("png")}
              disabled={exporting}
              className="flex-1 p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📷</span>
                <div>
                  <p className="text-white font-medium">PNG</p>
                  <p className="text-sm text-slate-400">
                    Lossless, transparent
                  </p>
                </div>
              </div>
            </button>
            <button
              onClick={() => handleExportImage("jpeg")}
              disabled={exporting}
              className="flex-1 p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🖼️</span>
                <div>
                  <p className="text-white font-medium">JPEG</p>
                  <p className="text-sm text-slate-400">
                    Smaller file size
                  </p>
                </div>
              </div>
            </button>
          </div>
          <p className="text-xs text-slate-500 text-center">
            Image size: {gridWidth} × {gridHeight} cells × {meshCount} = {gridWidth * meshCount} × {gridHeight * meshCount} px
          </p>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          disabled={exporting}
          className="w-full mt-4 py-2 px-4 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
        >
          {exporting ? "Exporting..." : "Close"}
        </button>
      </div>
    </div>
  );
}

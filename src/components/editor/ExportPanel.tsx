"use client";

import React, { useState } from "react";
import { useEditorStore } from "@/lib/store";
import { exportArtworkPdf, exportStitchGuidePdf, generatePreviewImage } from "@/lib/pdf-export";

interface ExportPanelProps {
  onClose: () => void;
}

export default function ExportPanel({ onClose }: ExportPanelProps) {
  const {
    grid,
    widthInches,
    heightInches,
    meshCount,
    designName,
    getUsedColors,
  } = useEditorStore();

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
      const doc = exportStitchGuidePdf({
        grid,
        widthInches,
        heightInches,
        meshCount,
        designName,
        usedColors,
      });

      doc.save(`${designName.replace(/\s+/g, "_")}_stitch_guide.pdf`);
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportImage = async () => {
    setExporting(true);
    try {
      const dataUrl = generatePreviewImage(grid, 2000);
      if (dataUrl) {
        const link = document.createElement("a");
        link.download = `${designName.replace(/\s+/g, "_")}.png`;
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

          {/* Stitch Guide PDF */}
          <button
            onClick={handleExportGuide}
            disabled={exporting}
            className="w-full p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-left disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📋</span>
              <div>
                <p className="text-white font-medium">Stitch Guide (PDF)</p>
                <p className="text-sm text-slate-400">
                  Cover page, legend, and gridded pattern
                </p>
              </div>
            </div>
          </button>

          {/* PNG Image */}
          <button
            onClick={handleExportImage}
            disabled={exporting}
            className="w-full p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-left disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📷</span>
              <div>
                <p className="text-white font-medium">Image (PNG)</p>
                <p className="text-sm text-slate-400">
                  High-resolution preview image
                </p>
              </div>
            </div>
          </button>
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

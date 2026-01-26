"use client";

import React, { useState, useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import Header from "./Header";
import Toolbar from "./Toolbar";
import PixelCanvas from "./PixelCanvas";
import ColorPicker from "./ColorPicker";
import MetricsPanel from "./MetricsPanel";
import ImageImport from "./ImageImport";
import CanvasResize from "./CanvasResize";
import ExportPanel from "./ExportPanel";

interface EditorProps {
  designId?: string;
  initialData?: {
    name: string;
    widthInches: number;
    heightInches: number;
    meshCount: 14 | 18;
    gridWidth: number;
    gridHeight: number;
    grid: (string | null)[][];
    stitchType: "continental" | "basketweave";
    bufferPercent: number;
    referenceImageUrl?: string | null;
    referenceImageOpacity?: number;
  };
}

export default function Editor({ designId, initialData }: EditorProps) {
  const {
    setDesignInfo,
    initializeGrid,
    setStitchType,
    setBufferPercent,
    setReferenceImage,
    reset,
  } = useEditorStore();

  const [showImageImport, setShowImageImport] = useState(false);
  const [showCanvasResize, setShowCanvasResize] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Initialize editor with design data
  useEffect(() => {
    if (initialData) {
      setDesignInfo({
        designId: designId || null,
        designName: initialData.name,
        widthInches: initialData.widthInches,
        heightInches: initialData.heightInches,
        meshCount: initialData.meshCount,
      });
      initializeGrid(initialData.gridWidth, initialData.gridHeight, initialData.grid);
      setStitchType(initialData.stitchType);
      setBufferPercent(initialData.bufferPercent);
      if (initialData.referenceImageUrl) {
        setReferenceImage(initialData.referenceImageUrl, initialData.referenceImageOpacity);
      }
    } else {
      // New design - use default settings
      reset();
      setDesignInfo({
        designId: null,
        designName: "Untitled Design",
        widthInches: 8,
        heightInches: 8,
        meshCount: 14,
      });
      initializeGrid(112, 112);
    }
  }, [designId, initialData, setDesignInfo, initializeGrid, setStitchType, setBufferPercent, setReferenceImage, reset]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { undo, redo, canUndo, canRedo, copySelectionToClipboard, cutSelectionToClipboard, pasteFromClipboard, selectAll, deleteSelection, selection, clipboard } = useEditorStore.getState();

      if (e.metaKey || e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) {
              if (canRedo()) redo();
            } else {
              if (canUndo()) undo();
            }
            break;
          case "y":
            e.preventDefault();
            if (canRedo()) redo();
            break;
          case "c":
            if (selection) {
              e.preventDefault();
              copySelectionToClipboard();
            }
            break;
          case "x":
            if (selection) {
              e.preventDefault();
              cutSelectionToClipboard();
            }
            break;
          case "v":
            if (clipboard) {
              e.preventDefault();
              pasteFromClipboard(0, 0);
            }
            break;
          case "a":
            e.preventDefault();
            selectAll();
            break;
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selection) {
          e.preventDefault();
          deleteSelection();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <Header
        onShowImageImport={() => setShowImageImport(true)}
        onShowCanvasResize={() => setShowCanvasResize(true)}
        onShowExport={() => setShowExport(true)}
      />
      <Toolbar />

      <div className="flex-1 flex overflow-hidden">
        <ColorPicker />
        <PixelCanvas />
        <MetricsPanel />
      </div>

      {/* Modals */}
      {showImageImport && (
        <ImageImport onClose={() => setShowImageImport(false)} />
      )}
      {showCanvasResize && (
        <CanvasResize onClose={() => setShowCanvasResize(false)} />
      )}
      {showExport && (
        <ExportPanel onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

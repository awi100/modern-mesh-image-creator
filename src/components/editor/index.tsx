"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import Header from "./Header";
import Toolbar from "./Toolbar";
import PixelCanvas from "./PixelCanvas";
import ColorPicker from "./ColorPicker";
import MetricsPanel from "./MetricsPanel";
import ImageImport from "./ImageImport";
import CanvasResize from "./CanvasResize";
import ExportPanel from "./ExportPanel";
import MobileBottomBar from "./MobileBottomBar";
import AddTextDialog from "./AddTextDialog";

interface EditorProps {
  designId?: string;
  initialData?: {
    name: string;
    folderId?: string | null;
    isDraft?: boolean;
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
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [pendingText, setPendingText] = useState<{
    pixels: (string | null)[][];
    width: number;
    height: number;
  } | null>(null);

  // Initialize editor with design data
  useEffect(() => {
    if (initialData) {
      setDesignInfo({
        designId: designId || null,
        designName: initialData.name,
        folderId: initialData.folderId || null,
        isDraft: initialData.isDraft || false,
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
      // New design - check if store already has values set by NewDesignDialog
      const currentState = useEditorStore.getState();

      // Only initialize with defaults if the store hasn't been set up
      // (i.e., if it still has initial values or was reset)
      if (currentState.gridWidth === 112 && currentState.gridHeight === 112 &&
          currentState.designName === "Untitled Design") {
        // Store wasn't configured by NewDesignDialog, use defaults
        initializeGrid(112, 112);
      }
      // Don't reset - preserve any name/dimensions set by NewDesignDialog
    }
  }, [designId, initialData, setDesignInfo, initializeGrid, setStitchType, setBufferPercent, setReferenceImage]);

  // Handle text added from dialog
  const handleTextAdded = useCallback((pixels: (string | null)[][], width: number, height: number) => {
    setPendingText({ pixels, width, height });
    setShowTextDialog(false);
  }, []);

  // Handle text placement on canvas
  const handleTextPlaced = useCallback((x: number, y: number) => {
    if (pendingText) {
      useEditorStore.getState().applyPixelOverlay(pendingText.pixels, x, y);
      setPendingText(null);
    }
  }, [pendingText]);

  // Cancel text placement
  const handleCancelTextPlacement = useCallback(() => {
    setPendingText(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts when user is typing in an input or textarea
      const activeElement = document.activeElement;
      const isInputFocused = activeElement instanceof HTMLInputElement ||
                             activeElement instanceof HTMLTextAreaElement ||
                             activeElement?.getAttribute("contenteditable") === "true";

      if (isInputFocused) {
        // Only allow undo/redo to work globally
        if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
          // Let undo/redo work, but don't prevent default for inputs
          return;
        }
        // Let all other shortcuts be handled by the input
        return;
      }

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
        onShowTextDialog={() => setShowTextDialog(true)}
      />
      <Toolbar />

      <div className="flex-1 flex overflow-hidden">
        {/* Color picker - hidden on mobile, shown via bottom drawer */}
        <div className="hidden md:flex md:h-full">
          <ColorPicker />
        </div>

        <PixelCanvas
          pendingText={pendingText}
          onTextPlaced={handleTextPlaced}
          onCancelTextPlacement={handleCancelTextPlacement}
        />

        {/* Metrics panel - hidden on mobile, shown via bottom drawer */}
        <div className="hidden lg:block">
          <MetricsPanel />
        </div>
      </div>

      {/* Mobile bottom bar with panel toggles */}
      <MobileBottomBar
        onShowColors={() => setShowColorPicker(true)}
        onShowMetrics={() => setShowMetrics(true)}
      />

      {/* Mobile Color Picker Drawer */}
      {showColorPicker && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowColorPicker(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-slate-800 rounded-t-2xl max-h-[70vh] overflow-hidden animate-slide-up">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-white font-semibold">Colors</h2>
              <button
                onClick={() => setShowColorPicker(false)}
                className="p-2 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(70vh-60px)]">
              <ColorPicker />
            </div>
          </div>
        </div>
      )}

      {/* Mobile Metrics Drawer */}
      {showMetrics && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowMetrics(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-slate-800 rounded-t-2xl max-h-[70vh] overflow-hidden animate-slide-up">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-white font-semibold">Design Info</h2>
              <button
                onClick={() => setShowMetrics(false)}
                className="p-2 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(70vh-60px)]">
              <MetricsPanel />
            </div>
          </div>
        </div>
      )}

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
      {showTextDialog && (
        <AddTextDialog
          onClose={() => setShowTextDialog(false)}
          onAddText={handleTextAdded}
        />
      )}
    </div>
  );
}

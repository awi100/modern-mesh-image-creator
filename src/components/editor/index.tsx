"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import Header from "./Header";
import Toolbar from "./Toolbar";
import PixelCanvas from "./PixelCanvas";
import ColorPicker from "./ColorPicker";
import MetricsPanel from "./MetricsPanel";
import LayersPanel from "./LayersPanel";
import ImageImport from "./ImageImport";
import CanvasResize from "./CanvasResize";
import ExportPanel from "./ExportPanel";
import MobileBottomBar from "./MobileBottomBar";
import AddTextDialog from "./AddTextDialog";
import AddShapeDialog from "./AddShapeDialog";

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
  const [showLayers, setShowLayers] = useState(false);
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [showShapeDialog, setShowShapeDialog] = useState(false);
  const [colorPanelCollapsed, setColorPanelCollapsed] = useState(false);
  const [layersPanelCollapsed, setLayersPanelCollapsed] = useState(false);
  const [pendingText, setPendingText] = useState<{
    pixels: (string | null)[][];
    width: number;
    height: number;
    // For resizable shapes
    isShape?: boolean;
    basePixels?: boolean[][];
    dmcNumber?: string;
    scale?: number;
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

  // Handle shape added from dialog (reuse the same pending text mechanism)
  const handleShapeAdded = useCallback((
    pixels: (string | null)[][],
    width: number,
    height: number,
    basePixels?: boolean[][],
    dmcNumber?: string
  ) => {
    setPendingText({
      pixels,
      width,
      height,
      isShape: !!basePixels,
      basePixels,
      dmcNumber,
      scale: 1,
    });
    setShowShapeDialog(false);
  }, []);

  // Resize pending shape
  const handleResizePendingShape = useCallback((delta: number) => {
    if (!pendingText?.isShape || !pendingText.basePixels || !pendingText.dmcNumber) return;

    const newScale = Math.max(0.25, Math.min(4, (pendingText.scale || 1) + delta));
    const baseHeight = pendingText.basePixels.length;
    const baseWidth = pendingText.basePixels[0]?.length || 0;

    const newWidth = Math.max(3, Math.round(baseWidth * newScale));
    const newHeight = Math.max(3, Math.round(baseHeight * newScale));

    // Import and use the shape utilities
    import("@/lib/shapes").then(({ scaleShape, shapeToGrid }) => {
      const scaledPixels = scaleShape(pendingText.basePixels!, newWidth, newHeight);
      const newPixels = shapeToGrid(scaledPixels, pendingText.dmcNumber!);
      setPendingText({
        ...pendingText,
        pixels: newPixels,
        width: newWidth,
        height: newHeight,
        scale: newScale,
      });
    });
  }, [pendingText]);

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
        onShowShapeDialog={() => setShowShapeDialog(true)}
      />
      <Toolbar />

      <div className="flex-1 flex overflow-hidden">
        {/* Color picker - hidden on mobile, shown via bottom drawer */}
        <div className="hidden md:flex md:h-full">
          {colorPanelCollapsed ? (
            <div className="bg-slate-800 border-r border-slate-700 flex flex-col items-center py-2">
              <button
                onClick={() => setColorPanelCollapsed(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                title="Show colors panel"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <div className="mt-2 text-xs text-slate-500 writing-mode-vertical rotate-180" style={{ writingMode: 'vertical-rl' }}>
                Colors
              </div>
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setColorPanelCollapsed(true)}
                className="absolute top-2 right-2 z-10 p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                title="Collapse colors panel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <ColorPicker />
            </div>
          )}
        </div>

        <PixelCanvas
          pendingText={pendingText}
          onTextPlaced={handleTextPlaced}
          onCancelTextPlacement={handleCancelTextPlacement}
          onResizePendingShape={handleResizePendingShape}
        />

        {/* Right side panels */}
        <div className="hidden lg:flex lg:flex-row">
          {/* Layers panel */}
          {layersPanelCollapsed ? (
            <div className="bg-slate-800 border-l border-slate-700 flex flex-col items-center py-2">
              <button
                onClick={() => setLayersPanelCollapsed(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                title="Show layers panel"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="mt-2 text-xs text-slate-500 writing-mode-vertical rotate-180" style={{ writingMode: 'vertical-rl' }}>
                Layers
              </div>
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setLayersPanelCollapsed(true)}
                className="absolute top-2 right-2 z-10 p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                title="Collapse layers panel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <LayersPanel />
            </div>
          )}

          {/* Metrics panel */}
          <MetricsPanel />
        </div>
      </div>

      {/* Mobile bottom bar with panel toggles */}
      <MobileBottomBar
        onShowColors={() => setShowColorPicker(true)}
        onShowMetrics={() => setShowMetrics(true)}
        onShowLayers={() => setShowLayers(true)}
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

      {/* Mobile Layers Drawer */}
      {showLayers && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowLayers(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-slate-800 rounded-t-2xl max-h-[70vh] overflow-hidden animate-slide-up">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-white font-semibold">Layers</h2>
              <button
                onClick={() => setShowLayers(false)}
                className="p-2 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(70vh-60px)]">
              <LayersPanel />
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
      {showShapeDialog && (
        <AddShapeDialog
          onClose={() => setShowShapeDialog(false)}
          onAddShape={handleShapeAdded}
        />
      )}
    </div>
  );
}

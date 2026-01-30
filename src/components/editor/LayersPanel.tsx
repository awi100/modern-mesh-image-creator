"use client";

import React, { useState, useCallback, useRef } from "react";
import { useEditorStore, Layer } from "@/lib/store";

export default function LayersPanel() {
  const {
    layers,
    activeLayerIndex,
    addLayer,
    deleteLayer,
    duplicateLayer,
    setActiveLayer,
    renameLayer,
    toggleLayerVisibility,
    setLayerOpacity,
    toggleLayerLock,
    moveLayerUp,
    moveLayerDown,
    reorderLayer,
    mergeLayerDown,
    flattenLayers,
    saveToHistory,
  } = useEditorStore();

  const [editingLayerIndex, setEditingLayerIndex] = useState<number | null>(null);
  const [tempName, setTempName] = useState("");
  const [showMenu, setShowMenu] = useState(false);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const handleStartRename = useCallback((index: number, currentName: string) => {
    setEditingLayerIndex(index);
    setTempName(currentName);
  }, []);

  const handleFinishRename = useCallback(() => {
    if (editingLayerIndex !== null && tempName.trim()) {
      renameLayer(editingLayerIndex, tempName.trim());
    }
    setEditingLayerIndex(null);
    setTempName("");
  }, [editingLayerIndex, tempName, renameLayer]);

  const handleFlattenAll = useCallback(() => {
    if (layers.length <= 1) return;
    saveToHistory();

    const flatGrid = flattenLayers();
    // Replace all layers with a single flattened layer
    const store = useEditorStore.getState();
    store.initializeGrid(store.gridWidth, store.gridHeight, flatGrid);
    setShowMenu(false);
  }, [layers.length, flattenLayers, saveToHistory]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, actualIndex: number) => {
    setDraggedIndex(actualIndex);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(actualIndex));
    // Add a slight delay to allow the drag image to be created
    setTimeout(() => {
      const target = e.target as HTMLElement;
      target.style.opacity = "0.5";
    }, 0);
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    target.style.opacity = "1";
    setDraggedIndex(null);
    setDropTargetIndex(null);
    dragCounter.current = 0;
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, actualIndex: number) => {
    e.preventDefault();
    dragCounter.current++;
    if (draggedIndex !== null && draggedIndex !== actualIndex) {
      setDropTargetIndex(actualIndex);
    }
  }, [draggedIndex]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDropTargetIndex(null);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetActualIndex: number) => {
    e.preventDefault();
    dragCounter.current = 0;

    if (draggedIndex !== null && draggedIndex !== targetActualIndex) {
      reorderLayer(draggedIndex, targetActualIndex);
    }

    setDraggedIndex(null);
    setDropTargetIndex(null);
  }, [draggedIndex, reorderLayer]);

  // Render layers in reverse order (top layer first in UI)
  const reversedLayers = [...layers].reverse();

  return (
    <div className="w-64 bg-slate-800 border-l border-slate-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-slate-700 flex items-center justify-between">
        <h3 className="text-white font-medium text-sm">Layers</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={addLayer}
            disabled={layers.length >= 10}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            title="Add layer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
              title="More options"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 bg-slate-700 rounded-lg shadow-lg py-1 z-20 min-w-[140px]">
                  <button
                    onClick={handleFlattenAll}
                    disabled={layers.length <= 1}
                    className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Flatten All
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {reversedLayers.map((layer, reversedIndex) => {
          const actualIndex = layers.length - 1 - reversedIndex;
          const isActive = actualIndex === activeLayerIndex;
          const isEditing = editingLayerIndex === actualIndex;
          const isDragging = draggedIndex === actualIndex;
          const isDropTarget = dropTargetIndex === actualIndex;

          return (
            <div
              key={layer.id}
              draggable={!isEditing}
              onDragStart={(e) => handleDragStart(e, actualIndex)}
              onDragEnd={handleDragEnd}
              onDragEnter={(e) => handleDragEnter(e, actualIndex)}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, actualIndex)}
              className={`rounded-lg border transition-all ${
                isDragging
                  ? "opacity-50"
                  : isDropTarget
                  ? "border-rose-500 border-2 bg-rose-900/20"
                  : isActive
                  ? "bg-rose-900/30 border-rose-800"
                  : "bg-slate-700/50 border-slate-600 hover:border-slate-500"
              } ${!isEditing ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              {/* Layer header */}
              <div
                className="flex items-center gap-2 p-2"
                onClick={() => !isDragging && setActiveLayer(actualIndex)}
              >
                {/* Drag handle */}
                <div className="text-slate-500 hover:text-slate-400 cursor-grab active:cursor-grabbing">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                  </svg>
                </div>

                {/* Visibility toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerVisibility(actualIndex);
                  }}
                  className={`p-1 rounded ${
                    layer.visible
                      ? "text-slate-300 hover:text-white"
                      : "text-slate-500 hover:text-slate-400"
                  }`}
                  title={layer.visible ? "Hide layer" : "Show layer"}
                >
                  {layer.visible ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  )}
                </button>

                {/* Layer name */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      type="text"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      onBlur={handleFinishRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleFinishRename();
                        if (e.key === "Escape") {
                          setEditingLayerIndex(null);
                          setTempName("");
                        }
                      }}
                      className="w-full px-1 py-0.5 bg-slate-600 border border-slate-500 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-rose-800"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="text-sm text-slate-200 truncate block"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleStartRename(actualIndex, layer.name);
                      }}
                    >
                      {layer.name}
                    </span>
                  )}
                </div>

                {/* Lock toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerLock(actualIndex);
                  }}
                  className={`p-1 rounded ${
                    layer.locked
                      ? "text-yellow-400 hover:text-yellow-300"
                      : "text-slate-500 hover:text-slate-400"
                  }`}
                  title={layer.locked ? "Unlock layer" : "Lock layer"}
                >
                  {layer.locked ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Opacity slider - only show for active layer */}
              {isActive && (
                <div className="px-2 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-14">Opacity</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(layer.opacity * 100)}
                      onChange={(e) => setLayerOpacity(actualIndex, parseInt(e.target.value) / 100)}
                      className="flex-1 h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-rose-800"
                    />
                    <span className="text-xs text-slate-400 w-8 text-right">
                      {Math.round(layer.opacity * 100)}%
                    </span>
                  </div>

                  {/* Layer actions */}
                  <div className="flex items-center gap-1 mt-2">
                    <button
                      onClick={() => moveLayerUp(actualIndex)}
                      disabled={actualIndex === 0}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down (in stack)"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </button>
                    <button
                      onClick={() => moveLayerDown(actualIndex)}
                      disabled={actualIndex === layers.length - 1}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up (in stack)"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => duplicateLayer(actualIndex)}
                      disabled={layers.length >= 10}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Duplicate layer"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => mergeLayerDown(actualIndex)}
                      disabled={actualIndex === 0}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Merge down"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteLayer(actualIndex)}
                      disabled={layers.length <= 1}
                      className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Delete layer"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer with layer count */}
      <div className="p-2 border-t border-slate-700 text-xs text-slate-500 text-center">
        {layers.length} / 10 layers
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import pako from "pako";

const AUTO_SAVE_DELAY = 3000; // 3 seconds after last change

export function useAutoSave() {
  const {
    designId,
    designName,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    grid,
    stitchType,
    bufferPercent,
    referenceImageUrl,
    referenceImageOpacity,
    isDirty,
    markClean,
    setAutoSaveStatus,
    setLastSavedAt,
    autoSaveStatus,
    lastSavedAt,
  } = useEditorStore();

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);

  const performSave = useCallback(async () => {
    // Only auto-save if we have a design ID (existing design)
    if (!designId || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setAutoSaveStatus('saving');

    try {
      // Compress pixel data
      const pixelDataJson = JSON.stringify(grid);
      const compressed = pako.deflate(pixelDataJson);
      const base64 = btoa(String.fromCharCode(...compressed));

      const body = {
        name: designName,
        widthInches,
        heightInches,
        meshCount,
        gridWidth,
        gridHeight,
        pixelData: base64,
        stitchType,
        bufferPercent,
        referenceImageUrl,
        referenceImageOpacity,
      };

      const response = await fetch(`/api/designs/${designId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error("Auto-save failed");
      }

      markClean();
      setLastSavedAt(new Date());
      setAutoSaveStatus('saved');

      // Reset status to idle after showing "saved" briefly
      setTimeout(() => {
        setAutoSaveStatus('idle');
      }, 2000);
    } catch (error) {
      console.error("Auto-save error:", error);
      setAutoSaveStatus('error');

      // Reset status after showing error
      setTimeout(() => {
        setAutoSaveStatus('idle');
      }, 3000);
    } finally {
      isSavingRef.current = false;
    }
  }, [
    designId,
    designName,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    grid,
    stitchType,
    bufferPercent,
    referenceImageUrl,
    referenceImageOpacity,
    markClean,
    setAutoSaveStatus,
    setLastSavedAt,
  ]);

  // Debounced auto-save effect
  useEffect(() => {
    // Only trigger auto-save if dirty and we have a design ID
    if (!isDirty || !designId) {
      return;
    }

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set a new timeout for auto-save
    timeoutRef.current = setTimeout(() => {
      performSave();
    }, AUTO_SAVE_DELAY);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isDirty, designId, performSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    autoSaveStatus,
    lastSavedAt,
    triggerSave: performSave,
  };
}

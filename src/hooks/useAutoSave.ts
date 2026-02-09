"use client";

import { useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { triggerSessionExpired } from "@/components/SessionExpiredModal";
import pako from "pako";

const AUTO_SAVE_DELAY = 3000; // 3 seconds after last change
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second, doubles each retry

// Generate a small preview image as base64 data URL
function generatePreviewImage(
  grid: (string | null)[][],
  gridWidth: number,
  gridHeight: number
): string {
  const maxSize = 200;
  const cellSize = Math.max(1, Math.min(
    Math.floor(maxSize / gridWidth),
    Math.floor(maxSize / gridHeight)
  ));

  const width = gridWidth * cellSize;
  const height = gridHeight * cellSize;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y]?.[x];
      if (dmcNumber) {
        const color = getDmcColorByNumber(dmcNumber);
        if (color) {
          ctx.fillStyle = color.hex;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  return canvas.toDataURL("image/png", 0.8);
}

export function useAutoSave() {
  const {
    designId,
    designName,
    folderId,
    isDraft,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    flattenLayers,
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
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const retryCountRef = useRef(0);
  const pendingSaveDataRef = useRef<string | null>(null);

  const performSave = useCallback(async (isRetry = false) => {
    // Only auto-save if we have a design ID (existing design)
    if (!designId || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setAutoSaveStatus('saving');

    try {
      // Flatten all layers for storage
      const grid = flattenLayers();

      // Compress pixel data
      const pixelDataJson = JSON.stringify(grid);
      const compressed = pako.deflate(pixelDataJson);
      const base64 = btoa(String.fromCharCode(...compressed));

      // Store pending save data for potential retries
      pendingSaveDataRef.current = base64;

      // Generate preview image
      const previewImageUrl = generatePreviewImage(grid, gridWidth, gridHeight);

      const body = {
        name: designName,
        folderId,
        isDraft,
        widthInches,
        heightInches,
        meshCount,
        gridWidth,
        gridHeight,
        pixelData: base64,
        previewImageUrl,
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
        const errorText = await response.text();
        console.error("[Auto-save] Server error:", {
          status: response.status,
          statusText: response.statusText,
          designId,
          designName,
          gridWidth,
          gridHeight,
          errorResponse: errorText,
          retryCount: retryCountRef.current,
        });

        // If unauthorized (401), trigger session expired modal - don't retry auth errors
        if (response.status === 401) {
          triggerSessionExpired();
          retryCountRef.current = 0;
          pendingSaveDataRef.current = null;
          throw new Error("Session expired - please sign in again");
        }

        throw new Error(`Auto-save failed: ${response.status} ${response.statusText}`);
      }

      // Success! Clear retry state
      retryCountRef.current = 0;
      pendingSaveDataRef.current = null;

      markClean();
      setLastSavedAt(new Date());
      setAutoSaveStatus('saved');

      console.log("[Auto-save] Success", { designId, designName });

      // Reset status to idle after showing "saved" briefly
      setTimeout(() => {
        setAutoSaveStatus('idle');
      }, 2000);
    } catch (error) {
      console.error("[Auto-save] Error:", error);

      // Retry with exponential backoff (except for auth errors)
      const isAuthError = error instanceof Error && error.message.includes("Session expired");

      if (!isAuthError && retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, retryCountRef.current - 1);

        console.log(`[Auto-save] Scheduling retry ${retryCountRef.current}/${MAX_RETRIES} in ${retryDelay}ms`);
        setAutoSaveStatus('error');

        // Clear any existing retry timeout
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }

        retryTimeoutRef.current = setTimeout(() => {
          isSavingRef.current = false; // Allow the retry to proceed
          performSave(true);
        }, retryDelay);
      } else {
        // Max retries reached or auth error
        if (!isAuthError) {
          console.error(`[Auto-save] Failed after ${MAX_RETRIES} retries. Data may be lost!`);
          alert("Unable to save your changes after multiple attempts. Please check your internet connection and try saving manually.");
        }
        retryCountRef.current = 0;
        setAutoSaveStatus('error');

        // Reset status after showing error
        setTimeout(() => {
          setAutoSaveStatus('idle');
        }, 5000);
      }
    } finally {
      if (retryCountRef.current === 0) {
        isSavingRef.current = false;
      }
    }
  }, [
    designId,
    designName,
    folderId,
    isDraft,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    flattenLayers,
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
      // Note: Don't clear retryTimeoutRef here - let retries complete
    };
  }, [isDirty, designId, performSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  return {
    autoSaveStatus,
    lastSavedAt,
    triggerSave: performSave,
    retryCount: retryCountRef.current,
  };
}

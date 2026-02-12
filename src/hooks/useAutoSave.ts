"use client";

import { useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { triggerSessionExpired } from "@/components/SessionExpiredModal";
import pako from "pako";
import {
  isIndexedDBAvailable,
  getOfflineDesign,
  updateOfflineDesign,
  createOfflineDesign,
  importDesignFromServer,
  addToSyncQueue,
  isOnline,
  processQueue,
} from "@/lib/offline";

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

// Compress grid data to Uint8Array for IndexedDB storage
function compressGridToBytes(grid: (string | null)[][]): Uint8Array {
  const pixelDataJson = JSON.stringify(grid);
  return pako.deflate(pixelDataJson);
}

// Compress grid data to base64 string for server API
function compressGridToBase64(grid: (string | null)[][]): string {
  const compressed = compressGridToBytes(grid);
  return btoa(String.fromCharCode(...compressed));
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
  const offlineIdRef = useRef<string | null>(null);

  // Save to IndexedDB (always succeeds locally)
  const saveToIndexedDB = useCallback(async (
    grid: (string | null)[][],
    previewImageUrl: string
  ): Promise<string | null> => {
    if (!isIndexedDBAvailable()) {
      console.log("[Auto-save] IndexedDB not available, skipping offline storage");
      return null;
    }

    try {
      const pixelData = compressGridToBytes(grid);

      // Check if we have an existing offline record for this design
      const offlineDesign = offlineIdRef.current
        ? await getOfflineDesign(offlineIdRef.current)
        : designId
          ? await getOfflineDesign(designId)
          : null;

      if (offlineDesign) {
        // Update existing offline design
        await updateOfflineDesign(offlineDesign.id, {
          name: designName,
          pixelData,
          widthInches,
          heightInches,
          meshCount,
          previewImageUrl,
          isDraft,
          folderId,
        });
        offlineIdRef.current = offlineDesign.id;
        console.log("[Auto-save] Updated IndexedDB:", offlineDesign.id);
        return offlineDesign.id;
      } else {
        // Create new offline design
        const newDesign = await createOfflineDesign({
          serverId: designId || null,
          name: designName,
          pixelData,
          widthInches,
          heightInches,
          meshCount,
          totalSold: 0,
          kitsReady: 0,
          canvasPrinted: 0,
          previewImageUrl,
          isDraft,
          folderId,
          tags: [],
        });
        offlineIdRef.current = newDesign.id;
        console.log("[Auto-save] Created in IndexedDB:", newDesign.id);
        return newDesign.id;
      }
    } catch (error) {
      console.error("[Auto-save] IndexedDB error:", error);
      return null;
    }
  }, [designId, designName, folderId, isDraft, widthInches, heightInches, meshCount]);

  // Queue for server sync
  const queueForSync = useCallback(async (
    offlineId: string,
    base64Data: string,
    previewImageUrl: string
  ) => {
    if (!isIndexedDBAvailable()) return;

    try {
      const offlineDesign = await getOfflineDesign(offlineId);
      if (!offlineDesign) return;

      const operation = offlineDesign.serverId ? "update" : "create";
      const payload = {
        name: designName,
        folderId,
        isDraft,
        widthInches,
        heightInches,
        meshCount,
        gridWidth,
        gridHeight,
        pixelData: base64Data,
        previewImageUrl,
        stitchType,
        bufferPercent,
        referenceImageUrl,
        referenceImageOpacity,
      };

      await addToSyncQueue(operation, offlineId, payload);
      console.log("[Auto-save] Queued for sync:", { operation, offlineId });

      // If online, trigger sync immediately
      if (isOnline()) {
        // Don't await - let it sync in background
        processQueue().catch(console.error);
      }
    } catch (error) {
      console.error("[Auto-save] Failed to queue for sync:", error);
    }
  }, [
    designName,
    folderId,
    isDraft,
    widthInches,
    heightInches,
    meshCount,
    gridWidth,
    gridHeight,
    stitchType,
    bufferPercent,
    referenceImageUrl,
    referenceImageOpacity,
  ]);

  const performSave = useCallback(async (isRetry = false) => {
    // Only auto-save if we have a design ID (existing design) or we're creating offline
    if (!designId || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setAutoSaveStatus('saving');

    try {
      // Flatten all layers for storage
      const grid = flattenLayers();

      // Compress pixel data
      const base64 = compressGridToBase64(grid);

      // Store pending save data for potential retries
      pendingSaveDataRef.current = base64;

      // Generate preview image
      const previewImageUrl = generatePreviewImage(grid, gridWidth, gridHeight);

      // STEP 1: Always save to IndexedDB first (fast, reliable)
      const offlineId = await saveToIndexedDB(grid, previewImageUrl);

      // STEP 2: Check if online
      if (!isOnline()) {
        // Offline - queue for later sync
        if (offlineId) {
          await queueForSync(offlineId, base64, previewImageUrl);
        }

        // Mark as saved locally
        markClean();
        setLastSavedAt(new Date());
        setAutoSaveStatus('saved');

        console.log("[Auto-save] Saved offline, will sync when online");

        setTimeout(() => {
          setAutoSaveStatus('idle');
        }, 2000);

        return;
      }

      // STEP 3: Online - try to save to server
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

      console.log("[Auto-save] Sending:", {
        designId,
        name: designName,
        gridWidth,
        gridHeight,
        pixelDataSize: base64.length,
        hasPreview: !!previewImageUrl,
      });

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

        // If unauthorized (401), trigger session expired modal
        if (response.status === 401) {
          triggerSessionExpired();
          retryCountRef.current = 0;
          pendingSaveDataRef.current = null;
          throw new Error("Session expired - please sign in again");
        }

        throw new Error(`Auto-save failed: ${response.status} ${response.statusText}`);
      }

      // Verify the response
      const savedDesign = await response.json();
      console.log("[Auto-save] Server response:", {
        id: savedDesign.id,
        name: savedDesign.name,
        updatedAt: savedDesign.updatedAt,
      });

      // Update IndexedDB with server confirmation
      if (offlineId && isIndexedDBAvailable()) {
        try {
          await importDesignFromServer({
            id: savedDesign.id,
            name: savedDesign.name,
            pixelData: compressGridToBytes(grid),
            widthInches: savedDesign.widthInches,
            heightInches: savedDesign.heightInches,
            meshCount: savedDesign.meshCount,
            totalSold: savedDesign.totalSold || 0,
            kitsReady: savedDesign.kitsReady || 0,
            canvasPrinted: savedDesign.canvasPrinted || 0,
            previewImageUrl: savedDesign.previewImageUrl,
            isDraft: savedDesign.isDraft,
            folderId: savedDesign.folderId,
            version: savedDesign.version || 1,
          });
        } catch (dbError) {
          console.warn("[Auto-save] Failed to update IndexedDB after server save:", dbError);
        }
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

      // Check if we saved to IndexedDB at least
      const savedOffline = offlineIdRef.current !== null;

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
          isSavingRef.current = false;
          performSave(true);
        }, retryDelay);
      } else {
        // Max retries reached or auth error
        if (!isAuthError) {
          if (savedOffline) {
            // Data is safe in IndexedDB, will sync later
            console.log("[Auto-save] Server sync failed, but data is saved offline");
            markClean();
            setLastSavedAt(new Date());
            setAutoSaveStatus('saved');

            setTimeout(() => {
              setAutoSaveStatus('idle');
            }, 2000);
          } else {
            console.error(`[Auto-save] Failed after ${MAX_RETRIES} retries. Data may be lost!`);
            alert("Unable to save your changes after multiple attempts. Please check your internet connection and try saving manually.");
            setAutoSaveStatus('error');

            setTimeout(() => {
              setAutoSaveStatus('idle');
            }, 5000);
          }
        } else {
          setAutoSaveStatus('error');
          setTimeout(() => {
            setAutoSaveStatus('idle');
          }, 5000);
        }
        retryCountRef.current = 0;
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
    saveToIndexedDB,
    queueForSync,
  ]);

  // Set offline ID when design loads
  useEffect(() => {
    if (designId) {
      // Check if we have an offline copy
      getOfflineDesign(designId).then((design) => {
        if (design) {
          offlineIdRef.current = design.id;
        }
      }).catch(console.error);
    }
  }, [designId]);

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

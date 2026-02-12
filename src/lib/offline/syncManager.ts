import {
  getNextPendingItem,
  markItemProcessing,
  markItemFailed,
  removeFromSyncQueue,
  getPendingCount,
  SyncQueueItem,
} from "./syncQueue";
import {
  getOfflineDesign,
  markDesignSynced,
  markDesignConflict,
  markDesignError,
  purgeOfflineDesign,
} from "./designStore";
import { getMetadata, setMetadata } from "./db";

// Exponential backoff delays (in ms)
const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000];

// Sync state
let isSyncing = false;
let syncAbortController: AbortController | null = null;

// Event listeners for sync status changes
type SyncEventType = "start" | "complete" | "error" | "conflict" | "progress";
type SyncEventListener = (event: {
  type: SyncEventType;
  designId?: string;
  error?: string;
  pending?: number;
}) => void;

const listeners: Set<SyncEventListener> = new Set();

export function addSyncListener(listener: SyncEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(event: Parameters<SyncEventListener>[0]) {
  listeners.forEach((listener) => listener(event));
}

// Check if online
export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

// Get last sync time
export async function getLastSyncTime(): Promise<number | null> {
  return getMetadata<number>("lastSyncTime");
}

// Set last sync time
async function setLastSyncTime(time: number): Promise<void> {
  await setMetadata("lastSyncTime", time);
}

// Process a single sync item
async function processSyncItem(item: SyncQueueItem): Promise<boolean> {
  const design = await getOfflineDesign(item.designId);

  try {
    switch (item.operation) {
      case "create": {
        if (!design) {
          // Design was deleted locally, skip
          await removeFromSyncQueue(item.id);
          return true;
        }

        const response = await fetch("/api/designs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...item.payload,
            offlineId: design.id, // Track which offline design this is
          }),
          signal: syncAbortController?.signal,
        });

        if (!response.ok) {
          if (response.status === 401) {
            // Session expired - will need re-auth
            throw new Error("Session expired");
          }
          throw new Error(`Server error: ${response.status}`);
        }

        const result = await response.json();
        await markDesignSynced(design.id, result.id, result.version || 1);
        await removeFromSyncQueue(item.id);
        return true;
      }

      case "update": {
        if (!design || !design.serverId) {
          // Design was deleted or never synced, skip
          await removeFromSyncQueue(item.id);
          return true;
        }

        // Check for conflicts first
        const checkResponse = await fetch(`/api/designs/${design.serverId}`, {
          method: "GET",
          signal: syncAbortController?.signal,
        });

        if (checkResponse.ok) {
          const serverDesign = await checkResponse.json();
          if (
            design.serverVersion !== null &&
            serverDesign.version > design.serverVersion
          ) {
            // Server has newer version - conflict!
            await markDesignConflict(design.id);
            notifyListeners({ type: "conflict", designId: design.id });
            return false; // Don't retry, needs user resolution
          }
        }

        const response = await fetch(`/api/designs/${design.serverId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
          signal: syncAbortController?.signal,
        });

        if (!response.ok) {
          if (response.status === 404) {
            // Design deleted on server
            notifyListeners({
              type: "error",
              designId: design.id,
              error: "Design was deleted on server",
            });
            // Mark conflict so user can decide to restore
            await markDesignConflict(design.id);
            return false;
          }
          if (response.status === 401) {
            throw new Error("Session expired");
          }
          if (response.status === 409) {
            // Conflict response from server
            await markDesignConflict(design.id);
            notifyListeners({ type: "conflict", designId: design.id });
            return false;
          }
          throw new Error(`Server error: ${response.status}`);
        }

        const result = await response.json();
        await markDesignSynced(design.id, design.serverId, result.version || 1);
        await removeFromSyncQueue(item.id);
        return true;
      }

      case "delete": {
        if (!design?.serverId) {
          // Never synced to server, just clean up
          if (design) {
            await purgeOfflineDesign(design.id);
          }
          await removeFromSyncQueue(item.id);
          return true;
        }

        const response = await fetch(`/api/designs/${design.serverId}`, {
          method: "DELETE",
          signal: syncAbortController?.signal,
        });

        if (!response.ok && response.status !== 404) {
          if (response.status === 401) {
            throw new Error("Session expired");
          }
          throw new Error(`Server error: ${response.status}`);
        }

        // Remove from local storage
        await purgeOfflineDesign(design.id);
        await removeFromSyncQueue(item.id);
        return true;
      }

      default:
        // Unknown operation, remove from queue
        await removeFromSyncQueue(item.id);
        return true;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      // Sync was cancelled
      return false;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Mark item as failed (will retry up to MAX_RETRIES)
    const updated = await markItemFailed(item.id, errorMessage);

    if (updated?.status === "failed") {
      // Max retries reached
      await markDesignError(item.designId);
      notifyListeners({
        type: "error",
        designId: item.designId,
        error: errorMessage,
      });
    }

    return false;
  }
}

// Process the sync queue
export async function processQueue(): Promise<void> {
  if (isSyncing || !isOnline()) return;

  isSyncing = true;
  syncAbortController = new AbortController();
  notifyListeners({ type: "start" });

  try {
    let processed = 0;
    let item = await getNextPendingItem();

    while (item && !syncAbortController.signal.aborted) {
      await markItemProcessing(item.id);

      const success = await processSyncItem(item);

      if (success) {
        processed++;
        const pending = await getPendingCount();
        notifyListeners({ type: "progress", pending });
      } else {
        // Apply backoff delay before next item
        const delay = BACKOFF_DELAYS[Math.min(item.retryCount, BACKOFF_DELAYS.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      item = await getNextPendingItem();
    }

    await setLastSyncTime(Date.now());
    notifyListeners({ type: "complete", pending: await getPendingCount() });
  } finally {
    isSyncing = false;
    syncAbortController = null;
  }
}

// Stop any ongoing sync
export function cancelSync(): void {
  syncAbortController?.abort();
}

// Check if currently syncing
export function getIsSyncing(): boolean {
  return isSyncing;
}

// Try to register background sync (if supported)
export async function registerBackgroundSync(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    if ("sync" in registration) {
      // @ts-expect-error - Background Sync API types not in standard lib
      await registration.sync.register("sync-designs");
      return true;
    }
  } catch (error) {
    console.warn("Background sync registration failed:", error);
  }

  return false;
}

// Initialize sync manager - call on app startup
export function initSyncManager(): () => void {
  // Listen for online/offline events
  const handleOnline = () => {
    console.log("Back online - starting sync");
    processQueue();
  };

  const handleOffline = () => {
    console.log("Went offline - cancelling sync");
    cancelSync();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Start sync if online and have pending items
    if (isOnline()) {
      getPendingCount().then((count) => {
        if (count > 0) {
          processQueue();
        }
      });
    }

    // Return cleanup function
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      cancelSync();
    };
  }

  return () => {};
}

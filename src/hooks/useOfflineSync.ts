"use client";

import { useState, useEffect, useCallback } from "react";
import {
  addSyncListener,
  processQueue,
  getIsSyncing,
  getLastSyncTime,
  isOnline,
  initSyncManager,
} from "@/lib/offline/syncManager";
import { getPendingCount, getQueueStats } from "@/lib/offline/syncQueue";
import { getDesignSyncCounts } from "@/lib/offline/designStore";
import { useOnlineStatus } from "./useOnlineStatus";

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  lastSyncTime: number | null;
  conflictCount: number;
}

export function useOfflineSync() {
  const online = useOnlineStatus();
  const [state, setState] = useState<SyncState>({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    failedCount: 0,
    lastSyncTime: null,
    conflictCount: 0,
  });

  // Refresh state from IndexedDB
  const refreshState = useCallback(async () => {
    try {
      const [queueStats, designCounts, lastSync] = await Promise.all([
        getQueueStats(),
        getDesignSyncCounts(),
        getLastSyncTime(),
      ]);

      setState((prev) => ({
        ...prev,
        isOnline: isOnline(),
        isSyncing: getIsSyncing(),
        pendingCount: queueStats.pending + queueStats.processing,
        failedCount: queueStats.failed,
        lastSyncTime: lastSync,
        conflictCount: designCounts.conflict,
      }));
    } catch (error) {
      console.error("Failed to refresh sync state:", error);
    }
  }, []);

  // Initialize sync manager and listeners
  useEffect(() => {
    // Initialize the sync manager
    const cleanup = initSyncManager();

    // Listen for sync events
    const unsubscribe = addSyncListener((event) => {
      switch (event.type) {
        case "start":
          setState((prev) => ({ ...prev, isSyncing: true }));
          break;
        case "complete":
          setState((prev) => ({
            ...prev,
            isSyncing: false,
            pendingCount: event.pending || 0,
          }));
          refreshState();
          break;
        case "error":
        case "conflict":
          refreshState();
          break;
        case "progress":
          setState((prev) => ({
            ...prev,
            pendingCount: event.pending || prev.pendingCount,
          }));
          break;
      }
    });

    // Initial state load
    refreshState();

    return () => {
      cleanup();
      unsubscribe();
    };
  }, [refreshState]);

  // Update online status when it changes
  useEffect(() => {
    setState((prev) => ({ ...prev, isOnline: online }));
  }, [online]);

  // Manually trigger sync
  const syncNow = useCallback(async () => {
    if (!online) return;
    await processQueue();
  }, [online]);

  return {
    ...state,
    syncNow,
    refreshState,
  };
}

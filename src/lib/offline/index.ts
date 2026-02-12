// Database and types
export {
  initDB,
  getDB,
  closeDB,
  clearAllData,
  getMetadata,
  setMetadata,
  deleteMetadata,
  isIndexedDBAvailable,
  type OfflineDesign,
  type SyncStatus,
  type SyncQueueItem,
  type SyncOperation,
} from "./db";

// Design store operations
export {
  createOfflineDesign,
  getOfflineDesign,
  getAllOfflineDesigns,
  getDesignsBySyncStatus,
  getDesignsNeedingSync,
  getDesignsByFolder,
  updateOfflineDesign,
  markDesignSynced,
  markDesignConflict,
  markDesignError,
  deleteOfflineDesign,
  purgeOfflineDesign,
  importDesignFromServer,
  getDesignSyncCounts,
  hasOfflineDesign,
  getLocalIdForServerId,
} from "./designStore";

// Sync queue operations
export {
  addToSyncQueue,
  getPendingSyncItems,
  getFailedSyncItems,
  getSyncItemsForDesign,
  markItemProcessing,
  removeFromSyncQueue,
  markItemFailed,
  retryFailedItem,
  getNextPendingItem,
  getQueueStats,
  clearSyncHistoryForDesign,
  clearAllFailedItems,
  hasPendingSyncs,
  getPendingCount,
  MAX_RETRIES,
} from "./syncQueue";

// Sync manager
export {
  addSyncListener,
  isOnline,
  getLastSyncTime,
  processQueue,
  cancelSync,
  getIsSyncing,
  registerBackgroundSync,
  initSyncManager,
} from "./syncManager";

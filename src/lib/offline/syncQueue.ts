import { getDB, type SyncQueueItem, type SyncOperation } from "./db";

export type { SyncQueueItem, SyncOperation };
import { v4 as uuidv4 } from "uuid";

// Maximum retry attempts before marking as failed
export const MAX_RETRIES = 5;

// Add an operation to the sync queue
export async function addToSyncQueue(
  operation: SyncOperation,
  designId: string,
  payload: object
): Promise<SyncQueueItem> {
  const db = await getDB();

  // Check for existing pending operation for this design
  const existingItems = await db.getAllFromIndex("syncQueue", "by-designId", designId);
  const pendingItem = existingItems.find((item) => item.status === "pending");

  if (pendingItem) {
    // Merge with existing pending operation
    if (operation === "delete") {
      // Delete supersedes all other operations
      const updated: SyncQueueItem = {
        ...pendingItem,
        operation: "delete",
        payload: {},
        timestamp: Date.now(),
      };
      await db.put("syncQueue", updated);
      return updated;
    }

    if (pendingItem.operation === "create" && operation === "update") {
      // Update after create - just update the create payload
      const updated: SyncQueueItem = {
        ...pendingItem,
        payload: { ...pendingItem.payload, ...payload },
        timestamp: Date.now(),
      };
      await db.put("syncQueue", updated);
      return updated;
    }

    if (pendingItem.operation === "update" && operation === "update") {
      // Merge updates
      const updated: SyncQueueItem = {
        ...pendingItem,
        payload: { ...pendingItem.payload, ...payload },
        timestamp: Date.now(),
      };
      await db.put("syncQueue", updated);
      return updated;
    }
  }

  // Create new queue item
  const newItem: SyncQueueItem = {
    id: uuidv4(),
    operation,
    designId,
    timestamp: Date.now(),
    payload,
    retryCount: 0,
    lastError: null,
    status: "pending",
  };

  await db.put("syncQueue", newItem);
  return newItem;
}

// Get all pending sync items (oldest first)
export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  const items = await db.getAllFromIndex("syncQueue", "by-status", "pending");
  // Sort by timestamp (oldest first)
  return items.sort((a, b) => a.timestamp - b.timestamp);
}

// Get all failed sync items
export async function getFailedSyncItems(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAllFromIndex("syncQueue", "by-status", "failed");
}

// Get sync items for a specific design
export async function getSyncItemsForDesign(designId: string): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAllFromIndex("syncQueue", "by-designId", designId);
}

// Mark an item as processing
export async function markItemProcessing(itemId: string): Promise<SyncQueueItem | null> {
  const db = await getDB();
  const item = await db.get("syncQueue", itemId);
  if (!item) return null;

  const updated: SyncQueueItem = {
    ...item,
    status: "processing",
  };

  await db.put("syncQueue", updated);
  return updated;
}

// Mark an item as completed (remove from queue)
export async function removeFromSyncQueue(itemId: string): Promise<boolean> {
  const db = await getDB();
  const item = await db.get("syncQueue", itemId);
  if (!item) return false;

  await db.delete("syncQueue", itemId);
  return true;
}

// Mark an item as failed with error
export async function markItemFailed(itemId: string, error: string): Promise<SyncQueueItem | null> {
  const db = await getDB();
  const item = await db.get("syncQueue", itemId);
  if (!item) return null;

  const newRetryCount = item.retryCount + 1;
  const updated: SyncQueueItem = {
    ...item,
    retryCount: newRetryCount,
    lastError: error,
    status: newRetryCount >= MAX_RETRIES ? "failed" : "pending",
  };

  await db.put("syncQueue", updated);
  return updated;
}

// Retry a failed item
export async function retryFailedItem(itemId: string): Promise<SyncQueueItem | null> {
  const db = await getDB();
  const item = await db.get("syncQueue", itemId);
  if (!item) return null;

  const updated: SyncQueueItem = {
    ...item,
    status: "pending",
    retryCount: 0,
    lastError: null,
    timestamp: Date.now(), // Put at end of queue
  };

  await db.put("syncQueue", updated);
  return updated;
}

// Get the next pending item to process
export async function getNextPendingItem(): Promise<SyncQueueItem | null> {
  const pending = await getPendingSyncItems();
  return pending[0] || null;
}

// Get queue statistics
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  failed: number;
  total: number;
}> {
  const db = await getDB();
  const all = await db.getAll("syncQueue");

  const stats = {
    pending: 0,
    processing: 0,
    failed: 0,
    total: all.length,
  };

  for (const item of all) {
    if (item.status === "pending") stats.pending++;
    else if (item.status === "processing") stats.processing++;
    else if (item.status === "failed") stats.failed++;
  }

  return stats;
}

// Clear all completed/failed items for a design
export async function clearSyncHistoryForDesign(designId: string): Promise<number> {
  const db = await getDB();
  const items = await db.getAllFromIndex("syncQueue", "by-designId", designId);

  let cleared = 0;
  for (const item of items) {
    if (item.status === "failed") {
      await db.delete("syncQueue", item.id);
      cleared++;
    }
  }

  return cleared;
}

// Clear all failed items
export async function clearAllFailedItems(): Promise<number> {
  const db = await getDB();
  const failed = await db.getAllFromIndex("syncQueue", "by-status", "failed");

  for (const item of failed) {
    await db.delete("syncQueue", item.id);
  }

  return failed.length;
}

// Check if there are any pending syncs
export async function hasPendingSyncs(): Promise<boolean> {
  const stats = await getQueueStats();
  return stats.pending > 0 || stats.processing > 0;
}

// Get count of items needing attention (pending + failed)
export async function getPendingCount(): Promise<number> {
  const stats = await getQueueStats();
  return stats.pending + stats.processing;
}

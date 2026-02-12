import { openDB, IDBPDatabase } from "idb";

// Schema version - increment when changing structure
const DB_VERSION = 1;
const DB_NAME = "modern-mesh-offline";

// Design sync status
export type SyncStatus = "synced" | "pending" | "conflict" | "error";

// Offline design record
export interface OfflineDesign {
  id: string; // Local UUID or server ID
  serverId: string | null; // null if created offline
  name: string;
  pixelData: Uint8Array; // pako-compressed
  widthInches: number;
  heightInches: number;
  meshCount: number;
  totalSold: number;
  kitsReady: number;
  canvasPrinted: number;
  previewImageUrl: string | null;
  isDraft: boolean;
  folderId: string | null;
  tags: string[]; // Tag IDs
  // Offline metadata
  lastModifiedLocal: number; // timestamp
  lastSyncedAt: number | null; // timestamp
  syncStatus: SyncStatus;
  version: number; // for conflict detection
  serverVersion: number | null; // last known server version
}

// Sync queue operation types
export type SyncOperation = "create" | "update" | "delete";

// Sync queue item
export interface SyncQueueItem {
  id: string; // UUID
  operation: SyncOperation;
  designId: string;
  timestamp: number;
  payload: object; // Data to send to server
  retryCount: number;
  lastError: string | null;
  status: "pending" | "processing" | "failed";
}

// Metadata store for app-level offline data
export interface OfflineMetadata {
  key: string;
  value: string | number | boolean | object;
}

// IndexedDB schema definition
interface ModernMeshDB {
  designs: {
    key: string;
    value: OfflineDesign;
    indexes: {
      "by-serverId": string | null;
      "by-syncStatus": SyncStatus;
      "by-lastModified": number;
      "by-folderId": string | null;
    };
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
    indexes: {
      "by-designId": string;
      "by-timestamp": number;
      "by-status": string;
    };
  };
  metadata: {
    key: string;
    value: OfflineMetadata;
  };
}

// Singleton database instance
let dbInstance: IDBPDatabase<ModernMeshDB> | null = null;

// Initialize the database
export async function initDB(): Promise<IDBPDatabase<ModernMeshDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<ModernMeshDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      // Handle migrations based on version
      if (oldVersion < 1) {
        // Initial schema - version 1

        // Designs store
        const designStore = db.createObjectStore("designs", { keyPath: "id" });
        designStore.createIndex("by-serverId", "serverId");
        designStore.createIndex("by-syncStatus", "syncStatus");
        designStore.createIndex("by-lastModified", "lastModifiedLocal");
        designStore.createIndex("by-folderId", "folderId");

        // Sync queue store
        const syncStore = db.createObjectStore("syncQueue", { keyPath: "id" });
        syncStore.createIndex("by-designId", "designId");
        syncStore.createIndex("by-timestamp", "timestamp");
        syncStore.createIndex("by-status", "status");

        // Metadata store
        db.createObjectStore("metadata", { keyPath: "key" });
      }

      // Future migrations would go here:
      // if (oldVersion < 2) { ... }
    },
    blocked() {
      console.warn("Database upgrade blocked - close other tabs");
    },
    blocking() {
      // Close connection so other tabs can upgrade
      dbInstance?.close();
      dbInstance = null;
    },
    terminated() {
      dbInstance = null;
    },
  });

  return dbInstance;
}

// Get the database instance (initializes if needed)
export async function getDB(): Promise<IDBPDatabase<ModernMeshDB>> {
  if (!dbInstance) {
    return initDB();
  }
  return dbInstance;
}

// Close the database connection
export async function closeDB(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// Clear all data (for testing/reset)
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["designs", "syncQueue", "metadata"], "readwrite");
  await Promise.all([
    tx.objectStore("designs").clear(),
    tx.objectStore("syncQueue").clear(),
    tx.objectStore("metadata").clear(),
    tx.done,
  ]);
}

// Metadata helpers
export async function getMetadata<T = unknown>(key: string): Promise<T | null> {
  const db = await getDB();
  const item = await db.get("metadata", key);
  return item ? (item.value as T) : null;
}

export async function setMetadata(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put("metadata", { key, value: value as string | number | boolean | object });
}

export async function deleteMetadata(key: string): Promise<void> {
  const db = await getDB();
  await db.delete("metadata", key);
}

// Check if IndexedDB is available
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

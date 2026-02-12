import { getDB, OfflineDesign, SyncStatus } from "./db";
import { v4 as uuidv4 } from "uuid";

// Create a new offline design
export async function createOfflineDesign(
  design: Omit<OfflineDesign, "id" | "lastModifiedLocal" | "lastSyncedAt" | "syncStatus" | "version" | "serverVersion">
): Promise<OfflineDesign> {
  const db = await getDB();

  const newDesign: OfflineDesign = {
    ...design,
    id: uuidv4(),
    lastModifiedLocal: Date.now(),
    lastSyncedAt: null,
    syncStatus: "pending",
    version: 1,
    serverVersion: null,
  };

  await db.put("designs", newDesign);
  return newDesign;
}

// Get a design by ID (local or server ID)
export async function getOfflineDesign(id: string): Promise<OfflineDesign | null> {
  const db = await getDB();

  // Try direct lookup first
  let design = await db.get("designs", id);

  // If not found, try by server ID
  if (!design) {
    const designs = await db.getAllFromIndex("designs", "by-serverId", id);
    design = designs[0] || null;
  }

  return design || null;
}

// Get all offline designs
export async function getAllOfflineDesigns(): Promise<OfflineDesign[]> {
  const db = await getDB();
  return db.getAll("designs");
}

// Get designs by sync status
export async function getDesignsBySyncStatus(status: SyncStatus): Promise<OfflineDesign[]> {
  const db = await getDB();
  return db.getAllFromIndex("designs", "by-syncStatus", status);
}

// Get designs that need syncing (pending or error)
export async function getDesignsNeedingSync(): Promise<OfflineDesign[]> {
  const db = await getDB();
  const pending = await db.getAllFromIndex("designs", "by-syncStatus", "pending");
  const error = await db.getAllFromIndex("designs", "by-syncStatus", "error");
  return [...pending, ...error];
}

// Get designs by folder
export async function getDesignsByFolder(folderId: string | null): Promise<OfflineDesign[]> {
  const db = await getDB();
  return db.getAllFromIndex("designs", "by-folderId", folderId);
}

// Update an offline design
export async function updateOfflineDesign(
  id: string,
  updates: Partial<Omit<OfflineDesign, "id" | "lastModifiedLocal" | "version">>
): Promise<OfflineDesign | null> {
  const db = await getDB();

  const existing = await getOfflineDesign(id);
  if (!existing) return null;

  const updated: OfflineDesign = {
    ...existing,
    ...updates,
    lastModifiedLocal: Date.now(),
    version: existing.version + 1,
    syncStatus: "pending", // Mark as needing sync
  };

  await db.put("designs", updated);
  return updated;
}

// Mark a design as synced (called after successful server sync)
export async function markDesignSynced(
  localId: string,
  serverId: string,
  serverVersion: number
): Promise<OfflineDesign | null> {
  const db = await getDB();

  const existing = await db.get("designs", localId);
  if (!existing) return null;

  const updated: OfflineDesign = {
    ...existing,
    serverId,
    lastSyncedAt: Date.now(),
    syncStatus: "synced",
    serverVersion,
  };

  await db.put("designs", updated);
  return updated;
}

// Mark a design as having a conflict
export async function markDesignConflict(id: string): Promise<OfflineDesign | null> {
  const db = await getDB();

  const existing = await getOfflineDesign(id);
  if (!existing) return null;

  const updated: OfflineDesign = {
    ...existing,
    syncStatus: "conflict",
  };

  await db.put("designs", updated);
  return updated;
}

// Mark a design as having a sync error
export async function markDesignError(id: string): Promise<OfflineDesign | null> {
  const db = await getDB();

  const existing = await getOfflineDesign(id);
  if (!existing) return null;

  const updated: OfflineDesign = {
    ...existing,
    syncStatus: "error",
  };

  await db.put("designs", updated);
  return updated;
}

// Delete an offline design (soft delete by marking for sync)
export async function deleteOfflineDesign(id: string): Promise<boolean> {
  const db = await getDB();

  const existing = await getOfflineDesign(id);
  if (!existing) return false;

  // If never synced to server, just delete locally
  if (!existing.serverId) {
    await db.delete("designs", existing.id);
    return true;
  }

  // Otherwise mark as pending deletion (will be handled by sync queue)
  // The actual record stays until sync confirms deletion
  const updated: OfflineDesign = {
    ...existing,
    syncStatus: "pending",
    lastModifiedLocal: Date.now(),
  };

  await db.put("designs", updated);
  return true;
}

// Permanently remove a design from local storage
export async function purgeOfflineDesign(id: string): Promise<boolean> {
  const db = await getDB();
  const existing = await db.get("designs", id);
  if (!existing) return false;

  await db.delete("designs", id);
  return true;
}

// Import a design from server (for initial sync or refresh)
export async function importDesignFromServer(
  serverDesign: {
    id: string;
    name: string;
    pixelData: Uint8Array;
    widthInches: number;
    heightInches: number;
    meshCount: number;
    totalSold: number;
    kitsReady: number;
    canvasPrinted: number;
    previewImageUrl: string | null;
    isDraft: boolean;
    folderId: string | null;
    tags?: string[];
    version?: number;
  }
): Promise<OfflineDesign> {
  const db = await getDB();

  // Check if we already have this design locally
  const existing = await db.getAllFromIndex("designs", "by-serverId", serverDesign.id);
  const localDesign = existing[0];

  if (localDesign) {
    // Update existing local copy
    const updated: OfflineDesign = {
      ...localDesign,
      name: serverDesign.name,
      pixelData: serverDesign.pixelData,
      widthInches: serverDesign.widthInches,
      heightInches: serverDesign.heightInches,
      meshCount: serverDesign.meshCount,
      totalSold: serverDesign.totalSold,
      kitsReady: serverDesign.kitsReady,
      canvasPrinted: serverDesign.canvasPrinted,
      previewImageUrl: serverDesign.previewImageUrl,
      isDraft: serverDesign.isDraft,
      folderId: serverDesign.folderId,
      tags: serverDesign.tags || [],
      lastSyncedAt: Date.now(),
      syncStatus: "synced",
      serverVersion: serverDesign.version || 1,
    };

    await db.put("designs", updated);
    return updated;
  }

  // Create new local copy
  const newDesign: OfflineDesign = {
    id: uuidv4(),
    serverId: serverDesign.id,
    name: serverDesign.name,
    pixelData: serverDesign.pixelData,
    widthInches: serverDesign.widthInches,
    heightInches: serverDesign.heightInches,
    meshCount: serverDesign.meshCount,
    totalSold: serverDesign.totalSold,
    kitsReady: serverDesign.kitsReady,
    canvasPrinted: serverDesign.canvasPrinted,
    previewImageUrl: serverDesign.previewImageUrl,
    isDraft: serverDesign.isDraft,
    folderId: serverDesign.folderId,
    tags: serverDesign.tags || [],
    lastModifiedLocal: Date.now(),
    lastSyncedAt: Date.now(),
    syncStatus: "synced",
    version: serverDesign.version || 1,
    serverVersion: serverDesign.version || 1,
  };

  await db.put("designs", newDesign);
  return newDesign;
}

// Get design count by sync status
export async function getDesignSyncCounts(): Promise<Record<SyncStatus, number>> {
  const db = await getDB();
  const all = await db.getAll("designs") as OfflineDesign[];

  const counts: Record<SyncStatus, number> = {
    synced: 0,
    pending: 0,
    conflict: 0,
    error: 0,
  };

  for (const design of all) {
    const status = design.syncStatus as SyncStatus;
    counts[status]++;
  }

  return counts;
}

// Check if a design exists locally
export async function hasOfflineDesign(id: string): Promise<boolean> {
  const design = await getOfflineDesign(id);
  return design !== null;
}

// Get the local ID for a server ID
export async function getLocalIdForServerId(serverId: string): Promise<string | null> {
  const db = await getDB();
  const designs = await db.getAllFromIndex("designs", "by-serverId", serverId);
  return designs[0]?.id || null;
}

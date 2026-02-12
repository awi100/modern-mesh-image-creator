"use client";

import { useState, useEffect } from "react";
import { X, Download, Upload, Copy } from "lucide-react";
import { OfflineDesign, getDesignsBySyncStatus, markDesignSynced, purgeOfflineDesign } from "@/lib/offline";
import pako from "pako";

interface ConflictResolutionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onResolved: () => void;
}

interface ConflictInfo {
  localDesign: OfflineDesign;
  serverDesign: {
    id: string;
    name: string;
    previewImageUrl: string | null;
    updatedAt: string;
    version: number;
  } | null;
}

export function ConflictResolutionDialog({
  isOpen,
  onClose,
  onResolved,
}: ConflictResolutionDialogProps) {
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Load conflicts when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadConflicts();
    }
  }, [isOpen]);

  const loadConflicts = async () => {
    setLoading(true);
    try {
      const conflictDesigns = await getDesignsBySyncStatus("conflict");
      const conflictInfos: ConflictInfo[] = [];

      for (const design of conflictDesigns) {
        let serverDesign = null;

        // Fetch server version if we have a server ID
        if (design.serverId) {
          try {
            const response = await fetch(`/api/designs/${design.serverId}`);
            if (response.ok) {
              serverDesign = await response.json();
            }
          } catch (error) {
            console.error("Failed to fetch server design:", error);
          }
        }

        conflictInfos.push({
          localDesign: design,
          serverDesign,
        });
      }

      setConflicts(conflictInfos);
      setCurrentIndex(0);
    } catch (error) {
      console.error("Failed to load conflicts:", error);
    } finally {
      setLoading(false);
    }
  };

  const currentConflict = conflicts[currentIndex];

  const handleKeepLocal = async () => {
    if (!currentConflict || resolving) return;
    setResolving(true);

    try {
      const { localDesign } = currentConflict;

      // Decompress pixel data for server
      const decompressed = pako.inflate(localDesign.pixelData, { to: "string" });
      const base64 = btoa(String.fromCharCode(...localDesign.pixelData));

      // Send local version to server (overwrite)
      const response = await fetch(`/api/designs/${localDesign.serverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: localDesign.name,
          folderId: localDesign.folderId,
          isDraft: localDesign.isDraft,
          widthInches: localDesign.widthInches,
          heightInches: localDesign.heightInches,
          meshCount: localDesign.meshCount,
          pixelData: base64,
          previewImageUrl: localDesign.previewImageUrl,
          forceOverwrite: true, // Skip version check
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save local version to server");
      }

      const result = await response.json();

      // Mark as synced
      await markDesignSynced(localDesign.id, localDesign.serverId!, result.version || 1);

      moveToNext();
    } catch (error) {
      console.error("Failed to keep local:", error);
      alert("Failed to save your version. Please try again.");
    } finally {
      setResolving(false);
    }
  };

  const handleKeepServer = async () => {
    if (!currentConflict || resolving) return;
    setResolving(true);

    try {
      const { localDesign, serverDesign } = currentConflict;

      if (serverDesign) {
        // Fetch full server design data
        const response = await fetch(`/api/designs/${localDesign.serverId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch server design");
        }

        const fullServerDesign = await response.json();

        // Decompress and recompress server pixel data
        const decompressed = atob(fullServerDesign.pixelData);
        const bytes = new Uint8Array(decompressed.length);
        for (let i = 0; i < decompressed.length; i++) {
          bytes[i] = decompressed.charCodeAt(i);
        }

        // Update local with server data and mark synced
        await markDesignSynced(localDesign.id, serverDesign.id, serverDesign.version);
      } else {
        // Server design was deleted, remove local copy
        await purgeOfflineDesign(localDesign.id);
      }

      moveToNext();
    } catch (error) {
      console.error("Failed to keep server:", error);
      alert("Failed to update local copy. Please try again.");
    } finally {
      setResolving(false);
    }
  };

  const handleKeepBoth = async () => {
    if (!currentConflict || resolving) return;
    setResolving(true);

    try {
      const { localDesign } = currentConflict;

      // Compress pixel data for server
      const base64 = btoa(String.fromCharCode(...localDesign.pixelData));

      // Create a new design from local version
      const response = await fetch("/api/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${localDesign.name} (Copy)`,
          folderId: localDesign.folderId,
          isDraft: localDesign.isDraft,
          widthInches: localDesign.widthInches,
          heightInches: localDesign.heightInches,
          meshCount: localDesign.meshCount,
          pixelData: base64,
          previewImageUrl: localDesign.previewImageUrl,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create copy");
      }

      const newDesign = await response.json();

      // Mark original as synced with server version
      await markDesignSynced(
        localDesign.id,
        localDesign.serverId!,
        currentConflict.serverDesign?.version || 1
      );

      moveToNext();
    } catch (error) {
      console.error("Failed to keep both:", error);
      alert("Failed to create copy. Please try again.");
    } finally {
      setResolving(false);
    }
  };

  const moveToNext = () => {
    if (currentIndex < conflicts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // All conflicts resolved
      onResolved();
      onClose();
    }
  };

  const formatDate = (dateStr: string | number | null) => {
    if (!dateStr) return "Unknown";
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">
            Resolve Sync Conflict{conflicts.length > 1 ? `s (${currentIndex + 1}/${conflicts.length})` : ""}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : !currentConflict ? (
            <p className="text-center text-gray-500 py-8">No conflicts to resolve</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                This design has been modified both locally and on the server.
                Choose which version to keep:
              </p>

              {/* Side by side comparison */}
              <div className="grid grid-cols-2 gap-4">
                {/* Local version */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h3 className="font-medium mb-2 flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Your Version (Local)
                  </h3>
                  {currentConflict.localDesign.previewImageUrl ? (
                    <img
                      src={currentConflict.localDesign.previewImageUrl}
                      alt="Local preview"
                      className="w-full aspect-square object-contain bg-gray-50 dark:bg-gray-900 rounded mb-2"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-gray-50 dark:bg-gray-900 rounded mb-2 flex items-center justify-center text-gray-400">
                      No preview
                    </div>
                  )}
                  <p className="text-sm font-medium">{currentConflict.localDesign.name}</p>
                  <p className="text-xs text-gray-500">
                    Modified: {formatDate(currentConflict.localDesign.lastModifiedLocal)}
                  </p>
                </div>

                {/* Server version */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h3 className="font-medium mb-2 flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Server Version
                  </h3>
                  {currentConflict.serverDesign ? (
                    <>
                      {currentConflict.serverDesign.previewImageUrl ? (
                        <img
                          src={currentConflict.serverDesign.previewImageUrl}
                          alt="Server preview"
                          className="w-full aspect-square object-contain bg-gray-50 dark:bg-gray-900 rounded mb-2"
                        />
                      ) : (
                        <div className="w-full aspect-square bg-gray-50 dark:bg-gray-900 rounded mb-2 flex items-center justify-center text-gray-400">
                          No preview
                        </div>
                      )}
                      <p className="text-sm font-medium">{currentConflict.serverDesign.name}</p>
                      <p className="text-xs text-gray-500">
                        Modified: {formatDate(currentConflict.serverDesign.updatedAt)}
                      </p>
                    </>
                  ) : (
                    <div className="w-full aspect-square bg-red-50 dark:bg-red-900/20 rounded mb-2 flex items-center justify-center text-red-500">
                      Deleted on server
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {currentConflict && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleKeepServer}
              disabled={resolving}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Keep Server
            </button>
            <button
              onClick={handleKeepBoth}
              disabled={resolving || !currentConflict.serverDesign}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Keep Both
            </button>
            <button
              onClick={handleKeepLocal}
              disabled={resolving}
              className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Keep Mine
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

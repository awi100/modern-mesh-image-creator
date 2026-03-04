"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { Breadcrumb } from "@/components/Breadcrumb";

const SKEIN_YARDS = 27;

interface BackupColorInfo {
  dmcNumber: string;
  colorName: string;
  hex: string;
  inventorySkeins: number;
  inStock: boolean;
}

interface KitItem {
  dmcNumber: string;
  colorName: string;
  hex: string;
  stitchCount: number;
  skeinsNeeded: number;
  yardsWithoutBuffer: number;
  yardsWithBuffer: number;
  fullSkeins: number;
  bobbinYards: number;
  inventorySkeins: number;
  inStock: boolean;
  primaryInStock?: boolean;
  backup: BackupColorInfo | null;
}

interface Folder {
  id: string;
  name: string;
}

interface KitSummary {
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  stitchType: string;
  bufferPercent: number;
  kitsReady: number;
  canvasPrinted: number;
  totalColors: number;
  totalSkeins: number;
  allInStock: boolean;
  kitContents: KitItem[];
  folder: Folder | null;
}

interface GroupedKits {
  folderId: string | null;
  folderName: string;
  kits: KitSummary[];
}

interface ColorDesignUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  stitchCount: number;
  skeinsNeeded: number;
  yardsWithBuffer: number;
  fullSkeins: number;
  bobbinYards: number;
}

interface ColorUsage {
  dmcNumber: string;
  designs: ColorDesignUsage[];
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

// Calculate actual skeins needed for a given quantity, with smart bobbin handling
function calculateSkeinsForQuantity(kitContents: KitItem[], quantity: number): { totalSkeins: number; bobbinSavings: number } {
  let totalSkeins = 0;
  let naiveSkeins = 0;

  for (const item of kitContents) {
    const isBobbin = item.bobbinYards > 0 && item.fullSkeins === 0;
    naiveSkeins += item.skeinsNeeded * quantity;

    if (isBobbin) {
      const totalBobbinYards = item.bobbinYards * quantity;
      totalSkeins += Math.ceil(totalBobbinYards / SKEIN_YARDS);
    } else {
      totalSkeins += item.skeinsNeeded * quantity;
    }
  }

  return {
    totalSkeins,
    bobbinSavings: naiveSkeins - totalSkeins,
  };
}

export default function KitsPage() {
  const [expandedKit, setExpandedKit] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "in-stock" | "out-of-stock">("all");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string | null>>(new Set());
  const [updatingInventory, setUpdatingInventory] = useState<string | null>(null);
  const [assemblingKit, setAssemblingKit] = useState<KitSummary | null>(null);
  const [assemblyQuantity, setAssemblyQuantity] = useState(1);
  const [assemblyNote, setAssemblyNote] = useState("");
  const [isAssembling, setIsAssembling] = useState(false);
  const [pendingInventory, setPendingInventory] = useState<Record<string, string>>({});
  const [pendingKitsReady, setPendingKitsReady] = useState<Record<string, string>>({});
  const [updatingKitsReady, setUpdatingKitsReady] = useState<string | null>(null);
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

  // Track pending deltas for each color to handle rapid clicks
  // Key: "dmcNumber-meshCount", Value: accumulated delta not yet sent to server
  const pendingDeltasRef = useRef<Map<string, number>>(new Map());
  // Track which colors are currently being processed
  const processingRef = useRef<Set<string>>(new Set());

  // Use SWR for caching - data persists across navigations
  const { data: kits, isLoading: loading, mutate: mutateKits } = useSWR<KitSummary[]>("/api/kits", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  // Fetch color usage data to show which designs use each color
  const { data: colorUsage } = useSWR<ColorUsage[]>("/api/colors/usage", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  // Create a lookup map for color usage by DMC number
  const colorUsageMap = useMemo(() => {
    const map = new Map<string, ColorDesignUsage[]>();
    if (colorUsage) {
      for (const usage of colorUsage) {
        map.set(usage.dmcNumber, usage.designs);
      }
    }
    return map;
  }, [colorUsage]);

  // Process pending deltas for a specific color
  const processInventoryUpdate = useCallback(async (dmcNumber: string, meshCount: number) => {
    const key = `${dmcNumber}-${meshCount}`;

    // If already processing this color, skip (the current process will pick up accumulated delta)
    if (processingRef.current.has(key)) {
      return;
    }

    // Get the accumulated delta
    const delta = pendingDeltasRef.current.get(key) || 0;
    if (delta === 0) {
      return;
    }

    // Mark as processing and clear the pending delta
    processingRef.current.add(key);
    pendingDeltasRef.current.delete(key);

    const size = meshCount === 14 ? 5 : 8;
    setUpdatingInventory(key);

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, size, delta }),
      });

      if (!res.ok) {
        throw new Error("Failed to update inventory");
      }

      // Revalidate all inventory-related data
      mutate("/api/inventory?size=5");
      mutate("/api/inventory?size=8");
    } catch (error) {
      console.error("Error updating inventory:", error);
      // Revert by refetching
      mutateKits();
    } finally {
      setUpdatingInventory(null);
      processingRef.current.delete(key);

      // Check if more deltas accumulated while we were processing
      if (pendingDeltasRef.current.has(key)) {
        processInventoryUpdate(dmcNumber, meshCount);
      }
    }
  }, [mutateKits]);

  // Update inventory for a specific color - accumulates clicks and processes them
  const handleUpdateInventory = useCallback((dmcNumber: string, meshCount: number, delta: number) => {
    const key = `${dmcNumber}-${meshCount}`;

    // Immediately apply optimistic update to UI
    mutateKits((currentKits) => {
      if (!currentKits) return currentKits;
      return currentKits.map(kit => {
        if (kit.meshCount !== meshCount) return kit;
        return {
          ...kit,
          kitContents: kit.kitContents.map(item => {
            if (item.dmcNumber !== dmcNumber) return item;
            const newSkeins = Math.max(0, item.inventorySkeins + delta);
            return {
              ...item,
              inventorySkeins: newSkeins,
              inStock: newSkeins >= item.skeinsNeeded,
            };
          }),
          allInStock: kit.kitContents.every(item =>
            item.dmcNumber === dmcNumber
              ? Math.max(0, item.inventorySkeins + delta) >= item.skeinsNeeded
              : item.inStock
          ),
        };
      });
    }, false);

    // Accumulate the delta
    const currentDelta = pendingDeltasRef.current.get(key) || 0;
    pendingDeltasRef.current.set(key, currentDelta + delta);

    // Schedule processing after a short debounce
    // Use setTimeout to batch rapid clicks, but the processInventoryUpdate
    // will handle any clicks that come in while it's running
    setTimeout(() => {
      processInventoryUpdate(dmcNumber, meshCount);
    }, 150);
  }, [mutateKits, processInventoryUpdate]);

  // Set absolute inventory value for a color
  const handleSetInventory = useCallback((dmcNumber: string, meshCount: number, value: number) => {
    // Find current value from kits data
    let currentValue = 0;
    if (kits) {
      for (const kit of kits) {
        if (kit.meshCount === meshCount) {
          const item = kit.kitContents.find(i => i.dmcNumber === dmcNumber);
          if (item) {
            currentValue = item.inventorySkeins;
            break;
          }
        }
      }
    }

    const newVal = Math.max(0, value);
    const delta = newVal - currentValue;

    if (delta !== 0) {
      handleUpdateInventory(dmcNumber, meshCount, delta);
    }
    // Clear pending value
    const key = `${dmcNumber}-${meshCount}`;
    setPendingInventory((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }, [kits, handleUpdateInventory]);

  // Update kits ready count with delta
  const handleUpdateKitsReady = useCallback(async (designId: string, delta: number) => {
    // Optimistic update
    mutateKits((currentKits) => {
      if (!currentKits) return currentKits;
      return currentKits.map(kit => {
        if (kit.designId !== designId) return kit;
        return {
          ...kit,
          kitsReady: Math.max(0, kit.kitsReady + delta),
        };
      });
    }, false);

    setUpdatingKitsReady(designId);
    try {
      const res = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kitsReadyDelta: delta }),
      });

      if (!res.ok) {
        throw new Error("Failed to update kits ready");
      }
    } catch (error) {
      console.error("Error updating kits ready:", error);
      mutateKits();
    } finally {
      setUpdatingKitsReady(null);
    }
  }, [mutateKits]);

  // Set absolute kits ready value
  const handleSetKitsReady = useCallback(async (designId: string, value: number) => {
    const newVal = Math.max(0, value);

    // Optimistic update
    mutateKits((currentKits) => {
      if (!currentKits) return currentKits;
      return currentKits.map(kit => {
        if (kit.designId !== designId) return kit;
        return {
          ...kit,
          kitsReady: newVal,
        };
      });
    }, false);

    // Clear pending value
    setPendingKitsReady((prev) => { const next = { ...prev }; delete next[designId]; return next; });

    setUpdatingKitsReady(designId);
    try {
      const res = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kitsReady: newVal }),
      });

      if (!res.ok) {
        throw new Error("Failed to update kits ready");
      }
    } catch (error) {
      console.error("Error updating kits ready:", error);
      mutateKits();
    } finally {
      setUpdatingKitsReady(null);
    }
  }, [mutateKits]);

  // Handle kit assembly
  const handleAssembleKit = useCallback(async () => {
    if (!assemblingKit || isAssembling) return;

    setIsAssembling(true);
    try {
      const res = await fetch(`/api/designs/${assemblingKit.designId}/kit/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: assemblyNote || null, quantity: assemblyQuantity }),
      });

      if (res.ok) {
        // Optimistic update: increment kitsReady only
        // Note: Thread inventory is managed manually via the inventory page
        mutateKits((currentKits) => {
          if (!currentKits) return currentKits;
          return currentKits.map(kit => {
            if (kit.designId !== assemblingKit.designId) return kit;
            return {
              ...kit,
              kitsReady: kit.kitsReady + assemblyQuantity,
            };
          });
        }, false);

        // Close dialog and reset
        setAssemblingKit(null);
        setAssemblyQuantity(1);
        setAssemblyNote("");

        // Revalidate to ensure data is fresh
        mutateKits();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to assemble kits");
      }
    } catch (error) {
      console.error("Error assembling kit:", error);
      alert("Failed to assemble kit");
    }
    setIsAssembling(false);
  }, [assemblingKit, assemblyQuantity, assemblyNote, isAssembling, mutateKits]);

  const filteredKits = (kits || []).filter((kit) => {
    if (filter === "in-stock") return kit.allInStock;
    if (filter === "out-of-stock") return !kit.allInStock;
    return true;
  });

  // Group kits by folder/collection
  const groupedKits = useMemo(() => {
    const groups = new Map<string | null, GroupedKits>();

    for (const kit of filteredKits) {
      const folderId = kit.folder?.id || null;
      const folderName = kit.folder?.name || "Unfiled";

      if (!groups.has(folderId)) {
        groups.set(folderId, {
          folderId,
          folderName,
          kits: [],
        });
      }
      groups.get(folderId)!.kits.push(kit);
    }

    // Sort: folders first (alphabetically), then unfiled at the end
    const sorted = Array.from(groups.values()).sort((a, b) => {
      if (a.folderId === null) return 1;
      if (b.folderId === null) return -1;
      return a.folderName.localeCompare(b.folderName);
    });

    return sorted;
  }, [filteredKits]);

  const toggleFolder = (folderId: string | null) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white flex items-center gap-3">
          <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading kits...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-slate-400 hover:text-white"
              title="Home"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-white">All Kits</h1>
            <button
              onClick={() => mutateKits()}
              disabled={loading}
              className="p-1.5 text-slate-400 hover:text-white disabled:opacity-50"
              title="Refresh"
            >
              <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <span className="text-slate-400 text-sm">({filteredKits.length} designs)</span>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === "all"
                  ? "bg-slate-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("in-stock")}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === "in-stock"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              In Stock
            </button>
            <button
              onClick={() => setFilter("out-of-stock")}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === "out-of-stock"
                  ? "bg-red-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Out of Stock
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <Breadcrumb items={[{ label: "Kits" }]} className="mb-2" />

        {filteredKits.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No kits found.
          </div>
        ) : (
          groupedKits.map((group) => {
            const isCollapsed = collapsedFolders.has(group.folderId);
            const inStockCount = group.kits.filter((k) => k.allInStock).length;
            const outOfStockCount = group.kits.length - inStockCount;

            return (
              <div key={group.folderId || "unfiled"} className="space-y-3">
                {/* Collection Header */}
                <button
                  onClick={() => toggleFolder(group.folderId)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800/50 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
                >
                  <svg
                    className={`w-5 h-5 text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-slate-400">
                    {group.folderId ? "📁" : "📂"}
                  </span>
                  <h2 className="text-white font-semibold flex-1 text-left">{group.folderName}</h2>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-slate-400">{group.kits.length} kit{group.kits.length !== 1 ? "s" : ""}</span>
                    {inStockCount > 0 && (
                      <span className="text-emerald-400">{inStockCount} in stock</span>
                    )}
                    {outOfStockCount > 0 && (
                      <span className="text-red-400">{outOfStockCount} need order</span>
                    )}
                  </div>
                </button>

                {/* Kits in this collection */}
                {!isCollapsed && (
                  <div className="space-y-3 pl-4 border-l-2 border-slate-700 ml-2">
                    {group.kits.map((kit) => (
                      <div
                        key={kit.designId}
                        className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden"
                      >
                        {/* Kit Header - Always visible */}
                        <div
                          className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-700/50 transition-colors"
                          onClick={() => setExpandedKit(expandedKit === kit.designId ? null : kit.designId)}
                        >
                          {/* Preview image - clickable link to design */}
                          <Link
                            href={`/design/${kit.designId}/info`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0"
                          >
                            {kit.previewImageUrl ? (
                              <img
                                src={kit.previewImageUrl}
                                alt={kit.designName}
                                className="w-16 h-16 object-cover rounded-lg hover:ring-2 hover:ring-rose-500 transition-all"
                              />
                            ) : (
                              <div className="w-16 h-16 bg-slate-700 rounded-lg flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all">
                                <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </Link>

                          {/* Design info */}
                          <div className="flex-1 min-w-0">
                            <Link
                              href={`/design/${kit.designId}/info`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-white font-semibold truncate hover:text-rose-400 transition-colors block"
                            >
                              {kit.designName}
                            </Link>
                            <p className="text-slate-400 text-sm">
                              {kit.widthInches}" x {kit.heightInches}" @ {kit.meshCount} mesh
                              &middot; {kit.stitchType} + {kit.bufferPercent}% buffer
                            </p>
                          </div>

                          {/* Quick stats */}
                          <div className="flex items-center gap-4 flex-shrink-0">
                            <div className="text-center hidden sm:block">
                              <p className="text-lg font-bold text-white">{kit.totalColors}</p>
                              <p className="text-xs text-slate-400">Colors</p>
                            </div>
                            <div className="text-center hidden sm:block">
                              <p className="text-lg font-bold text-white">{kit.totalSkeins}</p>
                              <p className="text-xs text-slate-400">Skeins</p>
                            </div>
                            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                              kit.allInStock
                                ? "bg-emerald-900/50 text-emerald-400"
                                : "bg-red-900/50 text-red-400"
                            }`}>
                              {kit.allInStock ? "In Stock" : "Out of Stock"}
                            </div>
                            {/* Kits ready with editable input */}
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => handleUpdateKitsReady(kit.designId, -1)}
                                disabled={updatingKitsReady === kit.designId || kit.kitsReady <= 0}
                                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Remove 1 kit"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                              </button>
                              <div className="text-center">
                                <input
                                  type="number"
                                  min="0"
                                  value={pendingKitsReady[kit.designId] ?? kit.kitsReady}
                                  onChange={(e) => {
                                    setPendingKitsReady((prev) => ({ ...prev, [kit.designId]: e.target.value }));
                                  }}
                                  onBlur={() => {
                                    const val = pendingKitsReady[kit.designId];
                                    if (val !== undefined) {
                                      handleSetKitsReady(kit.designId, Number(val));
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const val = pendingKitsReady[kit.designId];
                                      if (val !== undefined) {
                                        handleSetKitsReady(kit.designId, Number(val));
                                      }
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-12 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-lg text-center font-bold text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                                />
                                <p className="text-xs text-slate-400">Ready</p>
                              </div>
                              <button
                                onClick={() => handleUpdateKitsReady(kit.designId, 1)}
                                disabled={updatingKitsReady === kit.designId}
                                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Add 1 kit"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* Expand icon */}
                          <svg
                            className={`w-5 h-5 text-slate-400 transition-transform ${
                              expandedKit === kit.designId ? "rotate-180" : ""
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        {/* Expanded kit contents */}
                        {expandedKit === kit.designId && (
                          <div className="border-t border-slate-700">
                            {/* Color list with amounts */}
                            <div className="p-4 bg-slate-700/30">
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                {kit.kitContents.map((item) => {
                                  const inventoryKey = `${item.dmcNumber}-${kit.meshCount}`;
                                  const isUpdating = updatingInventory === inventoryKey;
                                  const colorUsageKey = `${kit.designId}-${item.dmcNumber}`;
                                  const isColorExpanded = expandedColors.has(colorUsageKey);
                                  // Get other designs using this color (excluding current design)
                                  const otherDesigns = (colorUsageMap.get(item.dmcNumber) || []).filter(
                                    (d) => d.id !== kit.designId
                                  );
                                  return (
                                    <div
                                      key={item.dmcNumber}
                                      className={`rounded-lg bg-slate-800/50 ${
                                        !item.inStock ? "ring-1 ring-red-500" : ""
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 p-2">
                                        <Link
                                          href={`/inventory/color/${item.dmcNumber}`}
                                          className="w-8 h-8 rounded flex-shrink-0 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all"
                                          style={{ backgroundColor: item.hex }}
                                          title={`View DMC ${item.dmcNumber} inventory`}
                                        >
                                          <span
                                            className="text-[7px] font-bold"
                                            style={{ color: getContrastTextColor(item.hex) }}
                                          >
                                            {item.dmcNumber}
                                          </span>
                                        </Link>
                                        <div className="min-w-0 flex-1">
                                          <Link
                                            href={`/inventory/color/${item.dmcNumber}`}
                                            className="text-white text-xs font-medium truncate hover:text-rose-400 transition-colors block"
                                          >
                                            {item.dmcNumber}
                                          </Link>
                                          <p className={`text-xs ${item.bobbinYards > 0 ? "text-amber-400" : "text-slate-400"}`}>
                                            {item.fullSkeins > 0
                                              ? `Need ${item.fullSkeins} skein${item.fullSkeins > 1 ? "s" : ""}`
                                              : `${item.bobbinYards} yd bobbin`
                                            }
                                          </p>
                                        </div>
                                        {/* Inventory with +/- buttons and editable input */}
                                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                          <div className="flex items-center gap-1">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleUpdateInventory(item.dmcNumber, kit.meshCount, -1);
                                              }}
                                              disabled={isUpdating || item.inventorySkeins <= 0}
                                              className="p-0.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                              title="Remove 1"
                                            >
                                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                              </svg>
                                            </button>
                                            <input
                                              type="number"
                                              min="0"
                                              value={pendingInventory[`${item.dmcNumber}-${kit.meshCount}`] ?? item.inventorySkeins}
                                              onClick={(e) => e.stopPropagation()}
                                              onChange={(e) => {
                                                const key = `${item.dmcNumber}-${kit.meshCount}`;
                                                setPendingInventory((prev) => ({ ...prev, [key]: e.target.value }));
                                              }}
                                              onBlur={() => {
                                                const key = `${item.dmcNumber}-${kit.meshCount}`;
                                                const val = pendingInventory[key];
                                                if (val !== undefined) {
                                                  handleSetInventory(item.dmcNumber, kit.meshCount, Number(val));
                                                }
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                  const key = `${item.dmcNumber}-${kit.meshCount}`;
                                                  const val = pendingInventory[key];
                                                  if (val !== undefined) {
                                                    handleSetInventory(item.dmcNumber, kit.meshCount, Number(val));
                                                  }
                                                  (e.target as HTMLInputElement).blur();
                                                }
                                              }}
                                              className={`w-12 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600 ${item.primaryInStock !== false ? "text-emerald-400" : "text-red-400"}`}
                                            />
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleUpdateInventory(item.dmcNumber, kit.meshCount, 1);
                                              }}
                                              disabled={isUpdating}
                                              className="p-0.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                              title="Add 1"
                                            >
                                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                              </svg>
                                            </button>
                                          </div>
                                          {/* Backup color indicator */}
                                          {item.backup && (
                                            <Link
                                              href={`/inventory/color/${item.backup.dmcNumber}`}
                                              onClick={(e) => e.stopPropagation()}
                                              className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-800/50 hover:bg-amber-900/50 transition-colors"
                                              title={`Backup: ${item.backup.colorName}`}
                                            >
                                              <span
                                                className="w-6 h-6 rounded flex items-center justify-center border border-white/20"
                                                style={{ backgroundColor: item.backup.hex }}
                                              >
                                                <span
                                                  className="text-[7px] font-bold"
                                                  style={{ color: getContrastTextColor(item.backup.hex) }}
                                                >
                                                  {item.backup.dmcNumber}
                                                </span>
                                              </span>
                                              <span className={`text-[10px] font-medium ${item.backup.inStock ? "text-emerald-400" : "text-red-400"}`}>
                                                {item.backup.inventorySkeins} sk
                                              </span>
                                            </Link>
                                          )}
                                        </div>
                                      </div>
                                      {/* Color usage indicator */}
                                      {otherDesigns.length > 0 ? (
                                        <>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedColors((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(colorUsageKey)) {
                                                  next.delete(colorUsageKey);
                                                } else {
                                                  next.add(colorUsageKey);
                                                }
                                                return next;
                                              });
                                            }}
                                            className="w-full px-2 py-1 text-[10px] text-slate-400 hover:text-slate-300 hover:bg-slate-700/50 flex items-center justify-center gap-1 border-t border-slate-700/50"
                                          >
                                            <span>Used in {otherDesigns.length} other design{otherDesigns.length !== 1 ? "s" : ""}</span>
                                            <svg
                                              className={`w-3 h-3 transition-transform ${isColorExpanded ? "rotate-180" : ""}`}
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke="currentColor"
                                            >
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                          </button>
                                          {isColorExpanded && (
                                            <div className="px-2 pb-2 border-t border-slate-700/50 space-y-1 max-h-32 overflow-y-auto">
                                              {otherDesigns.map((design) => (
                                                <Link
                                                  key={design.id}
                                                  href={`/design/${design.id}/kit`}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="flex items-center gap-2 p-1.5 rounded bg-slate-700/30 hover:bg-slate-700/60 transition-colors"
                                                >
                                                  {design.previewImageUrl ? (
                                                    <img
                                                      src={design.previewImageUrl}
                                                      alt={design.name}
                                                      className="w-6 h-6 object-cover rounded"
                                                    />
                                                  ) : (
                                                    <div className="w-6 h-6 bg-slate-600 rounded flex items-center justify-center">
                                                      <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                      </svg>
                                                    </div>
                                                  )}
                                                  <div className="min-w-0 flex-1">
                                                    <p className="text-[10px] text-white truncate">{design.name}</p>
                                                    <p className="text-[9px] text-slate-400">
                                                      {design.bobbinYards > 0 && design.fullSkeins === 0
                                                        ? `${design.bobbinYards} yd`
                                                        : `${design.fullSkeins} sk`}
                                                    </p>
                                                  </div>
                                                </Link>
                                              ))}
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        <div className="w-full px-2 py-1 text-[10px] text-slate-500 flex items-center justify-center border-t border-slate-700/50">
                                          <span>Only in this design</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="p-4 flex items-center justify-between border-t border-slate-700/50">
                              <div className="text-sm text-slate-400">
                                {kit.kitContents.filter(i => !i.inStock).length > 0 && (
                                  <span className="text-red-400">
                                    {kit.kitContents.filter(i => !i.inStock).length} color(s) out of stock
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Link
                                  href={`/design/${kit.designId}`}
                                  className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
                                >
                                  Edit Design
                                </Link>
                                <Link
                                  href={`/design/${kit.designId}/kit`}
                                  className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
                                >
                                  Full Kit View
                                </Link>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAssemblingKit(kit);
                                  }}
                                  className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-lg hover:from-emerald-700 hover:to-emerald-800 text-sm font-medium flex items-center gap-2"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                  </svg>
                                  Assemble Kit
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Assembly Dialog */}
      {assemblingKit && (() => {
        const calc = calculateSkeinsForQuantity(assemblingKit.kitContents, assemblyQuantity);
        const bobbinCount = assemblingKit.kitContents.filter(i => i.bobbinYards > 0 && i.fullSkeins === 0).length;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="p-4 border-b border-slate-700 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">Assemble Kit</h3>
                <p className="text-sm text-slate-400">{assemblingKit.designName}</p>
              </div>

              {/* Content - scrollable */}
              <div className="p-4 overflow-y-auto flex-1 space-y-4">
                {/* Quantity selector */}
                <div>
                  <label className="text-sm text-slate-400 block mb-2">How many kits?</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setAssemblyQuantity(Math.max(1, assemblyQuantity - 1))}
                      className="w-10 h-10 bg-slate-700 text-white rounded-lg hover:bg-slate-600 flex items-center justify-center text-lg font-bold"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={assemblyQuantity}
                      onChange={(e) => setAssemblyQuantity(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                      className="w-20 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-center text-lg font-bold focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <button
                      onClick={() => setAssemblyQuantity(Math.min(100, assemblyQuantity + 1))}
                      className="w-10 h-10 bg-slate-700 text-white rounded-lg hover:bg-slate-600 flex items-center justify-center text-lg font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Summary */}
                <div className="p-3 bg-slate-700/50 rounded-lg">
                  <p className="text-white text-sm">
                    <span className="font-medium">{assemblyQuantity} {assemblyQuantity === 1 ? "kit" : "kits"}</span>
                    {" "}&rarr;{" "}
                    <span className="font-bold text-emerald-400">{calc.totalSkeins} {calc.totalSkeins === 1 ? "skein" : "skeins"}</span>
                    {" "}to deduct ({assemblingKit.totalColors} colors)
                  </p>
                  {calc.bobbinSavings > 0 && (
                    <p className="text-emerald-400 text-xs mt-1">
                      Saving {calc.bobbinSavings} {calc.bobbinSavings === 1 ? "skein" : "skeins"} by combining bobbins!
                    </p>
                  )}
                  {bobbinCount > 0 && (
                    <p className="text-amber-500 text-xs mt-1">
                      {bobbinCount} {bobbinCount === 1 ? "color uses" : "colors use"} bobbins
                    </p>
                  )}
                </div>

                {!assemblingKit.allInStock && (
                  <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
                    <p className="text-yellow-400 text-sm">
                      Some colors are not fully in stock. Assembling will create negative inventory.
                    </p>
                  </div>
                )}

                {/* Thread list */}
                <div>
                  <p className="text-sm text-slate-400 mb-2">Threads needed per kit:</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                    {assemblingKit.kitContents.map((item) => (
                      <div
                        key={item.dmcNumber}
                        className={`flex items-center gap-2 p-2 rounded-lg bg-slate-700/50 ${
                          !item.inStock ? "ring-1 ring-red-500/50" : ""
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded flex-shrink-0 flex items-center justify-center"
                          style={{ backgroundColor: item.hex }}
                        >
                          <span
                            className="text-[6px] font-bold"
                            style={{ color: getContrastTextColor(item.hex) }}
                          >
                            {item.dmcNumber}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-white text-xs font-medium truncate">{item.dmcNumber}</p>
                          <p className={`text-[10px] ${item.bobbinYards > 0 && item.fullSkeins === 0 ? "text-amber-400" : "text-slate-400"}`}>
                            {item.fullSkeins > 0
                              ? `${item.fullSkeins} sk`
                              : `${item.bobbinYards} yd`
                            }
                            <span className={`ml-1 ${item.inStock ? "text-emerald-400" : "text-red-400"}`}>
                              ({item.inventorySkeins})
                            </span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Note input */}
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Note (optional)</label>
                  <input
                    type="text"
                    value={assemblyNote}
                    onChange={(e) => setAssemblyNote(e.target.value)}
                    placeholder="e.g. Customer name or order #"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-slate-700 flex gap-3 flex-shrink-0">
                <button
                  onClick={() => {
                    setAssemblingKit(null);
                    setAssemblyQuantity(1);
                    setAssemblyNote("");
                  }}
                  className="flex-1 py-2 px-4 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssembleKit}
                  disabled={isAssembling}
                  className="flex-1 py-2 px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium"
                >
                  {isAssembling ? "Assembling..." : `Assemble ${assemblyQuantity} ${assemblyQuantity === 1 ? "Kit" : "Kits"}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

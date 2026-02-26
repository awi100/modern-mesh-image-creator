"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import type { OrdersResponse, Order, OrderItem } from "@/app/api/shopify/orders/route";
import { Breadcrumb } from "@/components/Breadcrumb";

// Kit content types
interface KitItem {
  dmcNumber: string;
  colorName: string;
  hex: string;
  skeinsNeeded: number;
  fullSkeins: number;
  bobbinYards: number;
  inventorySkeins: number;
  inStock: boolean;
}

interface KitData {
  designId: string;
  totalColors: number;
  totalSkeins: number;
  allInStock: boolean;
  kitContents: KitItem[];
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

type FilterType = "all" | "canvases" | "kits" | "supplies";

// Calculate aggregated demand per design across all orders (only for canvas items)
function calculateDemandByDesign(orders: Order[]) {
  const demand = new Map<string, { totalKitsNeeded: number; totalCanvasesNeeded: number }>();

  for (const order of orders) {
    for (const item of order.items) {
      if (!item.designId || item.itemType !== "canvas") continue;

      const existing = demand.get(item.designId) || { totalKitsNeeded: 0, totalCanvasesNeeded: 0 };
      if (item.needsKit) {
        existing.totalKitsNeeded += item.quantity;
      }
      existing.totalCanvasesNeeded += item.quantity;
      demand.set(item.designId, existing);
    }
  }

  return demand;
}

export default function OrdersPage() {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [updating, setUpdating] = useState<string | null>(null); // Track which design is being updated
  const [fulfilling, setFulfilling] = useState<string | null>(null); // Track which order is being fulfilled

  // Track pending values being typed
  const [pendingKits, setPendingKits] = useState<Record<string, string>>({});
  const [pendingCanvases, setPendingCanvases] = useState<Record<string, string>>({});
  const [pendingInventory, setPendingInventory] = useState<Record<string, string>>({});
  const [updatingInventory, setUpdatingInventory] = useState<string | null>(null);

  // Kit data for showing what's needed to make each kit
  const [kitData, setKitData] = useState<Map<string, KitData>>(new Map());
  const [loadingKits, setLoadingKits] = useState(false);
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());

  // Use refs for debounced updates to handle rapid clicks
  const pendingUpdates = useRef<Map<string, { field: "kitsReady" | "canvasPrinted"; delta: number; timeout: NodeJS.Timeout }>>(new Map());
  const inFlightRequests = useRef<Set<string>>(new Set());

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/orders");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch orders");
      }
      const json: OrdersResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
  }, []);

  // Fetch kit data for showing kit contents
  const fetchKits = useCallback(async () => {
    if (kitData.size > 0) return; // Already loaded
    setLoadingKits(true);
    try {
      const res = await fetch("/api/kits");
      if (res.ok) {
        const kits = await res.json();
        const kitMap = new Map<string, KitData>();
        for (const kit of kits) {
          kitMap.set(kit.designId, {
            designId: kit.designId,
            totalColors: kit.totalColors,
            totalSkeins: kit.totalSkeins,
            allInStock: kit.allInStock,
            kitContents: kit.kitContents,
          });
        }
        setKitData(kitMap);
      }
    } catch (err) {
      console.error("Failed to fetch kit data:", err);
    }
    setLoadingKits(false);
  }, [kitData.size]);

  // Toggle expanded kit view
  const toggleKitExpanded = useCallback((designId: string) => {
    setExpandedKits(prev => {
      const next = new Set(prev);
      if (next.has(designId)) {
        next.delete(designId);
      } else {
        next.add(designId);
        // Fetch kit data if not already loaded
        if (kitData.size === 0) {
          fetchKits();
        }
      }
      return next;
    });
  }, [kitData.size, fetchKits]);

  // Fulfill an order - deduct kits, canvases, and supplies
  const handleFulfillOrder = useCallback(async (order: Order) => {
    setFulfilling(order.shopifyOrderId);
    setError(null);

    try {
      // Prepare items for fulfillment (both designs and supplies)
      const items = order.items
        .filter(item => item.designId || item.supplyId) // Items with matching designs or supplies
        .map(item => ({
          designId: item.designId || undefined,
          supplyId: item.supplyId || undefined,
          quantity: item.quantity,
          needsKit: item.needsKit,
        }));

      if (items.length === 0) {
        setError("No items with matching designs or supplies to fulfill");
        setFulfilling(null);
        return;
      }

      const res = await fetch("/api/shopify/orders/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fulfill order");
      }

      // Remove the fulfilled order from the list
      setData(prevData => {
        if (!prevData) return prevData;
        return {
          ...prevData,
          orders: prevData.orders.filter(o => o.shopifyOrderId !== order.shopifyOrderId),
          summary: {
            ...prevData.summary,
            totalOrders: prevData.summary.totalOrders - 1,
            totalKitsNeeded: prevData.summary.totalKitsNeeded - order.items.reduce((sum, item) => sum + (item.needsKit ? item.quantity : 0), 0),
            totalCanvasesNeeded: prevData.summary.totalCanvasesNeeded - order.items.reduce((sum, item) => sum + item.quantity, 0),
          },
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fulfill failed");
    }
    setFulfilling(null);
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Send the actual API request for a design update
  const sendUpdate = useCallback(async (designId: string, field: "kitsReady" | "canvasPrinted", totalDelta: number) => {
    // Mark as in-flight
    inFlightRequests.current.add(`${designId}-${field}`);
    setUpdating(designId);

    try {
      const body = field === "kitsReady"
        ? { kitsReadyDelta: totalDelta }
        : { canvasPrintedDelta: totalDelta };

      const res = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error("Failed to update");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      // Revert by refetching
      await fetchOrders();
    } finally {
      inFlightRequests.current.delete(`${designId}-${field}`);
      setUpdating(null);
    }
  }, [fetchOrders]);

  // Update design kitsReady or canvasPrinted count with optimistic updates and debouncing
  const handleUpdateCount = useCallback((designId: string, field: "kitsReady" | "canvasPrinted", delta: number) => {
    const key = `${designId}-${field}`;

    // Immediately apply optimistic update to UI
    setData(prevData => {
      if (!prevData) return prevData;
      return {
        ...prevData,
        orders: prevData.orders.map(order => ({
          ...order,
          items: order.items.map(item => {
            if (item.designId !== designId) return item;
            if (field === "kitsReady") {
              return { ...item, kitsReady: Math.max(0, item.kitsReady + delta) };
            } else {
              return { ...item, canvasPrinted: Math.max(0, item.canvasPrinted + delta) };
            }
          }),
        })),
      };
    });

    // Check if there's already a pending update for this design+field
    const existing = pendingUpdates.current.get(key);
    if (existing) {
      // Accumulate the delta and reset the timer
      clearTimeout(existing.timeout);
      existing.delta += delta;
      existing.timeout = setTimeout(() => {
        const update = pendingUpdates.current.get(key);
        if (update && update.delta !== 0) {
          pendingUpdates.current.delete(key);
          sendUpdate(designId, field, update.delta);
        }
      }, 300); // 300ms debounce
    } else {
      // Create new pending update
      const timeout = setTimeout(() => {
        const update = pendingUpdates.current.get(key);
        if (update && update.delta !== 0) {
          pendingUpdates.current.delete(key);
          sendUpdate(designId, field, update.delta);
        }
      }, 300); // 300ms debounce

      pendingUpdates.current.set(key, { field, delta, timeout });
    }
  }, [sendUpdate]);

  // Set an absolute value for kitsReady or canvasPrinted
  const handleSetValue = useCallback((designId: string, field: "kitsReady" | "canvasPrinted", value: number) => {
    // Find current value from data
    let currentValue = 0;
    if (data) {
      for (const order of data.orders) {
        for (const item of order.items) {
          if (item.designId === designId) {
            currentValue = field === "kitsReady" ? item.kitsReady : item.canvasPrinted;
            break;
          }
        }
      }
    }

    const newVal = Math.max(0, value);
    const delta = newVal - currentValue;

    if (delta !== 0) {
      handleUpdateCount(designId, field, delta);
    }

    // Clear pending value
    if (field === "kitsReady") {
      setPendingKits((prev) => { const next = { ...prev }; delete next[designId]; return next; });
    } else {
      setPendingCanvases((prev) => { const next = { ...prev }; delete next[designId]; return next; });
    }
  }, [data, handleUpdateCount]);

  // Update thread inventory for a kit color
  const handleUpdateInventory = useCallback(async (dmcNumber: string, delta: number) => {
    if (updatingInventory === dmcNumber) return;

    setUpdatingInventory(dmcNumber);
    const size = 5; // Size 5 only in internal app (14 mesh)

    // Optimistic update in kitData
    setKitData(prevKitData => {
      const newMap = new Map(prevKitData);
      for (const [designId, kit] of newMap) {
        const updatedContents = kit.kitContents.map(item => {
          if (item.dmcNumber !== dmcNumber) return item;
          const newSkeins = Math.max(0, item.inventorySkeins + delta);
          return {
            ...item,
            inventorySkeins: newSkeins,
            inStock: newSkeins >= item.skeinsNeeded,
          };
        });
        newMap.set(designId, {
          ...kit,
          kitContents: updatedContents,
          allInStock: updatedContents.every(i => i.inStock),
        });
      }
      return newMap;
    });

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, size, delta }),
      });

      if (!res.ok) {
        throw new Error("Failed to update inventory");
      }
    } catch (error) {
      console.error("Error updating inventory:", error);
      // Revert by refetching kits
      fetchKits();
    }
    setUpdatingInventory(null);
  }, [updatingInventory, fetchKits]);

  // Set absolute inventory value for a kit color
  const handleSetInventory = useCallback(async (dmcNumber: string, value: number) => {
    // Find current value from kitData
    let currentValue = 0;
    for (const kit of kitData.values()) {
      const item = kit.kitContents.find(i => i.dmcNumber === dmcNumber);
      if (item) {
        currentValue = item.inventorySkeins;
        break;
      }
    }

    const newVal = Math.max(0, value);
    const delta = newVal - currentValue;

    if (delta !== 0) {
      await handleUpdateInventory(dmcNumber, delta);
    }
    // Clear pending value
    setPendingInventory((prev) => { const next = { ...prev }; delete next[dmcNumber]; return next; });
  }, [kitData, handleUpdateInventory]);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </Link>
            <h1 className="text-lg md:text-xl font-bold text-white">Orders</h1>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/shopify"
              className="px-2 md:px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-xs md:text-sm"
            >
              Products
            </Link>
            <button
              onClick={fetchOrders}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-white disabled:opacity-50"
              title="Refresh"
            >
              <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Breadcrumb items={[{ label: "Orders" }]} className="mb-2" />

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-400 flex items-center gap-3">
              <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading orders from Shopify...
            </div>
          </div>
        )}

        {/* Summary */}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-3xl font-bold text-white">{data.summary.totalOrders}</p>
                <p className="text-sm text-slate-400">Unfulfilled Orders</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-3xl font-bold text-blue-400">{data.summary.totalCanvasesNeeded}</p>
                <p className="text-sm text-slate-400">Canvases</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-3xl font-bold text-amber-400">{data.summary.totalKitsNeeded}</p>
                <p className="text-sm text-slate-400">Kits</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-3xl font-bold text-purple-400">{data.summary.totalSupplies}</p>
                <p className="text-sm text-slate-400">Supplies</p>
              </div>
              <div className={`rounded-xl p-4 border ${data.summary.unmatchedProducts.length > 0 ? "bg-yellow-900/20 border-yellow-700" : "bg-emerald-900/20 border-emerald-700"}`}>
                <p className={`text-3xl font-bold ${data.summary.unmatchedProducts.length > 0 ? "text-yellow-400" : "text-emerald-400"}`}>
                  {data.summary.unmatchedProducts.length}
                </p>
                <p className="text-sm text-slate-400">Unmatched</p>
              </div>
            </div>

            {/* Unmatched Products Warning */}
            {data.summary.unmatchedProducts.length > 0 && (
              <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
                <p className="text-yellow-400 font-medium mb-2">Products Not Matched to Designs</p>
                <p className="text-sm text-slate-300 mb-2">
                  These Shopify product titles don&apos;t match any design names in your system:
                </p>
                <ul className="list-disc list-inside text-sm text-slate-400">
                  {data.summary.unmatchedProducts.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Filter Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
              <span className="text-xs md:text-sm text-slate-400 mr-1 md:mr-2">Show:</span>
              <button
                onClick={() => setFilter("all")}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                  filter === "all"
                    ? "bg-slate-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter("canvases")}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                  filter === "canvases"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-blue-400"
                }`}
              >
                Canvases <span className="opacity-75">({data.summary.totalCanvasesNeeded})</span>
              </button>
              <button
                onClick={() => setFilter("kits")}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                  filter === "kits"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-amber-400"
                }`}
              >
                Kits <span className="opacity-75">({data.summary.totalKitsNeeded})</span>
              </button>
              <button
                onClick={() => setFilter("supplies")}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                  filter === "supplies"
                    ? "bg-purple-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-purple-400"
                }`}
              >
                Supplies <span className="opacity-75">({data.summary.totalSupplies})</span>
              </button>
            </div>

            {/* Kits Needed View - Grouped by collection */}
            {filter === "kits" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">Kits Needed</h2>
                {(() => {
                  // Aggregate all kit items by design
                  const kitsByDesign = new Map<string, {
                    designId: string | null;
                    designName: string | null;
                    productTitle: string;
                    previewImageUrl: string | null;
                    quantity: number;
                    kitsReady: number;
                    folderId: string | null;
                    folderName: string | null;
                    totalSold: number;
                  }>();

                  for (const order of data.orders) {
                    for (const item of order.items) {
                      if (!item.needsKit || item.itemType !== "canvas") continue;

                      const key = item.designId || item.productTitle;
                      const existing = kitsByDesign.get(key);
                      if (existing) {
                        existing.quantity += item.quantity;
                      } else {
                        kitsByDesign.set(key, {
                          designId: item.designId,
                          designName: item.designName,
                          productTitle: item.productTitle,
                          previewImageUrl: item.previewImageUrl,
                          quantity: item.quantity,
                          kitsReady: item.kitsReady,
                          folderId: item.folderId,
                          folderName: item.folderName,
                          totalSold: item.totalSold,
                        });
                      }
                    }
                  }

                  const kits = Array.from(kitsByDesign.values());

                  if (kits.length === 0) {
                    return (
                      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                        <p className="text-slate-400">No kits needed</p>
                      </div>
                    );
                  }

                  // Group by folder
                  const kitsByFolder = new Map<string, typeof kits>();
                  for (const kit of kits) {
                    const folderKey = kit.folderId || "__uncategorized__";
                    const existing = kitsByFolder.get(folderKey) || [];
                    existing.push(kit);
                    kitsByFolder.set(folderKey, existing);
                  }

                  // Sort folders alphabetically, with uncategorized at the end
                  const sortedFolders = Array.from(kitsByFolder.entries()).sort((a, b) => {
                    if (a[0] === "__uncategorized__") return 1;
                    if (b[0] === "__uncategorized__") return -1;
                    const nameA = a[1][0]?.folderName || "";
                    const nameB = b[1][0]?.folderName || "";
                    return nameA.localeCompare(nameB);
                  });

                  return (
                    <div className="space-y-4">
                      {sortedFolders.map(([folderId, folderKits]) => {
                        const folderName = folderKits[0]?.folderName || "Uncategorized";
                        // Sort kits within folder by quantity needed (descending)
                        const sortedKits = [...folderKits].sort((a, b) => b.quantity - a.quantity);

                        return (
                          <div key={folderId} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                            {/* Folder header */}
                            <div className="px-4 py-3 bg-slate-700/50 border-b border-slate-700">
                              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                                {folderName}
                              </h3>
                            </div>
                            <div className="divide-y divide-slate-700/50">
                              {sortedKits.map((kit, idx) => {
                                const hasEnough = kit.kitsReady >= kit.quantity;
                                const shortage = kit.quantity - kit.kitsReady;
                                const isExpanded = kit.designId ? expandedKits.has(kit.designId) : false;
                                const kitInfo = kit.designId ? kitData.get(kit.designId) : null;

                                return (
                                  <div key={idx}>
                                    <div className="p-4 flex items-center gap-4">
                                      {kit.designId ? (
                                        <Link
                                          href={`/design/${kit.designId}/info`}
                                          className="flex-shrink-0"
                                        >
                                          {kit.previewImageUrl ? (
                                            <img
                                              src={kit.previewImageUrl}
                                              alt={kit.productTitle}
                                              className="w-14 h-14 rounded-lg object-cover hover:ring-2 hover:ring-rose-500 transition-all"
                                            />
                                          ) : (
                                            <div className="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all">
                                              <span className="text-slate-500 text-xs">?</span>
                                            </div>
                                          )}
                                        </Link>
                                      ) : kit.previewImageUrl ? (
                                        <img
                                          src={kit.previewImageUrl}
                                          alt={kit.productTitle}
                                          className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                                        />
                                      ) : (
                                        <div className="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                                          <span className="text-slate-500 text-xs">?</span>
                                        </div>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        {kit.designId ? (
                                          <Link
                                            href={`/design/${kit.designId}/info`}
                                            className="text-white font-medium truncate hover:text-rose-400 transition-colors block"
                                          >
                                            {kit.designName || kit.productTitle}
                                          </Link>
                                        ) : (
                                          <p className="text-white font-medium truncate">
                                            {kit.designName || kit.productTitle}
                                          </p>
                                        )}
                                        {!kit.designId ? (
                                          <p className="text-xs text-yellow-500">No matching design</p>
                                        ) : (
                                          <p className="text-xs text-purple-400">{kit.totalSold} sold</p>
                                        )}
                                        {/* Kit contents summary */}
                                        {kit.designId && (
                                          <button
                                            onClick={() => toggleKitExpanded(kit.designId!)}
                                            className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1 mt-1"
                                          >
                                            <svg
                                              className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke="currentColor"
                                            >
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                            {kitInfo ? `${kitInfo.totalColors} colors, ${kitInfo.totalSkeins} skeins` : "View kit contents"}
                                          </button>
                                        )}
                                      </div>
                                      <div className="text-center px-4">
                                        <p className="text-2xl font-bold text-amber-400">{kit.quantity}</p>
                                        <p className="text-xs text-slate-400">needed</p>
                                      </div>
                                      <div className="text-center px-4">
                                        <div className="flex items-center gap-1">
                                          {kit.designId && (
                                            <button
                                              onClick={() => handleUpdateCount(kit.designId!, "kitsReady", -1)}
                                              disabled={updating === kit.designId || kit.kitsReady <= 0}
                                              className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                              title="Remove 1"
                                            >
                                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                              </svg>
                                            </button>
                                          )}
                                          <div className="text-center">
                                            {kit.designId ? (
                                              <input
                                                type="number"
                                                min="0"
                                                value={pendingKits[kit.designId] ?? kit.kitsReady}
                                                onChange={(e) => setPendingKits((prev) => ({ ...prev, [kit.designId!]: e.target.value }))}
                                                onBlur={() => {
                                                  const val = pendingKits[kit.designId!];
                                                  if (val !== undefined) {
                                                    handleSetValue(kit.designId!, "kitsReady", Number(val));
                                                  }
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    const val = pendingKits[kit.designId!];
                                                    if (val !== undefined) {
                                                      handleSetValue(kit.designId!, "kitsReady", Number(val));
                                                    }
                                                    (e.target as HTMLInputElement).blur();
                                                  }
                                                }}
                                                className={`w-14 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-emerald-600 ${hasEnough ? "text-emerald-400" : "text-red-400"}`}
                                              />
                                            ) : (
                                              <p className={`text-2xl font-bold ${hasEnough ? "text-emerald-400" : "text-red-400"}`}>
                                                {kit.kitsReady}
                                              </p>
                                            )}
                                            <p className="text-xs text-slate-400">ready</p>
                                          </div>
                                          {kit.designId && (
                                            <button
                                              onClick={() => handleUpdateCount(kit.designId!, "kitsReady", 1)}
                                              disabled={updating === kit.designId}
                                              className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                              title="Add 1"
                                            >
                                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      {!hasEnough && (
                                        <div className="text-center px-4">
                                          <p className="text-2xl font-bold text-red-400">-{shortage}</p>
                                          <p className="text-xs text-slate-400">short</p>
                                        </div>
                                      )}
                                      {kit.designId && (
                                        <Link
                                          href={`/design/${kit.designId}/kit`}
                                          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                                          title="View kit details"
                                        >
                                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                          </svg>
                                        </Link>
                                      )}
                                    </div>

                                    {/* Expanded kit contents */}
                                    {isExpanded && kit.designId && (
                                      <div className="px-4 pb-4 pt-0">
                                        <div className="bg-slate-900/50 rounded-lg p-3 ml-16">
                                          {loadingKits ? (
                                            <p className="text-sm text-slate-400">Loading kit contents...</p>
                                          ) : kitInfo ? (
                                            <div className="space-y-2">
                                              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                                                <span>Thread colors needed:</span>
                                                <span className={kitInfo.allInStock ? "text-emerald-400" : "text-amber-400"}>
                                                  {kitInfo.allInStock ? "All in stock" : "Some out of stock"}
                                                </span>
                                              </div>
                                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {kitInfo.kitContents.map((item) => (
                                                  <div
                                                    key={item.dmcNumber}
                                                    className={`flex items-center gap-2 p-2 rounded text-xs ${
                                                      item.inStock ? "bg-slate-800" : "bg-red-900/30"
                                                    }`}
                                                  >
                                                    <Link
                                                      href={`/inventory/color/${item.dmcNumber}`}
                                                      className="w-6 h-6 rounded flex-shrink-0 border border-slate-600 hover:ring-1 hover:ring-rose-500"
                                                      style={{ backgroundColor: item.hex }}
                                                      title={`View DMC ${item.dmcNumber}`}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                      <p className="text-white font-medium truncate">{item.dmcNumber} - {item.colorName}</p>
                                                      <p className="text-slate-500">
                                                        {item.fullSkeins > 0 ? `${item.fullSkeins} sk needed` : `${item.bobbinYards}y bobbin`}
                                                      </p>
                                                    </div>
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                      <button
                                                        onClick={() => handleUpdateInventory(item.dmcNumber, -1)}
                                                        disabled={updatingInventory === item.dmcNumber || item.inventorySkeins <= 0}
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
                                                        value={pendingInventory[item.dmcNumber] ?? item.inventorySkeins}
                                                        onChange={(e) => setPendingInventory((prev) => ({ ...prev, [item.dmcNumber]: e.target.value }))}
                                                        onBlur={() => {
                                                          const val = pendingInventory[item.dmcNumber];
                                                          if (val !== undefined) {
                                                            handleSetInventory(item.dmcNumber, Number(val));
                                                          }
                                                        }}
                                                        onKeyDown={(e) => {
                                                          if (e.key === "Enter") {
                                                            const val = pendingInventory[item.dmcNumber];
                                                            if (val !== undefined) {
                                                              handleSetInventory(item.dmcNumber, Number(val));
                                                            }
                                                            (e.target as HTMLInputElement).blur();
                                                          }
                                                        }}
                                                        className={`w-10 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600 ${item.inStock ? "text-emerald-400" : "text-red-400"}`}
                                                      />
                                                      <button
                                                        onClick={() => handleUpdateInventory(item.dmcNumber, 1)}
                                                        disabled={updatingInventory === item.dmcNumber}
                                                        className="p-0.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                                        title="Add 1"
                                                      >
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                        </svg>
                                                      </button>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          ) : (
                                            <p className="text-sm text-slate-400">Kit data not available</p>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* All Canvases Needed View - Shows ALL orders since all need canvases */}
            {filter === "canvases" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">All Canvases Needed</h2>
                {(() => {
                  // Aggregate ALL items by design (every order needs a canvas printed)
                  const canvasesByDesign = new Map<string, {
                    designId: string | null;
                    designName: string | null;
                    productTitle: string;
                    previewImageUrl: string | null;
                    quantity: number;
                    canvasPrinted: number;
                    kitsNeeded: number; // How many of these also need kits
                  }>();

                  for (const order of data.orders) {
                    for (const item of order.items) {
                      // Only include canvas items, not supplies
                      if (item.itemType !== "canvas") continue;

                      const key = item.designId || item.productTitle;
                      const existing = canvasesByDesign.get(key);
                      if (existing) {
                        existing.quantity += item.quantity;
                        if (item.needsKit) {
                          existing.kitsNeeded += item.quantity;
                        }
                      } else {
                        canvasesByDesign.set(key, {
                          designId: item.designId,
                          designName: item.designName,
                          productTitle: item.productTitle,
                          previewImageUrl: item.previewImageUrl,
                          quantity: item.quantity,
                          canvasPrinted: item.canvasPrinted,
                          kitsNeeded: item.needsKit ? item.quantity : 0,
                        });
                      }
                    }
                  }

                  const canvases = Array.from(canvasesByDesign.values()).sort((a, b) => b.quantity - a.quantity);

                  if (canvases.length === 0) {
                    return (
                      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                        <p className="text-slate-400">No orders</p>
                      </div>
                    );
                  }

                  return (
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                      <div className="divide-y divide-slate-700/50">
                        {canvases.map((canvas, idx) => {
                          const hasEnough = canvas.canvasPrinted >= canvas.quantity;
                          const shortage = canvas.quantity - canvas.canvasPrinted;
                          return (
                            <div key={idx} className="p-4 flex items-center gap-4">
                              {canvas.designId ? (
                                <Link href={`/design/${canvas.designId}/info`} className="flex-shrink-0">
                                  {canvas.previewImageUrl ? (
                                    <img
                                      src={canvas.previewImageUrl}
                                      alt={canvas.productTitle}
                                      className="w-14 h-14 rounded-lg object-cover hover:ring-2 hover:ring-rose-500 transition-all"
                                    />
                                  ) : (
                                    <div className="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all">
                                      <span className="text-slate-500 text-xs">?</span>
                                    </div>
                                  )}
                                </Link>
                              ) : canvas.previewImageUrl ? (
                                <img
                                  src={canvas.previewImageUrl}
                                  alt={canvas.productTitle}
                                  className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                                  <span className="text-slate-500 text-xs">?</span>
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                {canvas.designId ? (
                                  <Link
                                    href={`/design/${canvas.designId}/info`}
                                    className="text-white font-medium truncate hover:text-rose-400 transition-colors block"
                                  >
                                    {canvas.designName || canvas.productTitle}
                                  </Link>
                                ) : (
                                  <p className="text-white font-medium truncate">
                                    {canvas.designName || canvas.productTitle}
                                  </p>
                                )}
                                {!canvas.designId && (
                                  <p className="text-xs text-yellow-500">No matching design</p>
                                )}
                                {canvas.kitsNeeded > 0 && (
                                  <p className="text-xs text-amber-400">
                                    {canvas.kitsNeeded} need kit{canvas.kitsNeeded > 1 ? "s" : ""}
                                  </p>
                                )}
                              </div>
                              <div className="text-center px-4">
                                <p className="text-2xl font-bold text-blue-400">{canvas.quantity}</p>
                                <p className="text-xs text-slate-400">canvases</p>
                              </div>
                              <div className="text-center px-4">
                                <div className="flex items-center gap-1">
                                  {canvas.designId && (
                                    <button
                                      onClick={() => handleUpdateCount(canvas.designId!, "canvasPrinted", -1)}
                                      disabled={updating === canvas.designId || canvas.canvasPrinted <= 0}
                                      className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Remove 1"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                      </svg>
                                    </button>
                                  )}
                                  <div className="text-center">
                                    {canvas.designId ? (
                                      <input
                                        type="number"
                                        min="0"
                                        value={pendingCanvases[canvas.designId] ?? canvas.canvasPrinted}
                                        onChange={(e) => setPendingCanvases((prev) => ({ ...prev, [canvas.designId!]: e.target.value }))}
                                        onBlur={() => {
                                          const val = pendingCanvases[canvas.designId!];
                                          if (val !== undefined) {
                                            handleSetValue(canvas.designId!, "canvasPrinted", Number(val));
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            const val = pendingCanvases[canvas.designId!];
                                            if (val !== undefined) {
                                              handleSetValue(canvas.designId!, "canvasPrinted", Number(val));
                                            }
                                            (e.target as HTMLInputElement).blur();
                                          }
                                        }}
                                        className={`w-14 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-blue-600 ${hasEnough ? "text-emerald-400" : "text-red-400"}`}
                                      />
                                    ) : (
                                      <p className={`text-2xl font-bold ${hasEnough ? "text-emerald-400" : "text-red-400"}`}>
                                        {canvas.canvasPrinted}
                                      </p>
                                    )}
                                    <p className="text-xs text-slate-400">printed</p>
                                  </div>
                                  {canvas.designId && (
                                    <button
                                      onClick={() => handleUpdateCount(canvas.designId!, "canvasPrinted", 1)}
                                      disabled={updating === canvas.designId}
                                      className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Add 1"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                              {!hasEnough && (
                                <div className="text-center px-4">
                                  <p className="text-2xl font-bold text-red-400">-{shortage}</p>
                                  <p className="text-xs text-slate-400">short</p>
                                </div>
                              )}
                              {canvas.designId && (
                                <Link
                                  href={`/design/${canvas.designId}/info`}
                                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                                  title="View design"
                                >
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </Link>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Supplies View */}
            {filter === "supplies" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Supplies Ordered</h2>
                  <Link
                    href="/supplies"
                    className="text-sm text-purple-400 hover:text-purple-300"
                  >
                    Manage Supplies →
                  </Link>
                </div>
                {(() => {
                  // Aggregate supply items by supply ID or product title
                  const suppliesByKey = new Map<string, {
                    supplyId: string | null;
                    productTitle: string;
                    productType: string | null;
                    quantity: number;
                    inStock: number;
                  }>();

                  for (const order of data.orders) {
                    for (const item of order.items) {
                      if (item.itemType !== "supply") continue;

                      const key = item.supplyId || item.productTitle;
                      const existing = suppliesByKey.get(key);
                      if (existing) {
                        existing.quantity += item.quantity;
                      } else {
                        suppliesByKey.set(key, {
                          supplyId: item.supplyId,
                          productTitle: item.productTitle,
                          productType: item.productType,
                          quantity: item.quantity,
                          inStock: item.supplyQuantity,
                        });
                      }
                    }
                  }

                  const supplies = Array.from(suppliesByKey.values()).sort((a, b) => b.quantity - a.quantity);

                  if (supplies.length === 0) {
                    return (
                      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                        <p className="text-slate-400">No supplies ordered</p>
                        <p className="text-sm text-slate-500 mt-2">
                          Add supplies in &quot;Manage Supplies&quot; to track their inventory
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                      <div className="divide-y divide-slate-700/50">
                        {supplies.map((supply, idx) => {
                          const hasEnough = supply.inStock >= supply.quantity;
                          const shortage = supply.quantity - supply.inStock;
                          return (
                            <div key={idx} className="p-4 flex items-center gap-4">
                              <div className="w-14 h-14 rounded-lg bg-purple-900/30 border border-purple-700/50 flex items-center justify-center flex-shrink-0">
                                <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white font-medium truncate">{supply.productTitle}</p>
                                {supply.productType && (
                                  <p className="text-xs text-purple-400">{supply.productType}</p>
                                )}
                                {!supply.supplyId && (
                                  <p className="text-xs text-yellow-500">Not matched to a supply</p>
                                )}
                              </div>
                              <div className="text-center px-4">
                                <p className="text-2xl font-bold text-purple-400">{supply.quantity}</p>
                                <p className="text-xs text-slate-400">ordered</p>
                              </div>
                              {supply.supplyId && (
                                <>
                                  <div className="text-center px-4">
                                    <p className={`text-2xl font-bold ${hasEnough ? "text-emerald-400" : "text-red-400"}`}>
                                      {supply.inStock}
                                    </p>
                                    <p className="text-xs text-slate-400">in stock</p>
                                  </div>
                                  {!hasEnough && (
                                    <div className="text-center px-4">
                                      <p className="text-2xl font-bold text-red-400">-{shortage}</p>
                                      <p className="text-xs text-slate-400">short</p>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* All Orders View */}
            {filter === "all" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">Unfulfilled Orders</h2>
                {data.orders.length === 0 ? (
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                    <p className="text-slate-400">No unfulfilled orders</p>
                  </div>
                ) : (
                  (() => {
                    const demandByDesign = calculateDemandByDesign(data.orders);
                    return data.orders.map((order) => (
                      <OrderCard
                        key={order.shopifyOrderId}
                        order={order}
                        demandByDesign={demandByDesign}
                        onFulfill={handleFulfillOrder}
                        fulfilling={fulfilling === order.shopifyOrderId}
                      />
                    ));
                  })()
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

interface DemandMap {
  totalKitsNeeded: number;
  totalCanvasesNeeded: number;
}

interface OrderCardProps {
  order: Order;
  demandByDesign: Map<string, DemandMap>;
  onFulfill: (order: Order) => void;
  fulfilling: boolean;
}

function OrderCard({ order, demandByDesign, onFulfill, fulfilling }: OrderCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Only count canvas items for kits/canvases
  const canvasItems = order.items.filter(item => item.itemType === "canvas");
  const supplyItems = order.items.filter(item => item.itemType === "supply");

  const kitsInOrder = canvasItems.reduce((sum, item) => sum + (item.needsKit ? item.quantity : 0), 0);
  const canvasesInOrder = canvasItems.reduce((sum, item) => sum + item.quantity, 0);
  const suppliesInOrder = supplyItems.reduce((sum, item) => sum + item.quantity, 0);

  // Check if we have enough kits/canvases for THIS order based on total demand
  const hasEnoughKitsForOrder = canvasItems.every((item) => {
    if (!item.needsKit || !item.designId) return true;
    const demand = demandByDesign.get(item.designId);
    return item.kitsReady >= (demand?.totalKitsNeeded || item.quantity);
  });
  const hasEnoughCanvasesForOrder = canvasItems.every((item) => {
    if (!item.designId) return true;
    const demand = demandByDesign.get(item.designId);
    return item.canvasPrinted >= (demand?.totalCanvasesNeeded || item.quantity);
  });

  // Can fulfill if we have enough kits and canvases for canvas items
  // Supplies don't block fulfillment
  const canFulfill = (canvasItems.length === 0) || (hasEnoughKitsForOrder && hasEnoughCanvasesForOrder);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center gap-4 text-left hover:bg-slate-700/30 transition-colors rounded-lg -m-2 p-2"
        >
          <div>
            <p className="text-white font-medium">{order.orderNumber}</p>
            <p className="text-sm text-slate-400">{order.customerName}</p>
          </div>

          <div className="flex items-center gap-4 ml-auto">
            <div className="text-right">
              <p className="text-sm text-slate-300">
                {order.items.length} {order.items.length === 1 ? "item" : "items"}
              </p>
              <p className="text-xs text-slate-500">
                {new Date(order.createdAt).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {canvasesInOrder > 0 && (
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  hasEnoughCanvasesForOrder
                    ? "bg-emerald-900/50 text-emerald-400"
                    : "bg-red-900/50 text-red-400"
                }`}>
                  {canvasesInOrder} canvas{canvasesInOrder > 1 ? "es" : ""}
                </span>
              )}
              {kitsInOrder > 0 && (
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  hasEnoughKitsForOrder
                    ? "bg-emerald-900/50 text-emerald-400"
                    : "bg-red-900/50 text-red-400"
                }`}>
                  {kitsInOrder} kit{kitsInOrder > 1 ? "s" : ""}
                </span>
              )}
              {suppliesInOrder > 0 && (
                <span className="px-2 py-1 rounded text-xs font-medium bg-purple-900/50 text-purple-400">
                  {suppliesInOrder} suppl{suppliesInOrder > 1 ? "ies" : "y"}
                </span>
              )}
            </div>

            <svg
              className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* Fulfill Order Button */}
        <button
          onClick={() => onFulfill(order)}
          disabled={fulfilling || !canFulfill}
          className={`ml-4 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
            canFulfill
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : "bg-slate-700 text-slate-500 cursor-not-allowed"
          } disabled:opacity-50`}
          title={canFulfill ? "Mark as fulfilled and deduct inventory" : "Not enough kits or canvases ready"}
        >
          {fulfilling ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Fulfilling...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Fulfill Order
            </>
          )}
        </button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-slate-700 divide-y divide-slate-700/50">
          {order.items.map((item, idx) => (
            <OrderItemRow key={idx} item={item} demandByDesign={demandByDesign} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderItemRow({ item, demandByDesign }: { item: OrderItem; demandByDesign: Map<string, DemandMap> }) {
  // Get total demand for this design across ALL orders
  const demand = item.designId ? demandByDesign.get(item.designId) : null;
  const totalKitsNeeded = demand?.totalKitsNeeded || item.quantity;
  const totalCanvasesNeeded = demand?.totalCanvasesNeeded || item.quantity;

  // Check if there's enough for ALL orders, not just this one
  const hasEnoughKits = item.kitsReady >= totalKitsNeeded;
  const hasEnoughCanvases = item.canvasPrinted >= totalCanvasesNeeded;

  // Shortage across all orders
  const kitShortage = Math.max(0, totalKitsNeeded - item.kitsReady);
  const canvasShortage = Math.max(0, totalCanvasesNeeded - item.canvasPrinted);

  return (
    <div className="p-4 flex items-center gap-4">
      {/* Preview */}
      {item.designId ? (
        <Link href={`/design/${item.designId}/info`} className="flex-shrink-0">
          {item.previewImageUrl ? (
            <img
              src={item.previewImageUrl}
              alt={item.productTitle}
              className="w-12 h-12 rounded-lg object-cover hover:ring-2 hover:ring-rose-500 transition-all"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all">
              <span className="text-slate-500 text-xs">?</span>
            </div>
          )}
        </Link>
      ) : item.previewImageUrl ? (
        <img
          src={item.previewImageUrl}
          alt={item.productTitle}
          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
          <span className="text-slate-500 text-xs">?</span>
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        {item.designId ? (
          <Link
            href={`/design/${item.designId}/info`}
            className="text-white font-medium truncate hover:text-rose-400 transition-colors block"
          >
            {item.productTitle}
          </Link>
        ) : (
          <p className="text-white font-medium truncate">{item.productTitle}</p>
        )}
        {item.variantTitle && (
          <p className="text-sm text-slate-400 truncate">{item.variantTitle}</p>
        )}
        {!item.designId && (
          <p className="text-xs text-yellow-500">No matching design</p>
        )}
      </div>

      {/* Quantity */}
      <div className="text-center px-3">
        <p className="text-white font-bold">{item.quantity}</p>
        <p className="text-xs text-slate-500">qty</p>
      </div>

      {/* Kit Status */}
      <div className="text-center px-3">
        {item.needsKit ? (
          <div className={hasEnoughKits ? "text-emerald-400" : "text-red-400"}>
            <p className="font-bold">{item.kitsReady}/{totalKitsNeeded}</p>
            <p className="text-xs">kits ready</p>
            {kitShortage > 0 && (
              <p className="text-xs text-red-400">need {kitShortage}</p>
            )}
          </div>
        ) : (
          <div className="text-slate-500">
            <p className="text-xs">No kit</p>
          </div>
        )}
      </div>

      {/* Canvas Status */}
      <div className="text-center px-3">
        <div className={hasEnoughCanvases ? "text-emerald-400" : "text-red-400"}>
          <p className="font-bold">{item.canvasPrinted}/{totalCanvasesNeeded}</p>
          <p className="text-xs">printed</p>
          {canvasShortage > 0 && (
            <p className="text-xs text-red-400">need {canvasShortage}</p>
          )}
        </div>
      </div>

      {/* Link to design */}
      {item.designId && (
        <Link
          href={`/design/${item.designId}/kit`}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
          title="View kit"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </Link>
      )}
    </div>
  );
}

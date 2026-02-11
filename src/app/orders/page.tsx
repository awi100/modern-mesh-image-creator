"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { OrdersResponse, Order, OrderItem } from "@/app/api/shopify/orders/route";
import type { SyncResult } from "@/app/api/shopify/sync/route";

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

type FilterType = "all" | "kits" | "canvases";

// Calculate aggregated demand per design across all orders
function calculateDemandByDesign(orders: Order[]) {
  const demand = new Map<string, { totalKitsNeeded: number; totalCanvasesNeeded: number }>();

  for (const order of orders) {
    for (const item of order.items) {
      if (!item.designId) continue;

      const existing = demand.get(item.designId) || { totalKitsNeeded: 0, totalCanvasesNeeded: 0 };
      if (item.needsKit) {
        existing.totalKitsNeeded += item.quantity;
      }
      existing.totalCanvasesNeeded += item.quantity; // All orders need canvases
      demand.set(item.designId, existing);
    }
  }

  return demand;
}

export default function OrdersPage() {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [updating, setUpdating] = useState<string | null>(null); // Track which design is being updated

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

  const handleSync = async () => {
    setSyncing(true);
    setLastSync(null);
    try {
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to sync");
      }
      const result: SyncResult = await res.json();
      setLastSync(result);
      // Refresh orders after sync
      fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    }
    setSyncing(false);
  };

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Update design kitsReady or canvasPrinted count with optimistic updates
  const handleUpdateCount = async (designId: string, field: "kitsReady" | "canvasPrinted", delta: number) => {
    // Prevent rapid clicks - if already updating this design, ignore
    if (updating === designId) return;

    setUpdating(designId);

    // Optimistic update - immediately update local state
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

    try {
      const body = field === "kitsReady"
        ? { kitsReadyDelta: delta }
        : { canvasPrintedDelta: delta };

      const res = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error("Failed to update");
        // Note: On error, we should revert, but for simplicity we'll refetch
      }

      // Don't refetch on success - optimistic update is sufficient
      // Only refetch if there was an error
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      // Revert by refetching
      await fetchOrders();
    }
    setUpdating(null);
  };

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
            <h1 className="text-xl font-bold text-white">Shopify Orders</h1>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/shopify"
              className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
            >
              Products
            </Link>
            <button
              onClick={fetchOrders}
              disabled={loading}
              className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 disabled:opacity-50 text-sm flex items-center gap-2"
            >
              <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
            >
              {syncing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Syncing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Sync Fulfilled Orders
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Sync Result */}
        {lastSync && (
          <div className="p-4 bg-emerald-900/30 border border-emerald-700 rounded-lg">
            <p className="text-emerald-400 font-medium">Sync Complete</p>
            <p className="text-sm text-slate-300 mt-1">
              Processed {lastSync.processedOrders} orders &middot;
              Deducted {lastSync.kitsDeducted} kits, {lastSync.canvasesDeducted} canvases
            </p>
            {lastSync.errors.length > 0 && (
              <p className="text-sm text-yellow-400 mt-1">
                {lastSync.errors.length} errors: {lastSync.errors.join(", ")}
              </p>
            )}
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-3xl font-bold text-white">{data.summary.totalOrders}</p>
                <p className="text-sm text-slate-400">Unfulfilled Orders</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-3xl font-bold text-amber-400">{data.summary.totalKitsNeeded}</p>
                <p className="text-sm text-slate-400">Kits Needed</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-3xl font-bold text-blue-400">{data.summary.totalCanvasesNeeded}</p>
                <p className="text-sm text-slate-400">Canvases Needed</p>
              </div>
              <div className={`rounded-xl p-4 border ${data.summary.unmatchedProducts.length > 0 ? "bg-yellow-900/20 border-yellow-700" : "bg-emerald-900/20 border-emerald-700"}`}>
                <p className={`text-3xl font-bold ${data.summary.unmatchedProducts.length > 0 ? "text-yellow-400" : "text-emerald-400"}`}>
                  {data.summary.unmatchedProducts.length}
                </p>
                <p className="text-sm text-slate-400">Unmatched Products</p>
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
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400 mr-2">Show:</span>
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === "all"
                    ? "bg-slate-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                All Orders
              </button>
              <button
                onClick={() => setFilter("kits")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === "kits"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-amber-400"
                }`}
              >
                Needs Kit ({data.summary.totalKitsNeeded})
              </button>
              <button
                onClick={() => setFilter("canvases")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === "canvases"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-blue-400"
                }`}
              >
                All Canvases ({data.summary.totalCanvasesNeeded})
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
                      if (!item.needsKit) continue;

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
                                return (
                                  <div key={idx} className="p-4 flex items-center gap-4">
                                    {kit.previewImageUrl ? (
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
                                      <p className="text-white font-medium truncate">
                                        {kit.designName || kit.productTitle}
                                      </p>
                                      {!kit.designId ? (
                                        <p className="text-xs text-yellow-500">No matching design</p>
                                      ) : (
                                        <p className="text-xs text-purple-400">{kit.totalSold} sold</p>
                                      )}
                                    </div>
                                    <div className="text-center px-4">
                                      <p className="text-2xl font-bold text-amber-400">{kit.quantity}</p>
                                      <p className="text-xs text-slate-400">needed</p>
                                    </div>
                                    <div className="text-center px-4">
                                      <div className="flex items-center gap-2">
                                        {kit.designId && (
                                          <button
                                            onClick={() => handleUpdateCount(kit.designId!, "kitsReady", -1)}
                                            disabled={updating === kit.designId || kit.kitsReady <= 0}
                                            className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold"
                                          >
                                            −
                                          </button>
                                        )}
                                        <div>
                                          <p className={`text-2xl font-bold ${hasEnough ? "text-emerald-400" : "text-red-400"}`}>
                                            {kit.kitsReady}
                                          </p>
                                          <p className="text-xs text-slate-400">ready</p>
                                        </div>
                                        {kit.designId && (
                                          <button
                                            onClick={() => handleUpdateCount(kit.designId!, "kitsReady", 1)}
                                            disabled={updating === kit.designId}
                                            className="w-7 h-7 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold"
                                          >
                                            +
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
                              {canvas.previewImageUrl ? (
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
                                <p className="text-white font-medium truncate">
                                  {canvas.designName || canvas.productTitle}
                                </p>
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
                                <div className="flex items-center gap-2">
                                  {canvas.designId && (
                                    <button
                                      onClick={() => handleUpdateCount(canvas.designId!, "canvasPrinted", -1)}
                                      disabled={updating === canvas.designId || canvas.canvasPrinted <= 0}
                                      className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold"
                                    >
                                      −
                                    </button>
                                  )}
                                  <div>
                                    <p className={`text-2xl font-bold ${hasEnough ? "text-emerald-400" : "text-red-400"}`}>
                                      {canvas.canvasPrinted}
                                    </p>
                                    <p className="text-xs text-slate-400">printed</p>
                                  </div>
                                  {canvas.designId && (
                                    <button
                                      onClick={() => handleUpdateCount(canvas.designId!, "canvasPrinted", 1)}
                                      disabled={updating === canvas.designId}
                                      className="w-7 h-7 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold"
                                    >
                                      +
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
                                  href={`/design/${canvas.designId}`}
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
                      <OrderCard key={order.shopifyOrderId} order={order} demandByDesign={demandByDesign} />
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

function OrderCard({ order, demandByDesign }: { order: Order; demandByDesign: Map<string, DemandMap> }) {
  const [expanded, setExpanded] = useState(false);

  const kitsInOrder = order.items.reduce((sum, item) => sum + (item.needsKit ? item.quantity : 0), 0);
  const canvasesInOrder = order.items.reduce((sum, item) => sum + item.quantity, 0);

  // Check if we have enough kits/canvases for THIS order based on total demand
  const hasEnoughKitsForOrder = order.items.every((item) => {
    if (!item.needsKit || !item.designId) return true;
    const demand = demandByDesign.get(item.designId);
    return item.kitsReady >= (demand?.totalKitsNeeded || item.quantity);
  });
  const hasEnoughCanvasesForOrder = order.items.every((item) => {
    if (!item.designId) return true;
    const demand = demandByDesign.get(item.designId);
    return item.canvasPrinted >= (demand?.totalCanvasesNeeded || item.quantity);
  });

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="text-left">
            <p className="text-white font-medium">{order.orderNumber}</p>
            <p className="text-sm text-slate-400">{order.customerName}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm text-slate-300">
              {order.items.length} {order.items.length === 1 ? "item" : "items"}
            </p>
            <p className="text-xs text-slate-500">
              {new Date(order.createdAt).toLocaleDateString()}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {kitsInOrder > 0 && (
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                hasEnoughKitsForOrder
                  ? "bg-emerald-900/50 text-emerald-400"
                  : "bg-red-900/50 text-red-400"
              }`}>
                {kitsInOrder} kit{kitsInOrder > 1 ? "s" : ""}
              </span>
            )}
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              hasEnoughCanvasesForOrder
                ? "bg-emerald-900/50 text-emerald-400"
                : "bg-red-900/50 text-red-400"
            }`}>
              {canvasesInOrder} canvas{canvasesInOrder > 1 ? "es" : ""}
            </span>
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
      {item.previewImageUrl ? (
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
        <p className="text-white font-medium truncate">{item.productTitle}</p>
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

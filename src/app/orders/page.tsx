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

export default function OrdersPage() {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");

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

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-white">Shopify Orders</h1>
          </div>

          <div className="flex items-center gap-3">
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
                Canvas Only ({data.summary.totalCanvasesNeeded - data.summary.totalKitsNeeded})
              </button>
            </div>

            {/* Orders List */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">
                {filter === "all" && "Unfulfilled Orders"}
                {filter === "kits" && "Orders Needing Kits"}
                {filter === "canvases" && "Canvas-Only Orders"}
              </h2>

              {(() => {
                // Filter orders based on selection
                const filteredOrders = data.orders.map(order => {
                  if (filter === "all") return order;

                  // Filter items within orders
                  const filteredItems = order.items.filter(item => {
                    if (filter === "kits") return item.needsKit;
                    if (filter === "canvases") return !item.needsKit;
                    return true;
                  });

                  // Return order with filtered items, or null if no items match
                  if (filteredItems.length === 0) return null;
                  return { ...order, items: filteredItems };
                }).filter((order): order is Order => order !== null);

                if (filteredOrders.length === 0) {
                  return (
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                      <p className="text-slate-400">
                        {filter === "all" && "No unfulfilled orders"}
                        {filter === "kits" && "No orders needing kits"}
                        {filter === "canvases" && "No canvas-only orders"}
                      </p>
                    </div>
                  );
                }

                return filteredOrders.map((order) => (
                  <OrderCard key={order.shopifyOrderId} order={order} />
                ));
              })()}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false);

  const kitsInOrder = order.items.reduce((sum, item) => sum + (item.needsKit ? item.quantity : 0), 0);
  const canvasesInOrder = order.items.reduce((sum, item) => sum + item.quantity, 0);

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
              <span className="px-2 py-1 bg-amber-900/50 text-amber-400 rounded text-xs font-medium">
                {kitsInOrder} kit{kitsInOrder > 1 ? "s" : ""}
              </span>
            )}
            <span className="px-2 py-1 bg-blue-900/50 text-blue-400 rounded text-xs font-medium">
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
            <OrderItemRow key={idx} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderItemRow({ item }: { item: OrderItem }) {
  const hasEnoughKits = item.kitsReady >= item.quantity;
  const hasEnoughCanvases = item.canvasPrinted >= item.quantity;

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
            <p className="font-bold">{item.kitsReady}</p>
            <p className="text-xs">kits ready</p>
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
          <p className="font-bold">{item.canvasPrinted}</p>
          <p className="text-xs">printed</p>
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

"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";

interface ColorDesignUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  stitchCount: number;
  yardsNeeded: number;
  skeinsNeeded: number;
}

interface MostUsedColor {
  dmcNumber: string;
  colorName: string;
  hex: string;
  totalStitches: number;
  designCount: number;
  totalSkeinsNeeded: number;
  totalYardsNeeded: number;
  inventorySkeins: number;
  skeinsReservedInKits: number;
  effectiveInventory: number;
  threadSize: 5 | 8;
  designs: ColorDesignUsage[];
  coverageRounds: number;
  skeinsToNextRound: number;
  isCritical: boolean;
}

interface OrderSuggestion {
  dmcNumber: string;
  colorName: string;
  hex: string;
  threadSize: 5 | 8;
  currentStock: number;
  demandPerRound: number;
  currentCoverage: number;
  skeinsFor7Rounds: number;
  skeinsFor10Rounds: number;
  skeinsFor14Rounds: number;
}

interface GlobalDemandSummary {
  totalColors: number;
  criticalColors: number;
  lowColors: number;
  healthyColors: number;
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

type TargetRounds = 7 | 10 | 14;
type StatusFilter = "all" | "critical" | "low" | "healthy";

export default function StockAlertsPage() {
  const [colors, setColors] = useState<MostUsedColor[]>([]);
  const [orderSuggestions, setOrderSuggestions] = useState<OrderSuggestion[]>([]);
  const [globalDemand, setGlobalDemand] = useState<GlobalDemandSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());
  const [targetRounds, setTargetRounds] = useState<TargetRounds>(7);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [copiedOrder, setCopiedOrder] = useState(false);

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/inventory/alerts");
        if (response.ok) {
          const data = await response.json();
          setColors(data.mostUsedColors || []);
          setOrderSuggestions(data.orderSuggestions || []);
          setGlobalDemand(data.globalDemand);
        }
      } catch (error) {
        console.error("Error fetching stock alerts:", error);
      }
      setLoading(false);
    };
    fetchAlerts();
  }, []);

  const toggleExpand = (dmcNumber: string) => {
    setExpandedColors((prev) => {
      const next = new Set(prev);
      if (next.has(dmcNumber)) {
        next.delete(dmcNumber);
      } else {
        next.add(dmcNumber);
      }
      return next;
    });
  };

  const getStockStatus = (coverageRounds: number): "critical" | "low" | "healthy" => {
    if (coverageRounds < 3) return "critical";
    if (coverageRounds <= 6) return "low";
    return "healthy";
  };

  const filteredColors = useMemo(() => {
    if (statusFilter === "all") return colors;
    return colors.filter((c) => getStockStatus(c.coverageRounds) === statusFilter);
  }, [colors, statusFilter]);

  const orderList = useMemo(() => {
    return orderSuggestions.map((s) => {
      const qty = targetRounds === 7 ? s.skeinsFor7Rounds
        : targetRounds === 10 ? s.skeinsFor10Rounds
        : s.skeinsFor14Rounds;
      return { ...s, orderQty: qty };
    }).filter((s) => s.orderQty > 0);
  }, [orderSuggestions, targetRounds]);

  const totalSkeinsToOrder = useMemo(() => {
    return orderList.reduce((sum, s) => sum + s.orderQty, 0);
  }, [orderList]);

  const copyOrderToClipboard = () => {
    const lines = orderList.map((s) => `${s.dmcNumber}\t${s.orderQty}`);
    const text = lines.join("\n");
    navigator.clipboard.writeText(text);
    setCopiedOrder(true);
    setTimeout(() => setCopiedOrder(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-rose-600 dark:text-rose-400 hover:text-rose-500 dark:hover:text-rose-300">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <Breadcrumb
                items={[
                  { label: "Home", href: "/" },
                  { label: "Thread Stock" },
                ]}
              />
              <h1 className="text-slate-900 dark:text-white text-lg font-semibold">Thread Stock Alerts</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/velocity"
              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-medium"
            >
              Design Velocity
            </Link>
            <Link
              href="/inventory"
              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-medium"
            >
              Inventory
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Colors</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{globalDemand?.totalColors || 0}</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-4 border border-red-200 dark:border-red-800/50">
            <p className="text-xs text-red-600 dark:text-red-400 uppercase tracking-wider">Critical (&lt;3 rounds)</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{globalDemand?.criticalColors || 0}</p>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800/50">
            <p className="text-xs text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">Low (3-6 rounds)</p>
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{globalDemand?.lowColors || 0}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-4 border border-green-200 dark:border-green-800/50">
            <p className="text-xs text-green-600 dark:text-green-400 uppercase tracking-wider">Healthy (7+ rounds)</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{globalDemand?.healthyColors || 0}</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Thread List - 2 columns */}
          <div className="lg:col-span-2">
            {/* Filter Bar */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400 text-sm">Status:</span>
                  <div className="flex gap-1">
                    {(["all", "critical", "low", "healthy"] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          statusFilter === status
                            ? status === "critical" ? "bg-red-100 dark:bg-red-900 text-red-700 dark:text-white"
                              : status === "low" ? "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-white"
                              : status === "healthy" ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-white"
                              : "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-white"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                        }`}
                      >
                        {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {statusFilter !== "all" && (
                  <span className="text-slate-500 dark:text-slate-400 text-sm">
                    {filteredColors.length} of {colors.length} colors
                  </span>
                )}
              </div>
            </div>

            {/* Thread Cards */}
            {loading ? (
              <div className="flex items-center justify-center h-64 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="text-slate-600 dark:text-white flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading...
                </div>
              </div>
            ) : filteredColors.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <p className="text-slate-500 dark:text-slate-400">No colors match the selected filter.</p>
                <button
                  onClick={() => setStatusFilter("all")}
                  className="mt-2 text-rose-600 dark:text-rose-400 hover:text-rose-500 dark:hover:text-rose-300 text-sm"
                >
                  Show all colors
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredColors.map((color) => {
                  const stockStatus = getStockStatus(color.coverageRounds);
                  const isExpanded = expandedColors.has(color.dmcNumber);
                  const statusColor = stockStatus === "critical"
                    ? "border-l-red-500"
                    : stockStatus === "low"
                    ? "border-l-yellow-500"
                    : "border-l-green-500";

                  return (
                    <div
                      key={color.dmcNumber}
                      className={`bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 border-l-4 ${statusColor} overflow-hidden`}
                    >
                      {/* Main row */}
                      <button
                        onClick={() => toggleExpand(color.dmcNumber)}
                        className="w-full p-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                      >
                        {/* Color swatch */}
                        <div
                          className="w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600 flex-shrink-0 flex items-center justify-center text-xs font-bold"
                          style={{ backgroundColor: color.hex, color: getContrastTextColor(color.hex) }}
                        >
                          {color.dmcNumber}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-900 dark:text-white font-medium truncate">{color.colorName}</span>
                            <span className="text-slate-400 dark:text-slate-500 text-sm">#{color.dmcNumber}</span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 text-sm">
                            Used in {color.designCount} design{color.designCount !== 1 ? "s" : ""}
                          </div>
                        </div>

                        {/* Metrics */}
                        <div className="flex items-center gap-4 flex-shrink-0">
                          <div className="text-right">
                            <div className="text-slate-500 dark:text-slate-400 text-xs">Stock</div>
                            <div className="text-slate-900 dark:text-white font-medium">{color.effectiveInventory}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-slate-500 dark:text-slate-400 text-xs">Per Round</div>
                            <div className="text-slate-900 dark:text-white font-medium">{color.totalSkeinsNeeded}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-slate-500 dark:text-slate-400 text-xs">Rounds</div>
                            <div className={`font-bold ${
                              stockStatus === "critical" ? "text-red-600 dark:text-red-400"
                                : stockStatus === "low" ? "text-yellow-600 dark:text-yellow-400"
                                : "text-green-600 dark:text-green-400"
                            }`}>
                              {color.coverageRounds === 999 ? "∞" : color.coverageRounds}
                            </div>
                          </div>
                          <svg
                            className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>

                      {/* Expanded designs list */}
                      {isExpanded && (
                        <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                          <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                            Designs using this color
                          </div>
                          <div className="space-y-2">
                            {color.designs.map((design) => (
                              <Link
                                key={design.id}
                                href={`/design/${design.id}/kit`}
                                className="flex items-center gap-3 p-2 bg-white dark:bg-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                              >
                                {design.previewImageUrl ? (
                                  <img
                                    src={design.previewImageUrl}
                                    alt={design.name}
                                    className="w-8 h-8 object-cover rounded border border-slate-200 dark:border-slate-600"
                                  />
                                ) : (
                                  <div className="w-8 h-8 bg-slate-200 dark:bg-slate-600 rounded flex items-center justify-center">
                                    <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-slate-900 dark:text-white text-sm truncate">{design.name}</div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <div className="text-slate-900 dark:text-white text-sm font-medium">{design.skeinsNeeded} skein{design.skeinsNeeded !== 1 ? "s" : ""}</div>
                                  <div className="text-slate-500 dark:text-slate-400 text-xs">{design.yardsNeeded} yds</div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Order Builder - 1 column */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 sticky top-4">
              <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-slate-900 dark:text-white font-semibold">Order Builder</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                  Build an order to reach your target coverage
                </p>
              </div>

              {/* Target Rounds Selector */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <div className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider mb-2">Target Rounds</div>
                <div className="flex gap-2">
                  {([7, 10, 14] as const).map((rounds) => (
                    <button
                      key={rounds}
                      onClick={() => setTargetRounds(rounds)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        targetRounds === rounds
                          ? "bg-rose-900 text-white"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                      }`}
                    >
                      {rounds}
                    </button>
                  ))}
                </div>
              </div>

              {/* Order Summary */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-500 dark:text-slate-400 text-sm">Colors to order</span>
                  <span className="text-slate-900 dark:text-white font-medium">{orderList.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 text-sm">Total skeins</span>
                  <span className="text-slate-900 dark:text-white font-bold text-lg">{totalSkeinsToOrder}</span>
                </div>
              </div>

              {/* Copy Button */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <button
                  onClick={copyOrderToClipboard}
                  disabled={orderList.length === 0}
                  className="w-full py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-2"
                >
                  {copiedOrder ? (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy Order List
                    </>
                  )}
                </button>
                <p className="text-slate-400 dark:text-slate-500 text-xs mt-2 text-center">
                  Tab-separated: DMC # and quantity
                </p>
              </div>

              {/* Order List */}
              <div className="max-h-96 overflow-y-auto">
                {orderList.length === 0 ? (
                  <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
                    All colors have sufficient stock for {targetRounds} rounds
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-700">
                    {orderList.map((item) => (
                      <div key={item.dmcNumber} className="p-3 flex items-center gap-3">
                        <div
                          className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600 flex-shrink-0"
                          style={{ backgroundColor: item.hex }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-900 dark:text-white text-sm font-medium">{item.dmcNumber}</div>
                          <div className="text-slate-500 dark:text-slate-400 text-xs truncate">{item.colorName}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-slate-900 dark:text-white font-bold">{item.orderQty}</div>
                          <div className="text-slate-400 dark:text-slate-500 text-xs">
                            {item.currentStock} → {item.currentStock + item.orderQty}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

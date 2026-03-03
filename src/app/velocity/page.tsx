"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";

interface DesignVelocity {
  id: string;
  name: string;
  previewImageUrl: string | null;
  salesVelocity: number | null;
  velocityCategory: string | null;
  velocityCategoryOverride: string | null;
  kitsReady: number;
  weeksOfStock: number;
  targetWeeks: number;
  stockStatus: "critical" | "low" | "healthy";
  totalSold: number;
  totalKitsSold: number;
}

interface AlertSummary {
  totalDesigns: number;
  fastCount: number;
  mediumCount: number;
  slowCount: number;
  newCount: number;
  criticalCount: number;
  lowCount: number;
  healthyCount: number;
}

type VelocityFilter = "all" | "fast" | "medium" | "slow" | "new";
type StockFilter = "all" | "critical" | "low" | "healthy";

export default function VelocityPage() {
  const [designs, setDesigns] = useState<DesignVelocity[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [velocityFilter, setVelocityFilter] = useState<VelocityFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/inventory/alerts");
      if (response.ok) {
        const data = await response.json();
        // Transform alerts to our design velocity format
        const velocityDesigns: DesignVelocity[] = (data.alerts || []).map((alert: {
          id: string;
          name: string;
          previewImageUrl: string | null;
          salesVelocity: number | null;
          velocityCategory: string | null;
          velocityCategoryOverride: string | null;
          kitsReady: number;
          weeksOfStock: number;
          targetWeeks: number;
          stockStatus: "critical" | "low" | "healthy";
        }) => ({
          id: alert.id,
          name: alert.name,
          previewImageUrl: alert.previewImageUrl,
          salesVelocity: alert.salesVelocity,
          velocityCategory: alert.velocityCategory,
          velocityCategoryOverride: alert.velocityCategoryOverride,
          kitsReady: alert.kitsReady,
          weeksOfStock: alert.weeksOfStock,
          targetWeeks: alert.targetWeeks,
          stockStatus: alert.stockStatus,
          totalSold: 0, // Not in alerts response, could add if needed
          totalKitsSold: 0,
        }));
        setDesigns(velocityDesigns);
        setSummary(data.summary);
      }
    } catch (error) {
      console.error("Error fetching velocity data:", error);
    }
    setLoading(false);
  };

  const handleRecalculateVelocities = async () => {
    setRecalculating(true);
    try {
      const response = await fetch("/api/inventory/velocity", { method: "POST" });
      if (response.ok) {
        await fetchData();
      }
    } catch (error) {
      console.error("Error recalculating velocities:", error);
    }
    setRecalculating(false);
  };

  const filteredDesigns = useMemo(() => {
    return designs
      .filter((d) => velocityFilter === "all" || d.velocityCategory === velocityFilter)
      .filter((d) => stockFilter === "all" || d.stockStatus === stockFilter);
  }, [designs, velocityFilter, stockFilter]);

  const velocityCategoryConfig = {
    fast: { label: "Fast", color: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300", description: "3+ sales/week" },
    medium: { label: "Medium", color: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300", description: "1-3 sales/week" },
    slow: { label: "Slow", color: "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300", description: "<1 sale/week" },
    new: { label: "New", color: "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300", description: "<1 week old or <6 sales" },
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
                  { label: "Design Velocity" },
                ]}
              />
              <h1 className="text-slate-900 dark:text-white text-lg font-semibold">Design Velocity</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRecalculateVelocities}
              disabled={recalculating}
              className="px-3 py-1.5 bg-rose-900 text-rose-100 rounded-lg hover:bg-rose-800 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              <svg className={`w-4 h-4 ${recalculating ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {recalculating ? "Recalculating..." : "Recalculate"}
            </button>
            <Link
              href="/stock-alerts"
              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-medium"
            >
              Thread Stock
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Velocity Category Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {(["fast", "medium", "slow", "new"] as const).map((cat) => {
            const config = velocityCategoryConfig[cat];
            const count = cat === "fast" ? summary?.fastCount
              : cat === "medium" ? summary?.mediumCount
              : cat === "slow" ? summary?.slowCount
              : summary?.newCount;

            return (
              <button
                key={cat}
                onClick={() => setVelocityFilter(velocityFilter === cat ? "all" : cat)}
                className={`rounded-lg p-4 border transition-all ${
                  velocityFilter === cat
                    ? `${config.color} border-current ring-2 ring-current ring-opacity-50`
                    : `${config.color} border-transparent hover:border-current`
                }`}
              >
                <p className="text-xs uppercase tracking-wider opacity-70">{config.label}</p>
                <p className="text-2xl font-bold">{count || 0}</p>
                <p className="text-xs opacity-70 mt-1">{config.description}</p>
              </button>
            );
          })}
        </div>

        {/* Stock Status Summary */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div
            onClick={() => setStockFilter(stockFilter === "critical" ? "all" : "critical")}
            className={`cursor-pointer bg-red-50 dark:bg-red-900/30 rounded-lg p-3 border transition-all ${
              stockFilter === "critical" ? "border-red-400 ring-2 ring-red-400 ring-opacity-50" : "border-red-200 dark:border-red-800/50 hover:border-red-400"
            }`}
          >
            <p className="text-xs text-red-600 dark:text-red-400 uppercase tracking-wider">Critical Stock</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400">{summary?.criticalCount || 0}</p>
          </div>
          <div
            onClick={() => setStockFilter(stockFilter === "low" ? "all" : "low")}
            className={`cursor-pointer bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-3 border transition-all ${
              stockFilter === "low" ? "border-yellow-400 ring-2 ring-yellow-400 ring-opacity-50" : "border-yellow-200 dark:border-yellow-800/50 hover:border-yellow-400"
            }`}
          >
            <p className="text-xs text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">Low Stock</p>
            <p className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{summary?.lowCount || 0}</p>
          </div>
          <div
            onClick={() => setStockFilter(stockFilter === "healthy" ? "all" : "healthy")}
            className={`cursor-pointer bg-green-50 dark:bg-green-900/30 rounded-lg p-3 border transition-all ${
              stockFilter === "healthy" ? "border-green-400 ring-2 ring-green-400 ring-opacity-50" : "border-green-200 dark:border-green-800/50 hover:border-green-400"
            }`}
          >
            <p className="text-xs text-green-600 dark:text-green-400 uppercase tracking-wider">Healthy Stock</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{summary?.healthyCount || 0}</p>
          </div>
        </div>

        {/* Active Filters */}
        {(velocityFilter !== "all" || stockFilter !== "all") && (
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400 text-sm">Filters:</span>
              {velocityFilter !== "all" && (
                <span className={`px-2 py-1 rounded text-xs font-medium ${velocityCategoryConfig[velocityFilter].color}`}>
                  {velocityCategoryConfig[velocityFilter].label}
                </span>
              )}
              {stockFilter !== "all" && (
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  stockFilter === "critical" ? "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300"
                    : stockFilter === "low" ? "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300"
                    : "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300"
                }`}>
                  {stockFilter.charAt(0).toUpperCase() + stockFilter.slice(1)} Stock
                </span>
              )}
              <span className="text-slate-400 dark:text-slate-500 text-sm">
                ({filteredDesigns.length} of {designs.length})
              </span>
            </div>
            <button
              onClick={() => { setVelocityFilter("all"); setStockFilter("all"); }}
              className="text-rose-600 dark:text-rose-400 hover:text-rose-500 dark:hover:text-rose-300 text-sm"
            >
              Clear
            </button>
          </div>
        )}

        {/* Designs List */}
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
        ) : filteredDesigns.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <p className="text-slate-500 dark:text-slate-400">No designs match the selected filters.</p>
            <button
              onClick={() => { setVelocityFilter("all"); setStockFilter("all"); }}
              className="mt-2 text-rose-600 dark:text-rose-400 hover:text-rose-500 dark:hover:text-rose-300 text-sm"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDesigns.map((design) => {
              const velConfig = velocityCategoryConfig[design.velocityCategory as keyof typeof velocityCategoryConfig] || velocityCategoryConfig.new;
              const stockColor = design.stockStatus === "critical"
                ? "border-l-red-500"
                : design.stockStatus === "low"
                ? "border-l-yellow-500"
                : "border-l-green-500";
              const weeksColor = design.stockStatus === "critical"
                ? "text-red-600 dark:text-red-400"
                : design.stockStatus === "low"
                ? "text-yellow-600 dark:text-yellow-400"
                : "text-green-600 dark:text-green-400";

              return (
                <Link
                  key={design.id}
                  href={`/design/${design.id}/kit`}
                  className={`bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 border-l-4 ${stockColor} overflow-hidden hover:shadow-lg transition-shadow`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Preview */}
                      {design.previewImageUrl ? (
                        <img
                          src={design.previewImageUrl}
                          alt={design.name}
                          className="w-14 h-14 object-cover rounded-lg border border-slate-200 dark:border-slate-600 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 flex items-center justify-center flex-shrink-0">
                          <svg className="w-6 h-6 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-slate-900 dark:text-white font-medium truncate">{design.name}</h3>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${velConfig.color}`}>
                            {velConfig.label}
                          </span>
                        </div>

                        {/* Metrics */}
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-slate-500 dark:text-slate-400 text-xs">Rate</span>
                            <div className="text-slate-900 dark:text-white font-medium">
                              {design.salesVelocity !== null ? `${design.salesVelocity.toFixed(1)}/wk` : "—"}
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-500 dark:text-slate-400 text-xs">Kits Ready</span>
                            <div className="text-slate-900 dark:text-white font-medium">{design.kitsReady}</div>
                          </div>
                          <div>
                            <span className="text-slate-500 dark:text-slate-400 text-xs">Weeks of Stock</span>
                            <div className={`font-medium ${weeksColor}`}>
                              {design.weeksOfStock === 999 ? "∞" : design.weeksOfStock}
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-500 dark:text-slate-400 text-xs">Target</span>
                            <div className="text-slate-900 dark:text-white font-medium">{design.targetWeeks} wks</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

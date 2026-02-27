"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { Breadcrumb } from "@/components/Breadcrumb";

interface ColorRequirement {
  dmcNumber: string;
  colorName: string;
  hex: string;
  skeinsNeeded: number;
  inventorySkeins: number;
  fulfillmentCapacity: number;
}

interface StockAlert {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  fulfillmentCapacity: number;
  bottleneckColors: ColorRequirement[];
  totalColors: number;
  totalSkeinsPerKit: number;
  salesVelocity: number | null;
  velocityCategory: string | null;
  velocityCategoryOverride: string | null;
  kitsReady: number;
  weeksOfStock: number;
  targetWeeks: number;
  stockStatus: "critical" | "low" | "healthy";
}

interface AlertSummary {
  totalDesigns: number;
  criticalCount: number;
  lowCount: number;
  healthyCount: number;
  fastCount?: number;
  mediumCount?: number;
  slowCount?: number;
  newCount?: number;
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

export default function StockAlertsPage() {
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [alertStatusFilter, setAlertStatusFilter] = useState<"all" | "critical" | "low" | "healthy">("all");
  const [velocityFilter, setVelocityFilter] = useState<"all" | "fast" | "medium" | "slow" | "new">("all");

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/inventory/alerts");
      if (response.ok) {
        const data = await response.json();
        setAlerts(data.alerts);
        setAlertSummary(data.summary);
      }
    } catch (error) {
      console.error("Error fetching stock alerts:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleRecalculateVelocities = async () => {
    setRecalculating(true);
    try {
      const response = await fetch("/api/inventory/velocity", { method: "POST" });
      if (response.ok) {
        await fetchAlerts();
      }
    } catch (error) {
      console.error("Error recalculating velocities:", error);
    }
    setRecalculating(false);
  };

  const filteredAlerts = useMemo(() => {
    return alerts
      .filter((alert) => alertStatusFilter === "all" || alert.stockStatus === alertStatusFilter)
      .filter((alert) => velocityFilter === "all" || alert.velocityCategory === velocityFilter);
  }, [alerts, alertStatusFilter, velocityFilter]);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-rose-400 hover:text-rose-300">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <Breadcrumb
                items={[
                  { label: "Home", href: "/" },
                  { label: "Stock Alerts" },
                ]}
              />
              <h1 className="text-white text-lg font-semibold">Stock Alerts</h1>
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
              {recalculating ? "Recalculating..." : "Recalculate Velocities"}
            </button>
            <Link
              href="/inventory"
              className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm font-medium"
            >
              Inventory
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Total Designs</p>
            <p className="text-2xl font-bold text-white">{alertSummary?.totalDesigns || 0}</p>
          </div>
          <div className="bg-red-900/30 rounded-lg p-4 border border-red-800/50">
            <p className="text-xs text-red-400 uppercase tracking-wider">Critical</p>
            <p className="text-2xl font-bold text-red-400">{alertSummary?.criticalCount || 0}</p>
          </div>
          <div className="bg-yellow-900/30 rounded-lg p-4 border border-yellow-800/50">
            <p className="text-xs text-yellow-400 uppercase tracking-wider">Low</p>
            <p className="text-2xl font-bold text-yellow-400">{alertSummary?.lowCount || 0}</p>
          </div>
          <div className="bg-green-900/30 rounded-lg p-4 border border-green-800/50">
            <p className="text-xs text-green-400 uppercase tracking-wider">Healthy</p>
            <p className="text-2xl font-bold text-green-400">{alertSummary?.healthyCount || 0}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 mb-6">
          <div className="flex flex-wrap gap-4">
            {/* Stock Status Filter */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm">Status:</span>
              <div className="flex gap-1">
                {(["all", "critical", "low", "healthy"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setAlertStatusFilter(status)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      alertStatusFilter === status
                        ? status === "critical" ? "bg-red-900 text-white"
                          : status === "low" ? "bg-yellow-900 text-white"
                          : status === "healthy" ? "bg-green-900 text-white"
                          : "bg-slate-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Velocity Filter */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm">Velocity:</span>
              <div className="flex gap-1">
                {(["all", "fast", "medium", "slow", "new"] as const).map((vel) => (
                  <button
                    key={vel}
                    onClick={() => setVelocityFilter(vel)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      velocityFilter === vel
                        ? vel === "fast" ? "bg-emerald-900 text-emerald-100"
                          : vel === "medium" ? "bg-blue-900 text-blue-100"
                          : vel === "slow" ? "bg-slate-600 text-white"
                          : vel === "new" ? "bg-purple-900 text-purple-100"
                          : "bg-slate-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    {vel === "all" ? "All" : vel.charAt(0).toUpperCase() + vel.slice(1)}
                    {vel !== "all" && (
                      <span className="ml-1 opacity-70">
                        ({vel === "fast" ? alertSummary?.fastCount
                          : vel === "medium" ? alertSummary?.mediumCount
                          : vel === "slow" ? alertSummary?.slowCount
                          : alertSummary?.newCount || 0})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {(alertStatusFilter !== "all" || velocityFilter !== "all") && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-slate-500 text-sm">
                  {filteredAlerts.length} of {alerts.length}
                </span>
                <button
                  onClick={() => { setAlertStatusFilter("all"); setVelocityFilter("all"); }}
                  className="text-rose-400 hover:text-rose-300 text-sm"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Alerts List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-white flex items-center gap-3">
              <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading...
            </div>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
            <p className="text-slate-400">No designs match the selected filters.</p>
            <button
              onClick={() => { setAlertStatusFilter("all"); setVelocityFilter("all"); }}
              className="mt-2 text-rose-400 hover:text-rose-300 text-sm"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAlerts.map((alert) => {
              const statusColor = alert.stockStatus === "critical"
                ? "border-red-800/50 bg-red-900/20"
                : alert.stockStatus === "low"
                ? "border-yellow-800/50 bg-yellow-900/20"
                : "border-green-800/50 bg-green-900/20";

              const weeksColor = alert.stockStatus === "critical"
                ? "text-red-400"
                : alert.stockStatus === "low"
                ? "text-yellow-400"
                : "text-green-400";

              const velocityCategoryColor = {
                fast: "bg-emerald-900/50 text-emerald-300",
                medium: "bg-blue-900/50 text-blue-300",
                slow: "bg-slate-700 text-slate-300",
                new: "bg-purple-900/50 text-purple-300",
              }[alert.velocityCategory || "new"] || "bg-slate-700 text-slate-300";

              return (
                <div
                  key={alert.id}
                  className={`rounded-lg border ${statusColor} overflow-hidden`}
                >
                  <div className="p-4 flex items-start gap-4">
                    {/* Preview */}
                    <Link href={`/design/${alert.id}/kit`} className="flex-shrink-0">
                      {alert.previewImageUrl ? (
                        <img
                          src={alert.previewImageUrl}
                          alt={alert.name}
                          className="w-16 h-16 object-cover rounded-lg border border-slate-600"
                        />
                      ) : (
                        <div className="w-16 h-16 bg-slate-700 rounded-lg border border-slate-600 flex items-center justify-center">
                          <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </Link>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link
                            href={`/design/${alert.id}/kit`}
                            className="text-white font-medium hover:text-rose-400 block"
                          >
                            {alert.name}
                          </Link>
                          <p className="text-slate-400 text-sm">
                            {alert.totalColors} colors · {alert.totalSkeinsPerKit} skeins/kit · {alert.kitsReady} ready
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${velocityCategoryColor}`}>
                            {alert.velocityCategory || "new"}
                          </span>
                        </div>
                      </div>

                      {/* Metrics */}
                      <div className="mt-2 flex items-center gap-4 text-sm">
                        <div>
                          <span className="text-slate-500">Weeks of stock:</span>{" "}
                          <span className={`font-medium ${weeksColor}`}>
                            {alert.weeksOfStock === 999 ? "∞" : alert.weeksOfStock}
                          </span>
                          <span className="text-slate-500"> / {alert.targetWeeks} target</span>
                        </div>
                        {alert.salesVelocity !== null && alert.salesVelocity > 0 && (
                          <div>
                            <span className="text-slate-500">Rate:</span>{" "}
                            <span className="text-white font-medium">
                              {alert.salesVelocity.toFixed(1)}/wk
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Bottleneck Colors */}
                      {alert.bottleneckColors.length > 0 && alert.fulfillmentCapacity < 10 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <span className="text-slate-500 text-xs">Low:</span>
                          {alert.bottleneckColors.slice(0, 5).map((color) => (
                            <Link
                              key={color.dmcNumber}
                              href={`/inventory/color/${color.dmcNumber}`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-700 rounded text-xs hover:bg-slate-600"
                            >
                              <span
                                className="w-3 h-3 rounded-sm border border-white/20"
                                style={{ backgroundColor: color.hex }}
                              />
                              <span className="text-white">{color.dmcNumber}</span>
                              <span className="text-slate-400">({color.inventorySkeins})</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Breadcrumb } from "@/components/Breadcrumb";
import { USHeatMap } from "@/components/USHeatMap";

interface DesignAnalytics {
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  totalUnitsSold: number;
  totalKitsSold: number;
  kitAttachmentRate: number;
  kitsReady: number;
  canvasPrinted: number;
  velocityCategory: string | null;
  stockAlert: "critical" | "low" | "ok" | null;
}

interface StateAnalytics {
  state: string;
  stateCode: string;
  orderCount: number;
  totalUnits: number;
  kitUnits: number;
  kitRate: number;
}

interface TimeAnalytics {
  period: string;
  orderCount: number;
  totalUnits: number;
  kitUnits: number;
}

interface ColorDemand {
  dmcNumber: string;
  colorName: string;
  hex: string;
  totalSkeinsNeeded: number;
  designCount: number;
  topDesigns: { name: string; skeins: number }[];
}

interface PeriodComparison {
  orders: { current: number; previous: number; change: number };
  units: { current: number; previous: number; change: number };
  kitRate: { current: number; previous: number; change: number };
  avgOrderSize: { current: number; previous: number; change: number };
}

interface StockAlert {
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  salesLast30Days: number;
  kitsReady: number;
  canvasPrinted: number;
  daysOfStock: number;
  alertLevel: "critical" | "low";
}

interface OrderAnalytics {
  summary: {
    totalOrders: number;
    totalUnits: number;
    totalKitUnits: number;
    overallKitRate: number;
    uniqueCustomers: number;
    repeatCustomerRate: number;
    avgUnitsPerOrder: number;
    periodDays: number;
  };
  comparison: PeriodComparison | null;
  designPerformance: DesignAnalytics[];
  geographicDistribution: StateAnalytics[];
  weeklyTrends: TimeAnalytics[];
  colorDemand: ColorDemand[];
  bundleOpportunities: {
    design1: string;
    design2: string;
    coOccurrences: number;
  }[];
  stockAlerts: StockAlert[];
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

function VelocityBadge({ category }: { category: string | null }) {
  if (!category) return null;
  const colors = {
    fast: "bg-emerald-900/50 text-emerald-400 border-emerald-700",
    medium: "bg-amber-900/50 text-amber-400 border-amber-700",
    slow: "bg-slate-700/50 text-slate-400 border-slate-600",
    new: "bg-blue-900/50 text-blue-400 border-blue-700",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors[category as keyof typeof colors] || colors.new}`}>
      {category}
    </span>
  );
}

function ChangeIndicator({ change, suffix = "%" }: { change: number; suffix?: string }) {
  if (change === 0) return <span className="text-slate-500 text-xs">—</span>;
  const isPositive = change > 0;
  return (
    <span className={`text-xs font-medium flex items-center gap-0.5 ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
      {isPositive ? "↑" : "↓"} {Math.abs(change)}{suffix}
    </span>
  );
}

function StockAlertBadge({ alert }: { alert: "critical" | "low" | "ok" | null }) {
  if (!alert || alert === "ok") return null;
  const colors = {
    critical: "bg-red-900/50 text-red-400 border-red-700",
    low: "bg-amber-900/50 text-amber-400 border-amber-700",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors[alert]}`}>
      {alert === "critical" ? "Low Stock!" : "Stock Low"}
    </span>
  );
}

type SortField = "units" | "kits" | "kitRate" | "stock";
type SortDir = "asc" | "desc";

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "designs" | "geography" | "colors" | "bundles">("overview");
  const [periodDays, setPeriodDays] = useState(90);
  const [sortField, setSortField] = useState<SortField>("units");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [hoveredWeek, setHoveredWeek] = useState<TimeAnalytics | null>(null);

  const { data: analytics, isLoading, error, mutate } = useSWR<OrderAnalytics>(
    `/api/analytics/orders?days=${periodDays}`,
    { revalidateOnFocus: false }
  );

  // Sort design performance
  const sortedDesigns = useMemo(() => {
    if (!analytics) return [];
    const designs = [...analytics.designPerformance];
    designs.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case "units": aVal = a.totalUnitsSold; bVal = b.totalUnitsSold; break;
        case "kits": aVal = a.totalKitsSold; bVal = b.totalKitsSold; break;
        case "kitRate": aVal = a.kitAttachmentRate; bVal = b.kitAttachmentRate; break;
        case "stock": aVal = a.kitsReady + a.canvasPrinted; bVal = b.kitsReady + b.canvasPrinted; break;
        default: aVal = a.totalUnitsSold; bVal = b.totalUnitsSold;
      }
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return designs;
  }, [analytics, sortField, sortDir]);

  const maxUnits = useMemo(() => {
    if (!analytics) return 0;
    return Math.max(...analytics.designPerformance.slice(0, 10).map((d) => d.totalUnitsSold), 1);
  }, [analytics]);

  const maxStateOrders = useMemo(() => {
    if (!analytics) return 0;
    return Math.max(...analytics.geographicDistribution.slice(0, 10).map((s) => s.orderCount), 1);
  }, [analytics]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      className="p-3 text-xs text-slate-400 font-medium text-right cursor-pointer hover:text-white transition-colors"
      onClick={() => handleSort(field)}
    >
      <span className="flex items-center justify-end gap-1">
        {label}
        {sortField === field && (
          <span className="text-rose-400">{sortDir === "desc" ? "↓" : "↑"}</span>
        )}
      </span>
    </th>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white flex items-center gap-3">
          <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading analytics...
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">Failed to load analytics</p>
          <button onClick={() => mutate()} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">
            Retry
          </button>
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
            <Link href="/" className="text-slate-400 hover:text-white" title="Home">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-white">Order Analytics</h1>
            <button onClick={() => mutate()} className="p-1.5 text-slate-400 hover:text-white" title="Refresh">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Period Selector */}
          <div className="flex items-center gap-2">
            {[30, 90, 180, 365].map((days) => (
              <button
                key={days}
                onClick={() => setPeriodDays(days)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  periodDays === days
                    ? "bg-rose-900 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-700"
                }`}
              >
                {days === 365 ? "1Y" : `${days}D`}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto pb-2">
            {[
              { id: "overview", label: "Overview" },
              { id: "designs", label: "Design Performance" },
              { id: "geography", label: "Geographic" },
              { id: "colors", label: "Color Demand" },
              { id: "bundles", label: "Bundles" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <Breadcrumb items={[{ label: "Analytics" }]} className="mb-4" />

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Summary Cards with Comparison */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Orders</p>
                <p className="text-2xl font-bold text-white">{analytics.summary.totalOrders}</p>
                {analytics.comparison && (
                  <ChangeIndicator change={analytics.comparison.orders.change} />
                )}
              </div>
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Units Sold</p>
                <p className="text-2xl font-bold text-white">{analytics.summary.totalUnits}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{analytics.summary.avgUnitsPerOrder}/order</span>
                  {analytics.comparison && (
                    <ChangeIndicator change={analytics.comparison.units.change} />
                  )}
                </div>
              </div>
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Kit Attachment</p>
                <p className="text-2xl font-bold text-emerald-400">{analytics.summary.overallKitRate}%</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{analytics.summary.totalKitUnits} kits</span>
                  {analytics.comparison && (
                    <ChangeIndicator change={analytics.comparison.kitRate.change} suffix="pt" />
                  )}
                </div>
              </div>
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Repeat Customers</p>
                <p className="text-2xl font-bold text-amber-400">{analytics.summary.repeatCustomerRate}%</p>
                <p className="text-xs text-slate-500">{analytics.summary.uniqueCustomers} unique</p>
              </div>
            </div>

            {/* Stock Alerts */}
            {analytics.stockAlerts.length > 0 && (
              <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-4">
                <h3 className="text-red-400 font-semibold mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Stock Alerts - Fast Sellers Running Low
                </h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {analytics.stockAlerts.slice(0, 6).map((alert) => (
                    <Link
                      key={alert.designId}
                      href={`/design/${alert.designId}/info`}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                        alert.alertLevel === "critical" ? "bg-red-900/30 hover:bg-red-900/50" : "bg-amber-900/30 hover:bg-amber-900/50"
                      }`}
                    >
                      {alert.previewImageUrl ? (
                        <img src={alert.previewImageUrl} alt="" className="w-10 h-10 rounded object-cover" />
                      ) : (
                        <div className="w-10 h-10 bg-slate-700 rounded" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{alert.designName}</p>
                        <p className="text-xs text-slate-400">
                          {alert.salesLast30Days}/mo · {alert.kitsReady + alert.canvasPrinted} in stock
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${alert.alertLevel === "critical" ? "text-red-400" : "text-amber-400"}`}>
                          {alert.daysOfStock}d
                        </p>
                        <p className="text-[10px] text-slate-500">left</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Weekly Trend with Hover */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Weekly Sales Trend</h3>
                {hoveredWeek && (
                  <div className="text-sm text-slate-300 bg-slate-700 px-3 py-1 rounded">
                    {new Date(hoveredWeek.period).toLocaleDateString("en-US", { month: "short", day: "numeric" })}:
                    <span className="text-white font-medium ml-2">{hoveredWeek.totalUnits} units</span>
                    <span className="text-emerald-400 ml-2">({hoveredWeek.kitUnits} kits)</span>
                  </div>
                )}
              </div>
              <div className="flex items-end gap-1 h-32">
                {analytics.weeklyTrends.slice(-12).map((week) => {
                  const maxWeekUnits = Math.max(...analytics.weeklyTrends.slice(-12).map((w) => w.totalUnits), 1);
                  const height = (week.totalUnits / maxWeekUnits) * 100;
                  const kitHeight = (week.kitUnits / maxWeekUnits) * 100;
                  return (
                    <div
                      key={week.period}
                      className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
                      onMouseEnter={() => setHoveredWeek(week)}
                      onMouseLeave={() => setHoveredWeek(null)}
                    >
                      <div className="w-full relative" style={{ height: "100px" }}>
                        <div
                          className={`absolute bottom-0 w-full rounded-t transition-colors ${
                            hoveredWeek?.period === week.period ? "bg-slate-500" : "bg-slate-600"
                          }`}
                          style={{ height: `${height}%` }}
                        />
                        <div
                          className={`absolute bottom-0 w-full rounded-t transition-colors ${
                            hoveredWeek?.period === week.period ? "bg-emerald-400" : "bg-emerald-500"
                          }`}
                          style={{ height: `${kitHeight}%` }}
                        />
                      </div>
                      <span className="text-[8px] text-slate-500 -rotate-45 origin-center whitespace-nowrap">
                        {new Date(week.period).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-4 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-slate-600 rounded" />
                  <span className="text-slate-400">Canvas Only</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-emerald-500 rounded" />
                  <span className="text-slate-400">With Kit</span>
                </div>
              </div>
            </div>

            {/* Top Designs Quick View */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Top Selling Designs</h3>
                <button onClick={() => setActiveTab("designs")} className="text-sm text-rose-400 hover:text-rose-300">
                  View All
                </button>
              </div>
              <div className="space-y-2">
                {analytics.designPerformance.slice(0, 5).map((design, i) => (
                  <div key={design.designId} className="flex items-center gap-3">
                    <span className="text-slate-500 text-sm w-4">{i + 1}</span>
                    {design.previewImageUrl ? (
                      <img src={design.previewImageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                    ) : (
                      <div className="w-8 h-8 bg-slate-700 rounded" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate">{design.designName}</p>
                      <p className="text-xs text-slate-400">{design.kitAttachmentRate}% kit rate</p>
                    </div>
                    <StockAlertBadge alert={design.stockAlert} />
                    <div className="text-right">
                      <p className="text-white font-medium">{design.totalUnitsSold}</p>
                      <p className="text-xs text-slate-500">units</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">Top States</h3>
                  <button onClick={() => setActiveTab("geography")} className="text-sm text-rose-400 hover:text-rose-300">
                    View All
                  </button>
                </div>
                <div className="space-y-2">
                  {analytics.geographicDistribution.slice(0, 5).map((state) => (
                    <div key={state.stateCode} className="flex items-center gap-3">
                      <span className="text-slate-400 text-sm w-16">{state.stateCode}</span>
                      <div className="flex-1 bg-slate-700 rounded-full h-2">
                        <div
                          className="bg-rose-500 h-2 rounded-full"
                          style={{ width: `${(state.orderCount / maxStateOrders) * 100}%` }}
                        />
                      </div>
                      <span className="text-white text-sm w-8 text-right">{state.orderCount}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">Bundle Opportunities</h3>
                  <button onClick={() => setActiveTab("bundles")} className="text-sm text-rose-400 hover:text-rose-300">
                    View All
                  </button>
                </div>
                {analytics.bundleOpportunities.length === 0 ? (
                  <p className="text-slate-500 text-sm">No bundle patterns found yet</p>
                ) : (
                  <div className="space-y-2">
                    {analytics.bundleOpportunities.slice(0, 3).map((bundle, i) => (
                      <div key={i} className="p-2 bg-slate-700/50 rounded-lg">
                        <p className="text-white text-sm truncate">{bundle.design1}</p>
                        <p className="text-slate-400 text-xs">+ {bundle.design2}</p>
                        <p className="text-emerald-400 text-xs mt-1">{bundle.coOccurrences} orders together</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Designs Tab - Sortable */}
        {activeTab === "designs" && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-white font-semibold">Design Performance</h3>
              <p className="text-sm text-slate-400">Click column headers to sort</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 text-left">
                    <th className="p-3 text-xs text-slate-400 font-medium">Design</th>
                    <SortHeader field="units" label="Units Sold" />
                    <SortHeader field="kits" label="Kits Sold" />
                    <SortHeader field="kitRate" label="Kit Rate" />
                    <SortHeader field="stock" label="In Stock" />
                    <th className="p-3 text-xs text-slate-400 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDesigns.map((design) => (
                    <tr key={design.designId} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <td className="p-3">
                        <Link href={`/design/${design.designId}/info`} className="flex items-center gap-3 hover:text-rose-400">
                          {design.previewImageUrl ? (
                            <img src={design.previewImageUrl} alt="" className="w-10 h-10 rounded object-cover" />
                          ) : (
                            <div className="w-10 h-10 bg-slate-700 rounded" />
                          )}
                          <span className="text-white text-sm">{design.designName}</span>
                        </Link>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 bg-slate-700 rounded-full h-1.5">
                            <div
                              className="bg-rose-500 h-1.5 rounded-full"
                              style={{ width: `${(design.totalUnitsSold / maxUnits) * 100}%` }}
                            />
                          </div>
                          <span className="text-white text-sm w-8">{design.totalUnitsSold}</span>
                        </div>
                      </td>
                      <td className="p-3 text-right text-emerald-400 text-sm">{design.totalKitsSold}</td>
                      <td className="p-3 text-right">
                        <span className={`text-sm ${design.kitAttachmentRate >= 50 ? "text-emerald-400" : design.kitAttachmentRate >= 25 ? "text-amber-400" : "text-slate-400"}`}>
                          {design.kitAttachmentRate}%
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <span className="text-slate-400 text-sm">{design.kitsReady} kits</span>
                        <span className="text-slate-600 text-sm"> / {design.canvasPrinted} canvas</span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <VelocityBadge category={design.velocityCategory} />
                          <StockAlertBadge alert={design.stockAlert} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Geography Tab */}
        {activeTab === "geography" && (
          <div className="space-y-4">
            {/* US Heat Map */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <h3 className="text-white font-semibold mb-4">Order Distribution Map</h3>
              <USHeatMap data={analytics.geographicDistribution} />
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="p-4 border-b border-slate-700">
                <h3 className="text-white font-semibold">Sales by State</h3>
                <p className="text-sm text-slate-400">Geographic distribution and kit preferences</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700 text-left">
                      <th className="p-3 text-xs text-slate-400 font-medium">State</th>
                      <th className="p-3 text-xs text-slate-400 font-medium text-right">Orders</th>
                      <th className="p-3 text-xs text-slate-400 font-medium text-right">Units</th>
                      <th className="p-3 text-xs text-slate-400 font-medium text-right">Kit Units</th>
                      <th className="p-3 text-xs text-slate-400 font-medium text-right">Kit Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.geographicDistribution.map((state) => (
                      <tr key={state.stateCode} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                        <td className="p-3">
                          <span className="text-white text-sm">{state.state}</span>
                          <span className="text-slate-500 text-xs ml-2">({state.stateCode})</span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-24 bg-slate-700 rounded-full h-1.5">
                              <div
                                className="bg-rose-500 h-1.5 rounded-full"
                                style={{ width: `${(state.orderCount / maxStateOrders) * 100}%` }}
                              />
                            </div>
                            <span className="text-white text-sm w-8">{state.orderCount}</span>
                          </div>
                        </td>
                        <td className="p-3 text-right text-white text-sm">{state.totalUnits}</td>
                        <td className="p-3 text-right text-emerald-400 text-sm">{state.kitUnits}</td>
                        <td className="p-3 text-right">
                          <span className={`text-sm ${state.kitRate >= 50 ? "text-emerald-400" : state.kitRate >= 25 ? "text-amber-400" : "text-slate-400"}`}>
                            {state.kitRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {analytics.geographicDistribution.length > 0 && (
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <h3 className="text-white font-semibold mb-3">Kit Preference Insights</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-slate-400 text-sm mb-2">Highest Kit Attachment</p>
                    {analytics.geographicDistribution
                      .filter((s) => s.totalUnits >= 3)
                      .sort((a, b) => b.kitRate - a.kitRate)
                      .slice(0, 3)
                      .map((state) => (
                        <div key={state.stateCode} className="flex items-center justify-between py-1">
                          <span className="text-white text-sm">{state.state}</span>
                          <span className="text-emerald-400 text-sm font-medium">{state.kitRate}%</span>
                        </div>
                      ))}
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm mb-2">Lowest Kit Attachment</p>
                    {analytics.geographicDistribution
                      .filter((s) => s.totalUnits >= 3)
                      .sort((a, b) => a.kitRate - b.kitRate)
                      .slice(0, 3)
                      .map((state) => (
                        <div key={state.stateCode} className="flex items-center justify-between py-1">
                          <span className="text-white text-sm">{state.state}</span>
                          <span className="text-amber-400 text-sm font-medium">{state.kitRate}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Colors Tab */}
        {activeTab === "colors" && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-white font-semibold">Color Demand</h3>
              <p className="text-sm text-slate-400">Most used colors across sold designs - prioritize stocking these</p>
            </div>
            <div className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {analytics.colorDemand.map((color, i) => (
                <Link
                  key={color.dmcNumber}
                  href={`/inventory/color/${color.dmcNumber}`}
                  className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
                >
                  <span className="text-slate-500 text-sm w-4">{i + 1}</span>
                  <div
                    className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: color.hex }}
                  >
                    <span className="text-[8px] font-bold" style={{ color: getContrastTextColor(color.hex) }}>
                      {color.dmcNumber}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{color.dmcNumber}</p>
                    <p className="text-slate-400 text-xs truncate">{color.colorName}</p>
                    <p className="text-slate-500 text-xs">In {color.designCount} designs</p>
                  </div>
                  <div className="text-right">
                    <p className="text-emerald-400 font-medium">{color.totalSkeinsNeeded}</p>
                    <p className="text-slate-500 text-xs">demand</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Bundles Tab */}
        {activeTab === "bundles" && (
          <div className="space-y-4">
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <h3 className="text-white font-semibold mb-2">Bundle Opportunities</h3>
              <p className="text-sm text-slate-400 mb-4">
                Designs frequently purchased together - consider creating bundle offers
              </p>

              {analytics.bundleOpportunities.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500">No bundle patterns detected yet</p>
                  <p className="text-slate-600 text-sm">Need more multi-item orders to identify patterns</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {analytics.bundleOpportunities.map((bundle, i) => (
                    <div key={i} className="p-4 bg-slate-700/50 rounded-lg">
                      <div className="flex items-start justify-between mb-3">
                        <span className="px-2 py-0.5 bg-emerald-900/50 text-emerald-400 rounded text-xs font-medium">
                          {bundle.coOccurrences} orders together
                        </span>
                      </div>
                      <div className="space-y-2">
                        <p className="text-white font-medium">{bundle.design1}</p>
                        <p className="text-slate-400 text-sm flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          {bundle.design2}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-4">
              <h4 className="text-amber-400 font-medium mb-2">Bundle Strategy Tips</h4>
              <ul className="text-sm text-slate-300 space-y-1">
                <li>- Designs bought together often share similar themes or color palettes</li>
                <li>- Consider offering a 10-15% discount for bundle purchases</li>
                <li>- Bundles with complementary sizes (small + medium) work well</li>
                <li>- Promote bundles to customers who bought one of the designs</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DmcColor, searchDmcColors, getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

interface InventoryItem {
  id: string;
  dmcNumber: string;
  size: number;
  skeins: number;
  createdAt: string;
  updatedAt: string;
}

interface Design {
  id: string;
  name: string;
  previewImageUrl: string | null;
  kitsReady: number;
  canvasPrinted: number;
  isDraft: boolean;
  kitColorCount: number;
  kitSkeinCount: number;
  widthInches: number;
  heightInches: number;
  meshCount: number;
}

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
}

interface AlertSummary {
  totalDesigns: number;
  criticalCount: number;
  lowCount: number;
  healthyCount: number;
}

interface MostUsedColor {
  dmcNumber: string;
  colorName: string;
  hex: string;
  totalStitches: number;
  designCount: number;
  totalSkeinsNeeded: number;
  inventorySkeins: number;
  threadSize: 5 | 8;
}

interface ColorUsageDesign {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
}

interface ColorUsage {
  dmcNumber: string;
  designs: ColorUsageDesign[];
}

type TabType = "threads" | "kits" | "canvases" | "alerts";

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

export default function InventoryPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>("threads");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [mostUsedColors, setMostUsedColors] = useState<MostUsedColor[]>([]);
  const [colorUsage, setColorUsage] = useState<Map<string, ColorUsageDesign[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [sizeFilter, setSizeFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedColor, setExpandedColor] = useState<string | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [selectedColor, setSelectedColor] = useState<DmcColor | null>(null);
  const [addSize, setAddSize] = useState<5 | 8>(5);
  const [addSkeins, setAddSkeins] = useState("1");
  const [adding, setAdding] = useState(false);

  // Track pending values being typed
  const [pendingSkeins, setPendingSkeins] = useState<Record<string, string>>({});
  const [pendingKits, setPendingKits] = useState<Record<string, string>>({});
  const [pendingCanvases, setPendingCanvases] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchInventory();
    fetchDesigns();
    fetchColorUsage();
  }, []);

  const fetchColorUsage = async () => {
    try {
      const response = await fetch("/api/colors/usage");
      if (response.ok) {
        const data: ColorUsage[] = await response.json();
        const usageMap = new Map<string, ColorUsageDesign[]>();
        for (const item of data) {
          usageMap.set(item.dmcNumber, item.designs);
        }
        setColorUsage(usageMap);
      }
    } catch (error) {
      console.error("Error fetching color usage:", error);
    }
  };

  // Fetch alerts when tab changes to alerts
  useEffect(() => {
    if (activeTab === "alerts" && alerts.length === 0) {
      fetchAlerts();
    }
  }, [activeTab]);

  const fetchInventory = async () => {
    try {
      const response = await fetch("/api/inventory");
      if (response.ok) {
        const data = await response.json();
        setItems(data);
      }
    } catch (error) {
      console.error("Error fetching inventory:", error);
    }
    setLoading(false);
  };

  const fetchDesigns = async () => {
    try {
      const response = await fetch("/api/designs");
      if (response.ok) {
        const data = await response.json();
        // Filter out drafts
        setDesigns(data.filter((d: Design) => !d.isDraft));
      }
    } catch (error) {
      console.error("Error fetching designs:", error);
    }
  };

  const fetchAlerts = async () => {
    setAlertsLoading(true);
    try {
      const response = await fetch("/api/inventory/alerts");
      if (response.ok) {
        const data = await response.json();
        setAlerts(data.alerts);
        setAlertSummary(data.summary);
        setMostUsedColors(data.mostUsedColors || []);
      }
    } catch (error) {
      console.error("Error fetching stock alerts:", error);
    }
    setAlertsLoading(false);
  };

  const filteredItems = useMemo(() => {
    let result = items;
    if (sizeFilter !== null) {
      result = result.filter((item) => item.size === sizeFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => {
        const color = getDmcColorByNumber(item.dmcNumber);
        return (
          item.dmcNumber.toLowerCase().includes(q) ||
          (color && color.name.toLowerCase().includes(q))
        );
      });
    }
    // Sort by DMC number numerically
    result = [...result].sort((a, b) => {
      const numA = parseInt(a.dmcNumber, 10);
      const numB = parseInt(b.dmcNumber, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      if (!isNaN(numA)) return -1;
      if (!isNaN(numB)) return 1;
      return a.dmcNumber.localeCompare(b.dmcNumber);
    });
    return result;
  }, [items, sizeFilter, searchQuery]);

  const filteredDesigns = useMemo(() => {
    if (!searchQuery) return designs;
    const q = searchQuery.toLowerCase();
    return designs.filter((d) => d.name.toLowerCase().includes(q));
  }, [designs, searchQuery]);

  // Search results for main search - colors not in inventory
  const mainSearchSuggestions = useMemo(() => {
    if (!searchQuery || filteredItems.length > 0 || activeTab !== "threads") return [];
    const matches = searchDmcColors(searchQuery).slice(0, 10);
    const inventoryDmcNumbers = new Set(
      items
        .filter((item) => sizeFilter === null || item.size === sizeFilter)
        .map((item) => item.dmcNumber)
    );
    return matches.filter((color) => !inventoryDmcNumbers.has(color.dmcNumber));
  }, [searchQuery, filteredItems.length, items, sizeFilter, activeTab]);

  const addColorResults = useMemo(() => {
    if (!addSearch) return [];
    return searchDmcColors(addSearch).slice(0, 20);
  }, [addSearch]);

  const handleAdd = async () => {
    const skeinsNum = Math.max(1, Number(addSkeins) || 1);
    if (!selectedColor) return;
    setAdding(true);
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dmcNumber: selectedColor.dmcNumber,
          size: addSize,
          skeins: skeinsNum,
        }),
      });
      if (response.ok) {
        await fetchInventory();
        setSelectedColor(null);
        setAddSearch("");
        setAddSkeins("1");
        setShowAddForm(false);
      }
    } catch (error) {
      console.error("Error adding inventory item:", error);
    }
    setAdding(false);
  };

  const handleUpdateSkeins = async (id: string, skeins: number) => {
    const clamped = Math.max(0, skeins);
    setItems(items.map((item) => (item.id === id ? { ...item, skeins: clamped } : item)));
    setPendingSkeins((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const response = await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skeins: clamped }),
      });
      if (!response.ok) {
        await fetchInventory();
      }
    } catch (error) {
      console.error("Error updating inventory item:", error);
      await fetchInventory();
    }
  };

  const handleUpdateDesign = async (id: string, field: "kitsReady" | "canvasPrinted", delta: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;

    const currentVal = field === "kitsReady" ? design.kitsReady : design.canvasPrinted;
    const newVal = Math.max(0, currentVal + delta);

    // Optimistic update
    setDesigns(designs.map((d) => (d.id === id ? { ...d, [field]: newVal } : d)));

    // Clear pending
    if (field === "kitsReady") {
      setPendingKits((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } else {
      setPendingCanvases((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }

    try {
      const body = field === "kitsReady"
        ? { kitsReadyDelta: delta }
        : { canvasPrintedDelta: delta };

      const response = await fetch(`/api/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await fetchDesigns();
      }
    } catch (error) {
      console.error("Error updating design:", error);
      await fetchDesigns();
    }
  };

  const handleSetDesignValue = async (id: string, field: "kitsReady" | "canvasPrinted", value: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;

    const currentVal = field === "kitsReady" ? design.kitsReady : design.canvasPrinted;
    const newVal = Math.max(0, value);
    const delta = newVal - currentVal;

    if (delta !== 0) {
      await handleUpdateDesign(id, field, delta);
    } else {
      // Just clear pending
      if (field === "kitsReady") {
        setPendingKits((prev) => { const next = { ...prev }; delete next[id]; return next; });
      } else {
        setPendingCanvases((prev) => { const next = { ...prev }; delete next[id]; return next; });
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this thread from inventory?")) return;
    try {
      const response = await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      if (response.ok) {
        setItems(items.filter((item) => item.id !== id));
      }
    } catch (error) {
      console.error("Error deleting inventory item:", error);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const totalSkeins = filteredItems.reduce((sum, item) => sum + item.skeins, 0);
  const totalYards = totalSkeins * 27;
  const size5Count = items.filter((i) => i.size === 5).length;
  const size8Count = items.filter((i) => i.size === 8).length;
  const totalKitsReady = designs.reduce((sum, d) => sum + d.kitsReady, 0);
  const totalCanvasesPrinted = designs.reduce((sum, d) => sum + d.canvasPrinted, 0);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <Link
              href="/"
              className="w-9 h-9 md:w-10 md:h-10 bg-gradient-to-br from-rose-900 to-rose-800 rounded-xl flex items-center justify-center flex-shrink-0"
            >
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-bold text-white truncate">Inventory</h1>
              <p className="text-xs md:text-sm text-slate-400 hidden sm:block">
                Threads, Kits & Canvases
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {activeTab === "threads" && (
              <button
                onClick={() => setShowAddForm(true)}
                className="px-3 md:px-4 py-2 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 transition-all flex items-center gap-2 text-sm md:text-base"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Add Thread</span>
              </button>
            )}
            <Link
              href="/"
              className="p-2 text-slate-400 hover:text-white"
              title="Back to Designs"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </Link>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-white"
              title="Logout"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-800 p-1 rounded-lg border border-slate-700 w-fit">
          <button
            onClick={() => setActiveTab("threads")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "threads"
                ? "bg-rose-900 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            Threads
            <span className="ml-2 text-xs opacity-75">({items.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("kits")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "kits"
                ? "bg-rose-900 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            Kits Ready
            <span className="ml-2 text-xs opacity-75">({totalKitsReady})</span>
          </button>
          <button
            onClick={() => setActiveTab("canvases")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "canvases"
                ? "bg-rose-900 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            Canvases
            <span className="ml-2 text-xs opacity-75">({totalCanvasesPrinted})</span>
          </button>
          <button
            onClick={() => setActiveTab("alerts")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${
              activeTab === "alerts"
                ? "bg-rose-900 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            {alertSummary && alertSummary.criticalCount > 0 && (
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            )}
            Stock Alerts
            {alertSummary && alertSummary.criticalCount > 0 && (
              <span className="ml-1 text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                {alertSummary.criticalCount}
              </span>
            )}
          </button>
        </div>

        {/* Threads Tab */}
        {activeTab === "threads" && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Colors</p>
                <p className="text-xl font-bold text-white">{items.length}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Skeins</p>
                <p className="text-xl font-bold text-white">{totalSkeins}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Yards</p>
                <p className="text-xl font-bold text-white">{totalYards.toLocaleString()}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">By Size</p>
                <p className="text-sm font-medium text-white">
                  Size 5: {size5Count} &middot; Size 8: {size8Count}
                </p>
              </div>
            </div>

            {/* Search and filter */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by DMC number or name..."
                className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setSizeFilter(null)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    sizeFilter === null
                      ? "bg-rose-900 text-white"
                      : "bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setSizeFilter(5)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    sizeFilter === 5
                      ? "bg-rose-900 text-white"
                      : "bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  Size 5 (14 mesh)
                </button>
                <button
                  onClick={() => setSizeFilter(8)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    sizeFilter === 8
                      ? "bg-rose-900 text-white"
                      : "bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  Size 8 (18 mesh)
                </button>
              </div>
            </div>

            {/* Thread list */}
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-white flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading inventory...
                </div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12 md:py-16">
                <div className="w-14 h-14 md:w-16 md:h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 md:w-8 md:h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h2 className="text-lg md:text-xl font-semibold text-white mb-2">
                  {items.length === 0 ? "No threads in inventory" : "No matching threads"}
                </h2>
                <p className="text-slate-400 mb-6 text-sm md:text-base px-4">
                  {items.length === 0
                    ? "Add your DMC Pearl Cotton threads to track your collection."
                    : "Try a different search or filter."}
                </p>
                {items.length === 0 && (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="inline-flex items-center gap-2 px-5 md:px-6 py-2.5 md:py-3 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 transition-all text-sm md:text-base"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Your First Thread
                  </button>
                )}

                {/* Quick-add suggestions when searching */}
                {searchQuery && mainSearchSuggestions.length > 0 && (
                  <div className="mt-8 max-w-2xl mx-auto">
                    <p className="text-slate-400 text-sm mb-3">Add to inventory:</p>
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                      {mainSearchSuggestions.map((color) => {
                        const usedInDesigns = colorUsage.get(color.dmcNumber) || [];
                        return (
                          <div
                            key={color.dmcNumber}
                            className="p-3 border-b border-slate-700 last:border-b-0 hover:bg-slate-750"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="w-10 h-10 rounded-lg border border-white/20 flex-shrink-0 flex items-center justify-center"
                                style={{ backgroundColor: color.hex }}
                              >
                                <span
                                  className="text-[7px] font-bold"
                                  style={{ color: getContrastTextColor(color.hex) }}
                                >
                                  {color.dmcNumber}
                                </span>
                              </div>
                              <div className="flex-1 text-left min-w-0">
                                <p className="text-white text-sm font-medium">DMC {color.dmcNumber}</p>
                                <p className="text-slate-400 text-xs">{color.name}</p>
                              </div>
                              {usedInDesigns.length > 0 && (
                                <span className="text-xs text-rose-400 hidden sm:block">
                                  Used in {usedInDesigns.length} design{usedInDesigns.length !== 1 ? "s" : ""}
                                </span>
                              )}
                              <button
                                onClick={() => {
                                  setSelectedColor(color);
                                  setAddSearch("");
                                  setShowAddForm(true);
                                }}
                                className="px-3 py-1.5 bg-rose-900 text-white text-xs font-medium rounded-lg hover:bg-rose-950 transition-colors flex-shrink-0"
                              >
                                Add
                              </button>
                            </div>
                            {/* Show designs using this color */}
                            {usedInDesigns.length > 0 && (
                              <div className="mt-2 pl-13 flex flex-wrap gap-1.5">
                                {usedInDesigns.slice(0, 5).map((design) => (
                                  <Link
                                    key={design.id}
                                    href={`/design/${design.id}`}
                                    className="flex items-center gap-1 bg-slate-700/50 rounded px-2 py-0.5 hover:bg-slate-600 transition-colors"
                                  >
                                    {design.previewImageUrl ? (
                                      <img
                                        src={design.previewImageUrl}
                                        alt={design.name}
                                        className="w-4 h-4 object-cover rounded"
                                      />
                                    ) : (
                                      <div className="w-4 h-4 bg-slate-600 rounded" />
                                    )}
                                    <span className="text-xs text-slate-300 truncate max-w-[100px]">{design.name}</span>
                                  </Link>
                                ))}
                                {usedInDesigns.length > 5 && (
                                  <span className="text-xs text-slate-500 px-2 py-0.5">
                                    +{usedInDesigns.length - 5} more
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700 text-left">
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Color</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">DMC #</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden sm:table-cell">Name</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Size</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Skeins</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden md:table-cell">Yards</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden lg:table-cell">Used In</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {filteredItems.map((item) => {
                      const color = getDmcColorByNumber(item.dmcNumber);
                      const usedInDesigns = colorUsage.get(item.dmcNumber) || [];
                      const isExpanded = expandedColor === item.dmcNumber;
                      return (
                        <React.Fragment key={item.id}>
                          <tr className="hover:bg-slate-750 transition-colors">
                            <td className="px-4 py-3">
                              <div
                                className="w-10 h-10 rounded-lg border border-white/20 flex items-center justify-center"
                                style={{ backgroundColor: color?.hex || "#666" }}
                              >
                                <span
                                  className="text-[7px] font-bold select-none"
                                  style={{ color: color ? getContrastTextColor(color.hex) : "#fff" }}
                                >
                                  {item.dmcNumber}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-white font-medium">{item.dmcNumber}</span>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <span className="text-slate-300">{color?.name || "Unknown"}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                item.size === 5
                                  ? "bg-blue-900/50 text-blue-300"
                                  : "bg-purple-900/50 text-purple-300"
                              }`}>
                                Size {item.size}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleUpdateSkeins(item.id, item.skeins - 1)}
                                  className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                                  title="Remove 1 skein"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                  </svg>
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={pendingSkeins[item.id] ?? item.skeins}
                                  onChange={(e) => setPendingSkeins((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                  onBlur={() => {
                                    const val = pendingSkeins[item.id];
                                    if (val !== undefined) {
                                      handleUpdateSkeins(item.id, Number(val));
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const val = pendingSkeins[item.id];
                                      if (val !== undefined) {
                                        handleUpdateSkeins(item.id, Number(val));
                                      }
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-rose-800"
                                />
                                <button
                                  onClick={() => handleUpdateSkeins(item.id, item.skeins + 1)}
                                  className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                                  title="Add 1 skein"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className="text-slate-400">{item.skeins * 27} yds</span>
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell">
                              {usedInDesigns.length > 0 ? (
                                <button
                                  onClick={() => setExpandedColor(isExpanded ? null : item.dmcNumber)}
                                  className="flex items-center gap-1 text-sm text-rose-400 hover:text-rose-300"
                                >
                                  <span>{usedInDesigns.length} design{usedInDesigns.length !== 1 ? "s" : ""}</span>
                                  <svg
                                    className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              ) : (
                                <span className="text-slate-500 text-sm">Not used</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {/* Show expand button on smaller screens */}
                                <button
                                  onClick={() => setExpandedColor(isExpanded ? null : item.dmcNumber)}
                                  className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors lg:hidden"
                                  title={`Used in ${usedInDesigns.length} designs`}
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDelete(item.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                                  title="Remove from inventory"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* Expanded row showing designs */}
                          {isExpanded && usedInDesigns.length > 0 && (
                            <tr>
                              <td colSpan={8} className="px-4 py-3 bg-slate-750">
                                <div className="pl-4 border-l-2 border-rose-800">
                                  <p className="text-xs text-slate-400 mb-2">Used in {usedInDesigns.length} design{usedInDesigns.length !== 1 ? "s" : ""}:</p>
                                  <div className="flex flex-wrap gap-2">
                                    {usedInDesigns.map((design) => (
                                      <Link
                                        key={design.id}
                                        href={`/design/${design.id}`}
                                        className="flex items-center gap-2 bg-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-600 transition-colors"
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
                                        <span className="text-sm text-white">{design.name}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                                          design.meshCount === 14 ? "bg-blue-900/50 text-blue-300" : "bg-purple-900/50 text-purple-300"
                                        }`}>
                                          {design.meshCount}
                                        </span>
                                      </Link>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Kits Ready Tab */}
        {activeTab === "kits" && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Kits Ready</p>
                <p className="text-xl font-bold text-white">{totalKitsReady}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Designs</p>
                <p className="text-xl font-bold text-white">{designs.length}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">With Stock</p>
                <p className="text-xl font-bold text-white">{designs.filter(d => d.kitsReady > 0).length}</p>
              </div>
            </div>

            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="w-full max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
            </div>

            {/* Designs list */}
            {filteredDesigns.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-400">No designs found</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {filteredDesigns.map((design) => (
                  <div
                    key={design.id}
                    className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex items-center gap-4"
                  >
                    {/* Preview */}
                    <Link href={`/design/${design.id}`} className="flex-shrink-0">
                      {design.previewImageUrl ? (
                        <img
                          src={design.previewImageUrl}
                          alt={design.name}
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
                      <Link href={`/design/${design.id}`} className="text-white font-medium hover:text-rose-400 truncate block">
                        {design.name}
                      </Link>
                      <p className="text-slate-400 text-sm">
                        {design.kitColorCount} colors &middot; {design.kitSkeinCount} skeins/kit
                      </p>
                    </div>

                    {/* Kits Ready control */}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-sm hidden sm:block">Kits Ready:</span>
                      <button
                        onClick={() => handleUpdateDesign(design.id, "kitsReady", -1)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                        disabled={design.kitsReady <= 0}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        </svg>
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={pendingKits[design.id] ?? design.kitsReady}
                        onChange={(e) => setPendingKits((prev) => ({ ...prev, [design.id]: e.target.value }))}
                        onBlur={() => {
                          const val = pendingKits[design.id];
                          if (val !== undefined) {
                            handleSetDesignValue(design.id, "kitsReady", Number(val));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = pendingKits[design.id];
                            if (val !== undefined) {
                              handleSetDesignValue(design.id, "kitsReady", Number(val));
                            }
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-rose-800"
                      />
                      <button
                        onClick={() => handleUpdateDesign(design.id, "kitsReady", 1)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Canvases Printed Tab */}
        {activeTab === "canvases" && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Canvases</p>
                <p className="text-xl font-bold text-white">{totalCanvasesPrinted}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Designs</p>
                <p className="text-xl font-bold text-white">{designs.length}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">With Stock</p>
                <p className="text-xl font-bold text-white">{designs.filter(d => d.canvasPrinted > 0).length}</p>
              </div>
            </div>

            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="w-full max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
            </div>

            {/* Designs list */}
            {filteredDesigns.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-400">No designs found</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {filteredDesigns.map((design) => (
                  <div
                    key={design.id}
                    className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex items-center gap-4"
                  >
                    {/* Preview */}
                    <Link href={`/design/${design.id}`} className="flex-shrink-0">
                      {design.previewImageUrl ? (
                        <img
                          src={design.previewImageUrl}
                          alt={design.name}
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
                      <Link href={`/design/${design.id}`} className="text-white font-medium hover:text-rose-400 truncate block">
                        {design.name}
                      </Link>
                      <p className="text-slate-400 text-sm">
                        {design.widthInches}&quot; × {design.heightInches}&quot; @ {design.meshCount} mesh
                      </p>
                    </div>

                    {/* Canvases Printed control */}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-sm hidden sm:block">Canvases:</span>
                      <button
                        onClick={() => handleUpdateDesign(design.id, "canvasPrinted", -1)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                        disabled={design.canvasPrinted <= 0}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        </svg>
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={pendingCanvases[design.id] ?? design.canvasPrinted}
                        onChange={(e) => setPendingCanvases((prev) => ({ ...prev, [design.id]: e.target.value }))}
                        onBlur={() => {
                          const val = pendingCanvases[design.id];
                          if (val !== undefined) {
                            handleSetDesignValue(design.id, "canvasPrinted", Number(val));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = pendingCanvases[design.id];
                            if (val !== undefined) {
                              handleSetDesignValue(design.id, "canvasPrinted", Number(val));
                            }
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-rose-800"
                      />
                      <button
                        onClick={() => handleUpdateDesign(design.id, "canvasPrinted", 1)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Stock Alerts Tab */}
        {activeTab === "alerts" && (
          <>
            {/* Summary stats */}
            {alertSummary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Total Designs</p>
                  <p className="text-xl font-bold text-white">{alertSummary.totalDesigns}</p>
                </div>
                <div className="bg-red-900/30 rounded-lg p-3 border border-red-800/50">
                  <p className="text-xs text-red-400 uppercase tracking-wider">Critical (≤3)</p>
                  <p className="text-xl font-bold text-red-400">{alertSummary.criticalCount}</p>
                </div>
                <div className="bg-yellow-900/30 rounded-lg p-3 border border-yellow-800/50">
                  <p className="text-xs text-yellow-400 uppercase tracking-wider">Low (4-6)</p>
                  <p className="text-xl font-bold text-yellow-400">{alertSummary.lowCount}</p>
                </div>
                <div className="bg-green-900/30 rounded-lg p-3 border border-green-800/50">
                  <p className="text-xs text-green-400 uppercase tracking-wider">Healthy (7+)</p>
                  <p className="text-xl font-bold text-green-400">{alertSummary.healthyCount}</p>
                </div>
              </div>
            )}

            {/* Explanation */}
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 mb-6">
              <p className="text-slate-300 text-sm">
                <strong className="text-white">Fulfillment Capacity</strong> shows how many complete kits you can make for each design based on current thread inventory.
                The capacity is limited by the color with the lowest stock relative to what&apos;s needed.
              </p>
            </div>

            {/* Most Used Colors Section */}
            {mostUsedColors.length > 0 && (
              <div className="bg-slate-800 rounded-xl border border-slate-700 mb-6 overflow-hidden">
                <div className="p-4 border-b border-slate-700">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Most Used Colors Across All Designs
                  </h3>
                  <p className="text-slate-400 text-sm mt-1">
                    Colors ranked by total stitches across your portfolio. Plan inventory around these high-demand threads.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-700 text-left">
                        <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Color</th>
                        <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">DMC #</th>
                        <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden sm:table-cell">Name</th>
                        <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Designs</th>
                        <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right hidden md:table-cell">Stitches</th>
                        <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Need</th>
                        <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Have</th>
                        <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {mostUsedColors.map((color, index) => {
                        const stockStatus = color.inventorySkeins >= color.totalSkeinsNeeded
                          ? "healthy"
                          : color.inventorySkeins >= color.totalSkeinsNeeded * 0.5
                          ? "low"
                          : "critical";

                        return (
                          <tr key={color.dmcNumber} className="hover:bg-slate-750 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-500 text-xs w-4">{index + 1}</span>
                                <div
                                  className="w-8 h-8 rounded border border-white/20 flex items-center justify-center"
                                  style={{ backgroundColor: color.hex }}
                                >
                                  <span
                                    className="text-[6px] font-bold select-none"
                                    style={{ color: getContrastTextColor(color.hex) }}
                                  >
                                    {color.dmcNumber}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-white font-medium">{color.dmcNumber}</span>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <span className="text-slate-300 truncate block max-w-[150px]">{color.colorName}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-white">{color.designCount}</span>
                            </td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">
                              <span className="text-slate-300">{color.totalStitches.toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-white">{color.totalSkeinsNeeded}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={stockStatus === "healthy" ? "text-green-400" : stockStatus === "low" ? "text-yellow-400" : "text-red-400"}>
                                {color.inventorySkeins}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                stockStatus === "healthy"
                                  ? "bg-green-900/50 text-green-400"
                                  : stockStatus === "low"
                                  ? "bg-yellow-900/50 text-yellow-400"
                                  : "bg-red-900/50 text-red-400"
                              }`}>
                                {stockStatus === "healthy" ? "OK" : stockStatus === "low" ? "Low" : "Need"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Summary row */}
                <div className="p-4 bg-slate-700/30 border-t border-slate-700 flex flex-wrap gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Colors tracked:</span>{" "}
                    <span className="text-white font-medium">{mostUsedColors.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Low/Critical:</span>{" "}
                    <span className="text-yellow-400 font-medium">
                      {mostUsedColors.filter(c => c.inventorySkeins < c.totalSkeinsNeeded).length}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Multi-design colors:</span>{" "}
                    <span className="text-white font-medium">
                      {mostUsedColors.filter(c => c.designCount > 1).length}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Refresh button */}
            <div className="mb-6">
              <button
                onClick={fetchAlerts}
                disabled={alertsLoading}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm font-medium flex items-center gap-2"
              >
                <svg className={`w-4 h-4 ${alertsLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {alertsLoading ? "Calculating..." : "Refresh"}
              </button>
            </div>

            {/* Alerts list */}
            {alertsLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-white flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Calculating fulfillment capacity...
                </div>
              </div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-400">No designs to analyze. Create some non-draft designs first.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {alerts.map((alert) => {
                  const statusColor = alert.fulfillmentCapacity <= 3
                    ? "border-red-800/50 bg-red-900/20"
                    : alert.fulfillmentCapacity <= 6
                    ? "border-yellow-800/50 bg-yellow-900/20"
                    : "border-green-800/50 bg-green-900/20";

                  const capacityColor = alert.fulfillmentCapacity <= 3
                    ? "text-red-400"
                    : alert.fulfillmentCapacity <= 6
                    ? "text-yellow-400"
                    : "text-green-400";

                  return (
                    <div
                      key={alert.id}
                      className={`bg-slate-800 rounded-xl border p-4 ${statusColor}`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Preview */}
                        <Link href={`/design/${alert.id}`} className="flex-shrink-0">
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
                          <div className="flex items-center gap-3 mb-1">
                            <Link href={`/design/${alert.id}`} className="text-white font-medium hover:text-rose-400 truncate">
                              {alert.name}
                            </Link>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              alert.meshCount === 14 ? "bg-blue-900/50 text-blue-300" : "bg-purple-900/50 text-purple-300"
                            }`}>
                              {alert.meshCount} mesh
                            </span>
                          </div>
                          <p className="text-slate-400 text-sm mb-2">
                            {alert.totalColors} colors &middot; {alert.totalSkeinsPerKit} skeins/kit
                          </p>

                          {/* Bottleneck colors */}
                          {alert.bottleneckColors.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs text-slate-500 mb-1">Bottleneck colors:</p>
                              <div className="flex flex-wrap gap-2">
                                {alert.bottleneckColors.map((color) => (
                                  <div
                                    key={color.dmcNumber}
                                    className="flex items-center gap-1.5 bg-slate-700/50 rounded px-2 py-1"
                                  >
                                    <div
                                      className="w-4 h-4 rounded border border-white/20"
                                      style={{ backgroundColor: color.hex }}
                                    />
                                    <span className="text-xs text-slate-300">{color.dmcNumber}</span>
                                    <span className="text-xs text-slate-500">
                                      ({color.inventorySkeins}/{color.skeinsNeeded})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Capacity indicator */}
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-slate-500 mb-1">Can make</p>
                          <p className={`text-3xl font-bold ${capacityColor}`}>
                            {alert.fulfillmentCapacity >= 999 ? "∞" : alert.fulfillmentCapacity}
                          </p>
                          <p className="text-xs text-slate-500">kits</p>
                        </div>
                      </div>

                      {/* Action */}
                      <div className="mt-3 pt-3 border-t border-slate-700 flex gap-2">
                        <Link
                          href={`/design/${alert.id}/kit`}
                          className="text-xs text-rose-400 hover:text-rose-300"
                        >
                          View full kit breakdown →
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Thread Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Add Thread to Inventory</h2>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setSelectedColor(null);
                  setAddSearch("");
                  setAddSkeins("1");
                }}
                className="p-1 text-slate-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Selected color preview */}
              {selectedColor && (
                <div className="flex items-center gap-3 p-3 bg-slate-700 rounded-lg">
                  <div
                    className="w-12 h-12 rounded-lg border-2 border-white/20 flex items-center justify-center"
                    style={{ backgroundColor: selectedColor.hex }}
                  >
                    <span
                      className="text-[8px] font-bold"
                      style={{ color: getContrastTextColor(selectedColor.hex) }}
                    >
                      {selectedColor.dmcNumber}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium">DMC {selectedColor.dmcNumber}</p>
                    <p className="text-slate-400 text-sm">{selectedColor.name}</p>
                  </div>
                  <button
                    onClick={() => setSelectedColor(null)}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Color search */}
              {!selectedColor && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Search DMC Color</label>
                    <input
                      type="text"
                      value={addSearch}
                      onChange={(e) => setAddSearch(e.target.value)}
                      placeholder="Type DMC number or color name..."
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
                      autoFocus
                    />
                  </div>

                  {addSearch && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-600">
                      {addColorResults.length === 0 ? (
                        <p className="text-slate-400 text-sm p-3">No colors found</p>
                      ) : (
                        addColorResults.map((color) => (
                          <button
                            key={color.dmcNumber}
                            onClick={() => {
                              setSelectedColor(color);
                              setAddSearch("");
                            }}
                            className="w-full flex items-center gap-3 p-2 hover:bg-slate-700 transition-colors text-left"
                          >
                            <div
                              className="w-8 h-8 rounded border border-white/20 flex-shrink-0"
                              style={{ backgroundColor: color.hex }}
                            />
                            <div>
                              <span className="text-white text-sm font-medium">DMC {color.dmcNumber}</span>
                              <span className="text-slate-400 text-sm ml-2">{color.name}</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Size selector */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Thread Size</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setAddSize(5)}
                    className={`flex-1 py-3 rounded-lg border-2 transition-all text-center ${
                      addSize === 5
                        ? "border-rose-800 bg-rose-900/20 text-white"
                        : "border-slate-600 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <span className="text-lg font-bold block">Size 5</span>
                    <span className="text-xs text-slate-400">For 14 mesh</span>
                  </button>
                  <button
                    onClick={() => setAddSize(8)}
                    className={`flex-1 py-3 rounded-lg border-2 transition-all text-center ${
                      addSize === 8
                        ? "border-rose-800 bg-rose-900/20 text-white"
                        : "border-slate-600 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <span className="text-lg font-bold block">Size 8</span>
                    <span className="text-xs text-slate-400">For 18 mesh</span>
                  </button>
                </div>
              </div>

              {/* Skeins input */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Number of Skeins
                  <span className="text-slate-500 font-normal ml-1">(1 skein = 27 yards)</span>
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setAddSkeins(String(Math.max(1, (Number(addSkeins) || 1) - 1)))}
                    className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:bg-slate-600"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={addSkeins}
                    onChange={(e) => setAddSkeins(e.target.value)}
                    onBlur={() => setAddSkeins(String(Math.max(1, Number(addSkeins) || 1)))}
                    className="w-20 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-center focus:outline-none focus:ring-2 focus:ring-rose-800"
                  />
                  <button
                    onClick={() => setAddSkeins(String((Number(addSkeins) || 0) + 1))}
                    className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:bg-slate-600"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  <span className="text-slate-400 text-sm">{(Number(addSkeins) || 0) * 27} yards</span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 flex gap-3">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setSelectedColor(null);
                  setAddSearch("");
                  setAddSkeins("1");
                }}
                className="flex-1 py-2.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!selectedColor || adding}
                className="flex-1 py-2.5 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {adding ? "Adding..." : "Add to Inventory"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

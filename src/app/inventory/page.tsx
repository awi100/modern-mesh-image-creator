"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DMC_PEARL_COTTON, DmcColor, searchDmcColors, getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

interface InventoryItem {
  id: string;
  dmcNumber: string;
  size: number;
  skeins: number;
  createdAt: string;
  updatedAt: string;
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

export default function InventoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sizeFilter, setSizeFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [selectedColor, setSelectedColor] = useState<DmcColor | null>(null);
  const [addSize, setAddSize] = useState<5 | 8>(5);
  const [addSkeins, setAddSkeins] = useState("1");
  const [adding, setAdding] = useState(false);

  // Track pending skein values being typed (before blur/Enter commits)
  const [pendingSkeins, setPendingSkeins] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchInventory();
  }, []);

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
    return result;
  }, [items, sizeFilter, searchQuery]);

  const addColorResults = useMemo(() => {
    if (!addSearch) return [];
    return searchDmcColors(addSearch).slice(0, 20);
  }, [addSearch]);

  // Search results for main search - colors not in inventory
  const mainSearchSuggestions = useMemo(() => {
    if (!searchQuery || filteredItems.length > 0) return [];
    const matches = searchDmcColors(searchQuery).slice(0, 10);
    // Filter out colors already in inventory (for the current size filter or both if no filter)
    const inventoryDmcNumbers = new Set(
      items
        .filter((item) => sizeFilter === null || item.size === sizeFilter)
        .map((item) => item.dmcNumber)
    );
    return matches.filter((color) => !inventoryDmcNumbers.has(color.dmcNumber));
  }, [searchQuery, filteredItems.length, items, sizeFilter]);

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
    // Optimistic update
    setItems(items.map((item) => (item.id === id ? { ...item, skeins: clamped } : item)));
    setPendingSkeins((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const response = await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skeins: clamped }),
      });
      if (!response.ok) {
        await fetchInventory(); // revert on failure
      }
    } catch (error) {
      console.error("Error updating inventory item:", error);
      await fetchInventory();
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
              <h1 className="text-lg md:text-xl font-bold text-white truncate">Thread Inventory</h1>
              <p className="text-xs md:text-sm text-slate-400 hidden sm:block">
                DMC Pearl Cotton
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <button
              onClick={() => setShowAddForm(true)}
              className="px-3 md:px-4 py-2 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 transition-all flex items-center gap-2 text-sm md:text-base"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Add Thread</span>
            </button>
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

        {/* Inventory list */}
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
              <div className="mt-8 max-w-lg mx-auto">
                <p className="text-slate-400 text-sm mb-3">Add to inventory:</p>
                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                  {mainSearchSuggestions.map((color) => (
                    <div
                      key={color.dmcNumber}
                      className="flex items-center gap-3 p-3 border-b border-slate-700 last:border-b-0 hover:bg-slate-750"
                    >
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
                      <div className="flex-1 text-left">
                        <p className="text-white text-sm font-medium">DMC {color.dmcNumber}</p>
                        <p className="text-slate-400 text-xs">{color.name}</p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedColor(color);
                          setAddSearch("");
                          setShowAddForm(true);
                        }}
                        className="px-3 py-1.5 bg-rose-900 text-white text-xs font-medium rounded-lg hover:bg-rose-950 transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  ))}
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
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredItems.map((item) => {
                  const color = getDmcColorByNumber(item.dmcNumber);
                  return (
                    <tr key={item.id} className="hover:bg-slate-750 transition-colors">
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
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                          title="Remove from inventory"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

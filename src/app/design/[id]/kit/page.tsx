"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ShoppingListItem,
  generateShoppingListCSV,
  generateShoppingListHTML,
  downloadFile,
  openPrintableWindow,
} from "@/lib/shopping-list-export";

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
}

interface DesignInfo {
  id: string;
  name: string;
  meshCount: number;
  stitchType: string;
  bufferPercent: number;
  widthInches: number;
  heightInches: number;
  kitsReady: number;
  canvasPrinted: number;
  totalSold: number;
  totalKitsSold: number;
}

interface KitTotals {
  colors: number;
  skeins: number;
  bobbins: number;
  allInStock: boolean;
}

interface KitSaleItem {
  id: string;
  dmcNumber: string;
  skeins: number;
}

interface KitSale {
  id: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  items: KitSaleItem[];
  design: { id: string; name: string };
}

const SKEIN_YARDS = 27;
const BOBBIN_ONLY_MAX = 5;

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
  let naiveSkeins = 0; // What we'd deduct without smart bobbin handling

  for (const item of kitContents) {
    const isBobbin = item.bobbinYards > 0 && item.fullSkeins === 0;
    naiveSkeins += item.skeinsNeeded * quantity;

    if (isBobbin) {
      // Accumulate bobbin yards across kits
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

export default function KitPage() {
  const params = useParams();
  const designId = params.id as string;

  const [design, setDesign] = useState<DesignInfo | null>(null);
  const [kitContents, setKitContents] = useState<KitItem[]>([]);
  const [totals, setTotals] = useState<KitTotals | null>(null);
  const [sales, setSales] = useState<KitSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [kitsReady, setKitsReady] = useState(0);
  const [canvasPrinted, setCanvasPrinted] = useState(0);
  const [selling, setSelling] = useState(false);
  const [showSellDialog, setShowSellDialog] = useState(false);
  const [sellNote, setSellNote] = useState("");
  const [assemblyQuantity, setAssemblyQuantity] = useState(1);
  const [updatingInventory, setUpdatingInventory] = useState<string | null>(null);

  const fetchKit = async () => {
    try {
      const res = await fetch(`/api/designs/${designId}/kit`);
      if (res.ok) {
        const data = await res.json();
        setDesign(data.design);
        setKitContents(data.kitContents);
        setTotals(data.totals);
        setKitsReady(data.design.kitsReady ?? 0);
        setCanvasPrinted(data.design.canvasPrinted ?? 0);
      }
    } catch (error) {
      console.error("Error fetching kit:", error);
    }
    setLoading(false);
  };

  const fetchSales = async () => {
    try {
      const res = await fetch(`/api/kit-sales?designId=${designId}`);
      if (res.ok) {
        const data = await res.json();
        setSales(data);
      }
    } catch (error) {
      console.error("Error fetching sales:", error);
    }
  };

  const handleUpdateInventory = useCallback(async (dmcNumber: string, delta: number) => {
    if (updatingInventory === dmcNumber || !design) return;

    setUpdatingInventory(dmcNumber);
    const size = design.meshCount === 14 ? 5 : 8;

    // Optimistic update
    setKitContents(prev => prev.map(item => {
      if (item.dmcNumber !== dmcNumber) return item;
      const newSkeins = Math.max(0, item.inventorySkeins + delta);
      return {
        ...item,
        inventorySkeins: newSkeins,
        inStock: newSkeins >= item.skeinsNeeded,
      };
    }));

    // Update totals optimistically
    setTotals(prev => {
      if (!prev) return prev;
      const updatedContents = kitContents.map(item => {
        if (item.dmcNumber !== dmcNumber) return item;
        const newSkeins = Math.max(0, item.inventorySkeins + delta);
        return { ...item, inventorySkeins: newSkeins, inStock: newSkeins >= item.skeinsNeeded };
      });
      return {
        ...prev,
        allInStock: updatedContents.every(item => item.inStock),
      };
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
      // Revert by refetching
      fetchKit();
    }
    setUpdatingInventory(null);
  }, [updatingInventory, design, kitContents]);

  useEffect(() => {
    fetchKit();
    fetchSales();
  }, [designId]);

  const handleAssembleKit = async () => {
    setSelling(true);
    try {
      const res = await fetch(`/api/designs/${designId}/kit/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: sellNote || null, quantity: assemblyQuantity }),
      });

      if (res.ok) {
        setShowSellDialog(false);
        setSellNote("");
        setKitsReady((prev) => prev + assemblyQuantity);
        setAssemblyQuantity(1);
        // Refresh both kit contents (stock changed) and sales
        fetchKit();
        fetchSales();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to assemble kits");
      }
    } catch (error) {
      console.error("Error assembling kits:", error);
      alert("Failed to assemble kits");
    }
    setSelling(false);
  };

  const handleMarkSold = async () => {
    try {
      const res = await fetch(`/api/designs/${designId}/kit/mark-sold`, {
        method: "POST",
      });
      if (res.ok) {
        setKitsReady((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error("Error marking sold:", error);
    }
  };

  const handleDeleteSale = async (saleId: string, quantity: number = 1) => {
    const msg = quantity > 1
      ? `Reverse this assembly of ${quantity} kits? Inventory will be restored.`
      : "Reverse this assembly? Inventory will be restored.";
    if (!confirm(msg)) return;

    try {
      const res = await fetch(`/api/kit-sales/${saleId}`, { method: "DELETE" });
      if (res.ok) {
        setKitsReady((prev) => Math.max(0, prev - quantity));
        fetchKit();
        fetchSales();
      }
    } catch (error) {
      console.error("Error reversing sale:", error);
    }
  };

  // Export shopping list as CSV
  const handleExportCSV = useCallback(() => {
    if (!design || kitContents.length === 0) return;

    const items: ShoppingListItem[] = kitContents.map((item) => ({
      dmcNumber: item.dmcNumber,
      colorName: item.colorName,
      quantity: item.skeinsNeeded,
      unit: "skeins",
      hex: item.hex,
      notes: item.bobbinYards > 0 ? `${item.bobbinYards.toFixed(1)} yd on bobbin` : undefined,
    }));

    const csv = generateShoppingListCSV(items, `Kit Shopping List - ${design.name}`);
    const filename = `${design.name.replace(/[^a-z0-9]/gi, "_")}_shopping_list.csv`;
    downloadFile(csv, filename, "text/csv");
  }, [design, kitContents]);

  // Export shopping list as printable
  const handlePrint = useCallback(() => {
    if (!design || kitContents.length === 0) return;

    const items: ShoppingListItem[] = kitContents.map((item) => ({
      dmcNumber: item.dmcNumber,
      colorName: item.colorName,
      quantity: item.skeinsNeeded,
      unit: "skeins",
      hex: item.hex,
      notes: item.bobbinYards > 0 ? `${item.bobbinYards.toFixed(1)} yd bobbin` : undefined,
    }));

    const html = generateShoppingListHTML(
      items,
      design.name,
      `${design.widthInches}" × ${design.heightInches}" @ ${design.meshCount} mesh`
    );
    openPrintableWindow(html);
  }, [design, kitContents]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white flex items-center gap-3">
          <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading kit...
        </div>
      </div>
    );
  }

  if (!design) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-lg mb-4">Design not found</p>
          <Link href="/" className="text-rose-400 hover:text-rose-300">
            Back to designs
          </Link>
        </div>
      </div>
    );
  }

  const threadSize = design.meshCount === 14 ? 5 : 8;

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="text-slate-400 hover:text-white flex-shrink-0"
              title="Home"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-bold text-white truncate">
                Kit: {design.name}
              </h1>
              <p className="text-xs md:text-sm text-slate-400">
                {design.widthInches}&quot; x {design.heightInches}&quot; @ {design.meshCount} mesh
                &middot; Size {threadSize} thread
                &middot; {design.stitchType} + {design.bufferPercent}% buffer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Export buttons */}
            <button
              onClick={handlePrint}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Print shopping list"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            </button>
            <button
              onClick={handleExportCSV}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Download CSV"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
            <div className="w-px h-6 bg-slate-700 mx-1" />
            {kitsReady > 0 && (
              <button
                onClick={handleMarkSold}
                className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-all text-sm"
                title="Mark one kit as sold to customer"
              >
                Mark Sold
              </button>
            )}
            <button
              onClick={() => setShowSellDialog(true)}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-lg hover:from-emerald-700 hover:to-emerald-800 transition-all flex items-center gap-2 text-sm font-medium"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="hidden sm:inline">Assemble Kit</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 md:py-6 space-y-6">
        {/* Totals bar */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 md:gap-4">
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-2xl font-bold text-white">{totals.colors}</p>
              <p className="text-sm text-slate-400">Colors</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-2xl font-bold text-white">{totals.skeins}</p>
              <p className="text-sm text-slate-400">
                {totals.skeins === 1 ? "Skein" : "Skeins"} to buy
                {totals.bobbins > 0 && (
                  <span className="text-amber-500"> ({totals.bobbins} w/ bobbin)</span>
                )}
              </p>
            </div>
            <div className={`rounded-xl p-4 border ${totals.allInStock ? "bg-emerald-900/30 border-emerald-700" : "bg-red-900/30 border-red-700"}`}>
              <p className={`text-2xl font-bold ${totals.allInStock ? "text-emerald-400" : "text-red-400"}`}>
                {totals.allInStock ? "Yes" : "No"}
              </p>
              <p className="text-sm text-slate-400">All In Stock</p>
            </div>
            <div className="bg-purple-900/20 rounded-xl p-4 border border-purple-800">
              <p className="text-2xl font-bold text-purple-400">{design.totalSold}</p>
              <p className="text-sm text-slate-400">
                Sold
                {design.totalSold > 0 && (
                  <span className="text-purple-500"> ({design.totalKitsSold} kits)</span>
                )}
              </p>
            </div>
            <div className="bg-blue-900/20 rounded-xl p-4 border border-blue-800">
              <p className="text-2xl font-bold text-blue-400">{canvasPrinted}</p>
              <p className="text-sm text-slate-400">Printed</p>
            </div>
            <div className="bg-emerald-900/20 rounded-xl p-4 border border-emerald-800">
              <p className="text-2xl font-bold text-emerald-400">{kitsReady}</p>
              <p className="text-sm text-slate-400">Kits Ready</p>
            </div>
          </div>
        )}

        {/* Kit contents table */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white">Kit Contents</h2>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Color</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">DMC #</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Stitches</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Yards</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">w/ Buffer</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Amount</th>
                  <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">In Stock</th>
                </tr>
              </thead>
              <tbody>
                {kitContents.map((item) => (
                  <tr key={item.dmcNumber} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="px-4 py-3">
                      <div
                        className="w-8 h-8 rounded border border-white/20 flex items-center justify-center"
                        style={{ backgroundColor: item.hex }}
                      >
                        <span
                          className="text-[7px] font-bold"
                          style={{ color: getContrastTextColor(item.hex) }}
                        >
                          {item.dmcNumber}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white font-mono text-sm">{item.dmcNumber}</td>
                    <td className="px-4 py-3 text-slate-300 text-sm">{item.colorName}</td>
                    <td className="px-4 py-3 text-slate-300 text-sm text-right">{item.stitchCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-300 text-sm text-right">{item.yardsWithoutBuffer}</td>
                    <td className="px-4 py-3 text-white font-medium text-sm text-right">{item.yardsWithBuffer}</td>
                    <td className="px-4 py-3 text-white font-medium text-sm text-right">
                      {item.fullSkeins > 0 && (
                        <span>{item.fullSkeins} {item.fullSkeins === 1 ? "skein" : "skeins"}</span>
                      )}
                      {item.bobbinYards > 0 && (
                        <span className="text-amber-400">
                          {item.fullSkeins > 0 && " + "}
                          {item.bobbinYards} yds <span className="text-xs text-amber-500">(bobbin)</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleUpdateInventory(item.dmcNumber, -1)}
                          disabled={updatingInventory === item.dmcNumber || item.inventorySkeins <= 0}
                          className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-sm font-bold"
                        >
                          −
                        </button>
                        <span className={`text-sm font-medium w-8 text-center ${item.inStock ? "text-emerald-400" : "text-red-400"}`}>
                          {item.inventorySkeins}
                        </span>
                        <button
                          onClick={() => handleUpdateInventory(item.dmcNumber, 1)}
                          disabled={updatingInventory === item.dmcNumber}
                          className="w-6 h-6 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-sm font-bold"
                        >
                          +
                        </button>
                        {!item.inStock && (
                          <span className="text-red-400 text-xs ml-1">/{item.skeinsNeeded}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate-700/50">
            {kitContents.map((item) => (
              <div key={item.dmcNumber} className="p-3 flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg border border-white/20 flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: item.hex }}
                >
                  <span
                    className="text-[8px] font-bold"
                    style={{ color: getContrastTextColor(item.hex) }}
                  >
                    {item.dmcNumber}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">
                    DMC {item.dmcNumber} - {item.colorName}
                  </p>
                  <p className="text-slate-400 text-xs">
                    {item.stitchCount.toLocaleString()} stitches &middot; {item.yardsWithoutBuffer} yds ({item.yardsWithBuffer} w/ buffer)
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <p className="text-white font-medium text-sm">
                    {item.fullSkeins > 0 && <span>{item.fullSkeins} sk</span>}
                    {item.bobbinYards > 0 && (
                      <span className="text-amber-400">
                        {item.fullSkeins > 0 && " + "}
                        {item.bobbinYards} yds
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleUpdateInventory(item.dmcNumber, -1)}
                      disabled={updatingInventory === item.dmcNumber || item.inventorySkeins <= 0}
                      className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-xs font-bold"
                    >
                      −
                    </button>
                    <span className={`text-xs font-medium w-5 text-center ${item.inStock ? "text-emerald-400" : "text-red-400"}`}>
                      {item.inventorySkeins}
                    </span>
                    <button
                      onClick={() => handleUpdateInventory(item.dmcNumber, 1)}
                      disabled={updatingInventory === item.dmcNumber}
                      className="w-5 h-5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-xs font-bold"
                    >
                      +
                    </button>
                    {!item.inStock && (
                      <span className="text-red-400 text-xs">/{item.skeinsNeeded}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {kitContents.length === 0 && (
            <div className="p-8 text-center text-slate-500">
              No colors in this design yet.
            </div>
          )}
        </div>

        {/* Sale History */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Assembly History</h2>
            <span className="text-sm text-slate-400">{sales.length} assembl{sales.length !== 1 ? "ies" : "y"}</span>
          </div>

          {sales.length > 0 ? (
            <div className="divide-y divide-slate-700/50">
              {sales.map((sale) => {
                const totalSkeins = sale.items.reduce((sum, i) => sum + i.skeins, 0);
                const qty = sale.quantity ?? 1;
                return (
                  <div key={sale.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium">
                        {qty > 1 && <span className="text-emerald-400 mr-2">{qty}x</span>}
                        {new Date(sale.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-slate-400 text-xs">
                        {sale.items.length} colors &middot; {totalSkeins} skeins deducted
                        {sale.note && ` \u00B7 ${sale.note}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteSale(sale.id, qty)}
                      className="p-2 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
                      title={`Reverse assembly (restore ${totalSkeins} skeins, remove ${qty} kit${qty > 1 ? "s" : ""})`}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-sm">
              No kit assemblies recorded yet.
            </div>
          )}
        </div>
      </div>

      {/* Assemble Kit Dialog */}
      {showSellDialog && (() => {
        const calc = calculateSkeinsForQuantity(kitContents, assemblyQuantity);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md mx-4 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Assemble Kits</h3>

              {/* Quantity selector */}
              <div className="mb-4">
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
              <div className="mb-4 p-3 bg-slate-700/50 rounded-lg">
                <p className="text-white text-sm">
                  <span className="font-medium">{assemblyQuantity} {assemblyQuantity === 1 ? "kit" : "kits"}</span>
                  {" "}&rarr;{" "}
                  <span className="font-bold text-emerald-400">{calc.totalSkeins} {calc.totalSkeins === 1 ? "skein" : "skeins"}</span>
                  {" "}to deduct ({totals?.colors ?? 0} colors)
                </p>
                {calc.bobbinSavings > 0 && (
                  <p className="text-emerald-400 text-xs mt-1">
                    Saving {calc.bobbinSavings} {calc.bobbinSavings === 1 ? "skein" : "skeins"} by combining bobbins!
                  </p>
                )}
                {(totals?.bobbins ?? 0) > 0 && (
                  <p className="text-amber-500 text-xs mt-1">
                    {totals?.bobbins} {(totals?.bobbins ?? 0) === 1 ? "color uses" : "colors use"} bobbins (yards accumulated across kits)
                  </p>
                )}
              </div>

              {totals && !totals.allInStock && (
                <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
                  <p className="text-yellow-400 text-sm">
                    Some colors are not fully in stock. Assembling will create negative inventory for those items.
                  </p>
                </div>
              )}

              <label className="block mb-4">
                <span className="text-sm text-slate-400">Note (optional)</span>
                <input
                  type="text"
                  value={sellNote}
                  onChange={(e) => setSellNote(e.target.value)}
                  placeholder="e.g. Customer name or order #"
                  className="mt-1 w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </label>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowSellDialog(false);
                    setSellNote("");
                    setAssemblyQuantity(1);
                  }}
                  className="flex-1 py-2 px-4 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssembleKit}
                  disabled={selling}
                  className="flex-1 py-2 px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium"
                >
                  {selling ? "Assembling..." : `Assemble ${assemblyQuantity} ${assemblyQuantity === 1 ? "Kit" : "Kits"}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

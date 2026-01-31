"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
  note: string | null;
  createdAt: string;
  items: KitSaleItem[];
  design: { id: string; name: string };
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
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
        body: JSON.stringify({ note: sellNote || null }),
      });

      if (res.ok) {
        setShowSellDialog(false);
        setSellNote("");
        setKitsReady((prev) => prev + 1);
        // Refresh both kit contents (stock changed) and sales
        fetchKit();
        fetchSales();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to assemble kit");
      }
    } catch (error) {
      console.error("Error assembling kit:", error);
      alert("Failed to assemble kit");
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

  const handleDeleteSale = async (saleId: string) => {
    if (!confirm("Reverse this assembly? Inventory will be restored.")) return;

    try {
      const res = await fetch(`/api/kit-sales/${saleId}`, { method: "DELETE" });
      if (res.ok) {
        setKitsReady((prev) => Math.max(0, prev - 1));
        fetchKit();
        fetchSales();
      }
    } catch (error) {
      console.error("Error reversing sale:", error);
    }
  };

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
              href={`/design/${designId}`}
              className="text-slate-400 hover:text-white flex-shrink-0"
              title="Back to editor"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
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
                      {item.inStock ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-sm">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {item.inventorySkeins}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-400 text-sm">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          {item.inventorySkeins}/{item.skeinsNeeded}
                        </span>
                      )}
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
                <div className="text-right flex-shrink-0">
                  <p className="text-white font-medium text-sm">
                    {item.fullSkeins > 0 && <span>{item.fullSkeins} sk</span>}
                    {item.bobbinYards > 0 && (
                      <span className="text-amber-400">
                        {item.fullSkeins > 0 && " + "}
                        {item.bobbinYards} yds
                      </span>
                    )}
                  </p>
                  {item.bobbinYards > 0 && item.fullSkeins === 0 ? (
                    <p className="text-amber-500 text-xs">bobbin</p>
                  ) : item.inStock ? (
                    <p className="text-emerald-400 text-xs">{item.inventorySkeins} in stock</p>
                  ) : (
                    <p className="text-red-400 text-xs">{item.inventorySkeins}/{item.skeinsNeeded}</p>
                  )}
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
                return (
                  <div key={sale.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium">
                        {new Date(sale.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-slate-400 text-xs">
                        {sale.items.length} colors &middot; {totalSkeins} skeins
                        {sale.note && ` \u00B7 ${sale.note}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteSale(sale.id)}
                      className="p-2 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
                      title="Reverse sale (restore inventory)"
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

      {/* Sell Kit Dialog */}
      {showSellDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Assemble Kit</h3>
            <p className="text-slate-400 text-sm mb-4">
              This will deduct {totals?.skeins ?? 0} {(totals?.skeins ?? 0) === 1 ? "skein" : "skeins"}
              {" "}({totals?.colors ?? 0} colors) from your inventory and add 1 kit to &quot;Kits Ready.&quot;
              {(totals?.bobbins ?? 0) > 0 && (
                <span className="text-amber-500"> {totals?.bobbins} {(totals?.bobbins ?? 0) === 1 ? "color includes" : "colors include"} a bobbin.</span>
              )}
            </p>

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
                {selling ? "Assembling..." : "Assemble Kit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

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

interface KitSummary {
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  stitchType: string;
  bufferPercent: number;
  kitsReady: number;
  canvasPrinted: number;
  totalColors: number;
  totalSkeins: number;
  allInStock: boolean;
  kitContents: KitItem[];
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

export default function KitsPage() {
  const [kits, setKits] = useState<KitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKit, setExpandedKit] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "in-stock" | "out-of-stock">("all");

  useEffect(() => {
    fetchAllKits();
  }, []);

  const fetchAllKits = async () => {
    try {
      const res = await fetch("/api/kits");
      if (res.ok) {
        const data = await res.json();
        setKits(data);
      }
    } catch (error) {
      console.error("Error fetching kits:", error);
    }
    setLoading(false);
  };

  const filteredKits = kits.filter((kit) => {
    if (filter === "in-stock") return kit.allInStock;
    if (filter === "out-of-stock") return !kit.allInStock;
    return true;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white flex items-center gap-3">
          <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading kits...
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
            <Link
              href="/"
              className="text-slate-400 hover:text-white"
              title="Back to designs"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-white">All Kits</h1>
            <span className="text-slate-400 text-sm">({filteredKits.length} designs)</span>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === "all"
                  ? "bg-slate-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("in-stock")}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === "in-stock"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              In Stock
            </button>
            <button
              onClick={() => setFilter("out-of-stock")}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === "out-of-stock"
                  ? "bg-red-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Out of Stock
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {filteredKits.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No kits found.
          </div>
        ) : (
          filteredKits.map((kit) => (
            <div
              key={kit.designId}
              className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden"
            >
              {/* Kit Header - Always visible */}
              <div
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-700/50 transition-colors"
                onClick={() => setExpandedKit(expandedKit === kit.designId ? null : kit.designId)}
              >
                {/* Preview image */}
                {kit.previewImageUrl ? (
                  <img
                    src={kit.previewImageUrl}
                    alt={kit.designName}
                    className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 bg-slate-700 rounded-lg flex-shrink-0 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}

                {/* Design info */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-semibold truncate">{kit.designName}</h2>
                  <p className="text-slate-400 text-sm">
                    {kit.widthInches}" x {kit.heightInches}" @ {kit.meshCount} mesh
                    &middot; {kit.stitchType} + {kit.bufferPercent}% buffer
                  </p>
                </div>

                {/* Quick stats */}
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-center">
                    <p className="text-lg font-bold text-white">{kit.totalColors}</p>
                    <p className="text-xs text-slate-400">Colors</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-white">{kit.totalSkeins}</p>
                    <p className="text-xs text-slate-400">Skeins</p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                    kit.allInStock
                      ? "bg-emerald-900/50 text-emerald-400"
                      : "bg-red-900/50 text-red-400"
                  }`}>
                    {kit.allInStock ? "In Stock" : "Out of Stock"}
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-400">{kit.kitsReady}</p>
                    <p className="text-xs text-slate-400">Ready</p>
                  </div>
                </div>

                {/* Expand icon */}
                <svg
                  className={`w-5 h-5 text-slate-400 transition-transform ${
                    expandedKit === kit.designId ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Expanded kit contents */}
              {expandedKit === kit.designId && (
                <div className="border-t border-slate-700">
                  {/* Color swatches row */}
                  <div className="p-4 bg-slate-700/30">
                    <div className="flex flex-wrap gap-2">
                      {kit.kitContents.map((item) => (
                        <div
                          key={item.dmcNumber}
                          className={`relative group ${!item.inStock ? "ring-2 ring-red-500 ring-offset-1 ring-offset-slate-800" : ""}`}
                        >
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center cursor-default"
                            style={{ backgroundColor: item.hex }}
                            title={`DMC ${item.dmcNumber} - ${item.colorName}: ${item.fullSkeins > 0 ? `${item.fullSkeins} skein${item.fullSkeins > 1 ? "s" : ""}` : `${item.bobbinYards} yds`}`}
                          >
                            <span
                              className="text-[8px] font-bold"
                              style={{ color: getContrastTextColor(item.hex) }}
                            >
                              {item.dmcNumber}
                            </span>
                          </div>
                          {/* Tooltip on hover */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                            {item.colorName}
                            <br />
                            {item.fullSkeins > 0 ? `${item.fullSkeins} skein${item.fullSkeins > 1 ? "s" : ""}` : `${item.bobbinYards} yds bobbin`}
                            {!item.inStock && <span className="text-red-400"> (Out of stock)</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="p-4 flex items-center justify-between border-t border-slate-700/50">
                    <div className="text-sm text-slate-400">
                      {kit.kitContents.filter(i => !i.inStock).length > 0 && (
                        <span className="text-red-400">
                          {kit.kitContents.filter(i => !i.inStock).length} color(s) out of stock
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/design/${kit.designId}`}
                        className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
                      >
                        Edit Design
                      </Link>
                      <Link
                        href={`/design/${kit.designId}/kit`}
                        className="px-4 py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-800 text-sm font-medium"
                      >
                        Full Kit View
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

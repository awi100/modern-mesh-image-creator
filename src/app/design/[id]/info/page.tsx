"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";

interface DesignInfo {
  id: string;
  name: string;
  previewImageUrl: string | null;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  gridWidth: number;
  gridHeight: number;
  stitchType: string;
  bufferPercent: number;
  kitsReady: number;
  canvasPrinted: number;
  kitColorCount: number;
  kitSkeinCount: number;
  totalStitches: number;
  isDraft: boolean;
  folderId: string | null;
  folder: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export default function DesignInfoPage() {
  const params = useParams();
  const router = useRouter();
  const designId = params.id as string;

  const [design, setDesign] = useState<DesignInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<"kits" | "canvases" | null>(null);
  const [pendingKits, setPendingKits] = useState<string>("");
  const [pendingCanvases, setPendingCanvases] = useState<string>("");

  useEffect(() => {
    fetchDesign();
  }, [designId]);

  const fetchDesign = async () => {
    try {
      const res = await fetch(`/api/designs/${designId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDesign(data);
    } catch (error) {
      console.error("Error fetching design:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateValue = async (field: "kitsReady" | "canvasPrinted", delta: number) => {
    if (!design) return;
    setUpdating(field === "kitsReady" ? "kits" : "canvases");

    try {
      const res = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: design[field] + delta }),
      });

      if (!res.ok) throw new Error("Failed to update");

      setDesign(prev => prev ? { ...prev, [field]: prev[field] + delta } : null);
    } catch (error) {
      console.error("Error updating design:", error);
    } finally {
      setUpdating(null);
    }
  };

  const handleSetValue = async (field: "kitsReady" | "canvasPrinted", value: number) => {
    if (!design) return;
    if (value === design[field]) return;

    setUpdating(field === "kitsReady" ? "kits" : "canvases");

    try {
      const res = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });

      if (!res.ok) throw new Error("Failed to update");

      setDesign(prev => prev ? { ...prev, [field]: value } : null);
    } catch (error) {
      console.error("Error updating design:", error);
    } finally {
      setUpdating(null);
      if (field === "kitsReady") setPendingKits("");
      else setPendingCanvases("");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-rose-500" />
      </div>
    );
  }

  if (!design) {
    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <Breadcrumb
            items={[
              { label: "Home", href: "/" },
              { label: "Design Not Found" },
            ]}
          />
          <div className="mt-8 bg-slate-800 rounded-xl p-8 text-center">
            <p className="text-slate-400">Design not found</p>
            <Link
              href="/"
              className="mt-4 inline-block text-rose-400 hover:text-rose-300"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const totalStitches = design.totalStitches || (design.gridWidth * design.gridHeight);

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            ...(design.folder ? [{ label: design.folder.name, href: `/?folder=${design.folder.id}` }] : []),
            { label: design.name },
          ]}
        />

        {/* Design Header */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="p-4 md:p-6 flex flex-col sm:flex-row items-start gap-4 md:gap-6">
            {/* Preview image */}
            <Link href={`/design/${design.id}`} className="flex-shrink-0 w-full sm:w-auto">
              {design.previewImageUrl ? (
                <img
                  src={design.previewImageUrl}
                  alt={design.name}
                  className="w-full sm:w-32 h-32 object-cover rounded-xl border border-slate-600 hover:border-rose-500 transition-colors"
                />
              ) : (
                <div className="w-full sm:w-32 h-32 bg-slate-700 rounded-xl border border-slate-600 flex items-center justify-center hover:border-rose-500 transition-colors">
                  <svg className="w-12 h-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
            </Link>

            {/* Design info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-white mb-1">
                    {design.name}
                  </h1>
                  {design.folder && (
                    <Link
                      href={`/?folder=${design.folder.id}`}
                      className="inline-flex items-center gap-1 text-slate-400 text-sm hover:text-rose-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      {design.folder.name}
                    </Link>
                  )}
                </div>
                {design.isDraft && (
                  <span className="px-2 py-1 bg-amber-900/50 text-amber-400 text-xs font-medium rounded">
                    Draft
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 mt-4 text-sm">
                <div>
                  <p className="text-slate-500">Size</p>
                  <p className="text-white font-medium">{design.widthInches}&quot; × {design.heightInches}&quot;</p>
                </div>
                <div>
                  <p className="text-slate-500">Mesh</p>
                  <p className="text-white font-medium">{design.meshCount} count</p>
                </div>
                <div>
                  <p className="text-slate-500">Colors</p>
                  <p className="text-white font-medium">{design.kitColorCount || 0}</p>
                </div>
                <div>
                  <p className="text-slate-500">Skeins/Kit</p>
                  <p className="text-white font-medium">{design.kitSkeinCount || 0}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="border-t border-slate-700 p-4 flex flex-wrap gap-2">
            <Link
              href={`/design/${design.id}`}
              className="px-4 py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-950 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Edit Design
            </Link>
            <Link
              href={`/design/${design.id}/kit`}
              className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Kit Breakdown
            </Link>
          </div>
        </div>

        {/* Stock Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Kits Ready */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 md:p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Kits Ready</h2>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Assembled kits in stock</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleUpdateValue("kitsReady", -1)}
                  disabled={updating === "kits" || design.kitsReady <= 0}
                  className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-xl font-bold"
                >
                  −
                </button>
                <input
                  type="number"
                  min="0"
                  value={pendingKits !== "" ? pendingKits : design.kitsReady}
                  onChange={(e) => setPendingKits(e.target.value)}
                  onBlur={() => {
                    if (pendingKits !== "") {
                      const val = parseInt(pendingKits, 10);
                      if (!isNaN(val) && val >= 0) {
                        handleSetValue("kitsReady", val);
                      } else {
                        setPendingKits("");
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseInt(pendingKits, 10);
                      if (!isNaN(val) && val >= 0) {
                        handleSetValue("kitsReady", val);
                      } else {
                        setPendingKits("");
                      }
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onFocus={(e) => {
                    setPendingKits(String(design.kitsReady));
                    e.target.select();
                  }}
                  className={`w-20 h-10 px-3 rounded-lg bg-slate-900 border border-slate-600 text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-rose-800 ${
                    design.kitsReady > 0 ? "text-emerald-400" : "text-slate-400"
                  }`}
                />
                <button
                  onClick={() => handleUpdateValue("kitsReady", 1)}
                  disabled={updating === "kits"}
                  className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-xl font-bold"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Canvases Printed */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 md:p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Canvases Printed</h2>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Printed canvases in stock</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleUpdateValue("canvasPrinted", -1)}
                  disabled={updating === "canvases" || design.canvasPrinted <= 0}
                  className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-xl font-bold"
                >
                  −
                </button>
                <input
                  type="number"
                  min="0"
                  value={pendingCanvases !== "" ? pendingCanvases : design.canvasPrinted}
                  onChange={(e) => setPendingCanvases(e.target.value)}
                  onBlur={() => {
                    if (pendingCanvases !== "") {
                      const val = parseInt(pendingCanvases, 10);
                      if (!isNaN(val) && val >= 0) {
                        handleSetValue("canvasPrinted", val);
                      } else {
                        setPendingCanvases("");
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseInt(pendingCanvases, 10);
                      if (!isNaN(val) && val >= 0) {
                        handleSetValue("canvasPrinted", val);
                      } else {
                        setPendingCanvases("");
                      }
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onFocus={(e) => {
                    setPendingCanvases(String(design.canvasPrinted));
                    e.target.select();
                  }}
                  className={`w-20 h-10 px-3 rounded-lg bg-slate-900 border border-slate-600 text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-rose-800 ${
                    design.canvasPrinted > 0 ? "text-emerald-400" : "text-slate-400"
                  }`}
                />
                <button
                  onClick={() => handleUpdateValue("canvasPrinted", 1)}
                  disabled={updating === "canvases"}
                  className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-xl font-bold"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Design Stats */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 md:p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Design Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Grid Size</p>
              <p className="text-white font-medium">{design.gridWidth} × {design.gridHeight}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Total Stitches</p>
              <p className="text-white font-medium">{totalStitches.toLocaleString()}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Stitch Type</p>
              <p className="text-white font-medium capitalize">{design.stitchType}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Buffer</p>
              <p className="text-white font-medium">{design.bufferPercent}%</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 gap-4 text-sm text-slate-400">
            <div>
              <span>Created: </span>
              <span className="text-slate-300">{new Date(design.createdAt).toLocaleDateString()}</span>
            </div>
            <div>
              <span>Updated: </span>
              <span className="text-slate-300">{new Date(design.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

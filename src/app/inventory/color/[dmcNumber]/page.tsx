"use client";

import React, { useState, useMemo, useEffect } from "react";
import { mutApi } from "@/lib/mut-api";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getDmcColorByNumber, searchDmcColors, DMC_PEARL_COTTON } from "@/lib/dmc-pearl-cotton";
import { threadSizeForMesh, MeshCount, ThreadSize } from "@/lib/yarn-calculator";
import CountStepper from "@/components/inventory/CountStepper";

interface DesignUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  stitchCount: number;
  skeinsNeeded: number;
  yardsWithBuffer: number;
  fullSkeins: number;
  bobbinYards: number;
}

interface BackupUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  primaryDmcNumbers: string[];
}

interface ColorUsage {
  dmcNumber: string;
  designs: DesignUsage[];
  backupFor: BackupUsage[];
}

interface InventoryItem {
  id: string;
  dmcNumber: string;
  size: number;
  skeins: number;
}

interface ColorBackupResponse {
  backupMap: Record<string, string>;
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}



export default function ColorDetailPage() {
  const params = useParams();
  const dmcNumber = params.dmcNumber as string;

  // Get color info from DMC database
  const colorInfo = getDmcColorByNumber(dmcNumber);

  // Fetch color usage data
  const { data: colorUsageData, isLoading: loadingUsage } = useSWR<ColorUsage[]>(
    "/api/colors/usage",
    { revalidateOnFocus: false }
  );

  // Which SKU are we looking at? 13ct designs use Size 3 pearl cotton and
  // 14/18ct use Size 5 — they are DIFFERENT inventory rows for the same DMC
  // number. This page used to be hardcoded to Size 5 ("all mesh counts use
  // Size 5", which stopped being true when 13ct went live), so following a
  // Size 3 link from Stock Alerts showed and edited the WRONG SKU.
  //
  // Adopted AFTER mount, not in the useState initialiser: this is a client
  // component but it is still server-rendered, and the server has no URL to
  // read, so initialising from the query string made the server say 5 while a
  // ?size=3 client said 3 — a hydration mismatch that makes React throw the
  // server tree away.
  const [threadSize, setThreadSize] = useState<ThreadSize>(5);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("size") === "3") setThreadSize(3);
  }, []);

  // Keep the URL in step with the toggle so a reload or a shared link keeps the
  // SKU you were looking at.
  const selectThreadSize = (sz: ThreadSize) => {
    setThreadSize(sz);
    const url = new URL(window.location.href);
    url.searchParams.set("size", String(sz));
    window.history.replaceState(null, "", url.toString());
  };

  const { data: inventoryRows, mutate: mutateInventoryRows } = useSWR<InventoryItem[]>(
    `/api/inventory?size=${threadSize}`,
    { revalidateOnFocus: false }
  );

  // Fetch global color backups
  const { data: backupData, mutate: mutateBackups } = useSWR<ColorBackupResponse>(
    "/api/color-backups",
    { revalidateOnFocus: false }
  );

  const [updatingInventory, setUpdatingInventory] = useState<number | null>(null);
  const [editingBackup, setEditingBackup] = useState(false);
  const [pendingBackup, setPendingBackup] = useState("");
  const [savingBackup, setSavingBackup] = useState(false);

  // Get backup color for this DMC number
  const backupDmcNumber = backupData?.backupMap?.[dmcNumber] || null;
  const backupColorInfo = backupDmcNumber ? getDmcColorByNumber(backupDmcNumber) : null;
  const backupInventory = backupDmcNumber ? inventoryRows?.find(i => i.dmcNumber === backupDmcNumber) : null;

  // Search for backup color suggestions
  const backupColorSuggestions = useMemo(() => {
    if (!pendingBackup.trim()) return [];
    return searchDmcColors(pendingBackup.trim()).slice(0, 8);
  }, [pendingBackup]);

  // Get the color info for the current pendingBackup value (if it's an exact match)
  const pendingBackupColorInfo = useMemo(() => {
    if (!pendingBackup.trim()) return null;
    return getDmcColorByNumber(pendingBackup.trim());
  }, [pendingBackup]);

  // Find this color's usage
  const colorUsage = useMemo(() => {
    if (!colorUsageData) return null;
    return colorUsageData.find(c => c.dmcNumber === dmcNumber);
  }, [colorUsageData, dmcNumber]);

  // Find inventory for this color at the selected thread size
  const inventoryRow = inventoryRows?.find(i => i.dmcNumber === dmcNumber);

  const handleUpdateInventory = async (delta: number) => {
    setUpdatingInventory(threadSize);

    try {
      const res = await mutApi("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, size: threadSize, delta }),
      });

      if (!res.ok) throw new Error("Failed to update");

      mutateInventoryRows();
    } catch (error) {
      console.error("Error updating inventory:", error);
    } finally {
      setUpdatingInventory(null);
    }
  };

  // Handle setting inventory to a specific value
  const handleSetInventory = async (newValue: number) => {
    if (!Number.isFinite(newValue)) return;
    const currentValue = inventoryRow?.skeins || 0;
    const delta = Math.max(0, Math.floor(newValue)) - currentValue;
    if (delta === 0) return;
    await handleUpdateInventory(delta);
  };

  // Handle setting backup color
  const handleSetBackup = async (newBackupDmc: string) => {
    setSavingBackup(true);
    try {
      const res = await mutApi("/api/color-backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dmcNumber,
          backupDmcNumber: newBackupDmc.trim(),
        }),
      });

      if (!res.ok) throw new Error("Failed to set backup");

      mutateBackups();
      setEditingBackup(false);
      setPendingBackup("");
    } catch (error) {
      console.error("Error setting backup:", error);
    } finally {
      setSavingBackup(false);
    }
  };

  if (!colorInfo) {
    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <Breadcrumb
            items={[
              { label: "Inventory", href: "/inventory" },
              { label: `DMC ${dmcNumber}` },
            ]}
          />
          <div className="mt-8 bg-slate-800 rounded-xl p-8 text-center">
            <p className="text-slate-400">Color DMC {dmcNumber} not found</p>
            <Link
              href="/inventory"
              className="mt-4 inline-block text-rose-400 hover:text-rose-300"
            >
              Back to Inventory
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Demand has to be filtered to the SKU on screen. Showing "2 in stock
  // (Size 3)" next to a total that silently included 18ct Size 5 designs made
  // the comparison worse than before the page knew about sizes at all.
  const sizedDesigns = (colorUsage?.designs || []).filter(
    (d) => threadSizeForMesh(d.meshCount as MeshCount) === threadSize
  );
  const totalDesigns = sizedDesigns.length;
  const totalSkeinsNeeded = sizedDesigns.reduce((sum, d) => sum + d.skeinsNeeded, 0);
  // Backups are the same SKU story as primaries: a Size 3 row standing in for a
  // Size 5 colour is not a backup you can actually use.
  const sizedBackupFor = (colorUsage?.backupFor || []).filter(
    (d) => threadSizeForMesh(d.meshCount as MeshCount) === threadSize
  );

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <Breadcrumb
          items={[
            { label: "Inventory", href: "/inventory" },
            { label: `DMC ${dmcNumber}` },
          ]}
        />

        {/* Color Header */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="p-6 flex items-start gap-6">
            {/* Large color swatch */}
            <div
              className="w-32 h-32 rounded-xl shadow-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: colorInfo.hex }}
            >
              <span
                className="text-2xl font-bold"
                style={{ color: getContrastTextColor(colorInfo.hex) }}
              >
                {dmcNumber}
              </span>
            </div>

            {/* Color info */}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white mb-2">
                DMC {dmcNumber}
              </h1>
              <p className="text-lg text-slate-300 mb-4">{colorInfo.name}</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Hex</p>
                  <p className="text-white font-mono">{colorInfo.hex}</p>
                </div>
                <div>
                  <p className="text-slate-500">RGB</p>
                  <p className="text-white font-mono">
                    {colorInfo.rgb.r}, {colorInfo.rgb.g}, {colorInfo.rgb.b}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Used in</p>
                  <p className="text-white">{totalDesigns} design{totalDesigns !== 1 ? "s" : ""}</p>
                </div>
                <div>
                  <p className="text-slate-500">Total needed</p>
                  <p className="text-white">{totalSkeinsNeeded} skein{totalSkeinsNeeded !== 1 ? "s" : ""}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Inventory Section */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-lg font-semibold text-white">
              Inventory <span className="text-slate-400 font-normal">(Size {threadSize} Pearl Cotton)</span>
            </h2>
            {/* Size 3 and Size 5 are different SKUs of the same DMC colour.
                Make it explicit which one you're editing, and switchable. */}
            <div className="flex items-center gap-1" role="group" aria-label="Thread size">
              {([3, 5] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => selectThreadSize(sz)}
                  aria-pressed={threadSize === sz}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    threadSize === sz
                      ? "bg-rose-900 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                  title={sz === 3 ? "Size 3 — used by 13ct intro kits" : "Size 5 — used by 18ct canvases"}
                >
                  Size {sz}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-300">Current Stock</span>
              <CountStepper
                key={threadSize}
                value={inventoryRow?.skeins || 0}
                onCommit={handleSetInventory}
                onDelta={handleUpdateInventory}
                busy={updatingInventory === threadSize}
                size="md"
                ariaLabel={`Skeins of DMC ${dmcNumber} (Size ${threadSize})`}
                valueClassName={(inventoryRow?.skeins || 0) > 0 ? "text-emerald-400" : "text-slate-400"}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm mr-2">Quick add:</span>
              <button
                onClick={() => handleUpdateInventory(5)}
                disabled={updatingInventory === threadSize}
                className="px-4 h-10 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium"
              >
                +5
              </button>
              <button
                onClick={() => handleUpdateInventory(10)}
                disabled={updatingInventory === threadSize}
                className="px-4 h-10 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium"
              >
                +10
              </button>
            </div>
          </div>
        </div>

        {/* Backup Color Section */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Backup Color</h2>
          <p className="text-slate-400 text-sm mb-4">
            Set a substitute color that can be used when this color is out of stock.
            The backup relationship is bidirectional — if you set 504 as a backup for 503,
            then 503 will also be the backup for 504.
          </p>

          {editingBackup ? (
            <div className="bg-slate-700/50 rounded-lg p-4 space-y-4">
              {/* Header with selected color and actions */}
              <div className="flex items-center gap-3">
                {/* Show selected color preview */}
                {pendingBackupColorInfo ? (
                  <div
                    className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 border-2 border-amber-500"
                    style={{ backgroundColor: pendingBackupColorInfo.hex }}
                  >
                    <span
                      className="text-sm font-bold"
                      style={{ color: getContrastTextColor(pendingBackupColorInfo.hex) }}
                    >
                      {pendingBackupColorInfo.dmcNumber}
                    </span>
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 border-2 border-dashed border-slate-500 bg-slate-800">
                    <span className="text-slate-500 text-xs text-center">Select<br/>color</span>
                  </div>
                )}
                <div className="flex-1">
                  {pendingBackupColorInfo ? (
                    <div>
                      <p className="text-white font-medium">DMC {pendingBackupColorInfo.dmcNumber}</p>
                      <p className="text-slate-400 text-sm">{pendingBackupColorInfo.name}</p>
                    </div>
                  ) : (
                    <p className="text-slate-400 text-sm">Click a color below or search by name/number</p>
                  )}
                </div>
                <button
                  onClick={() => handleSetBackup(pendingBackup)}
                  disabled={savingBackup || !pendingBackup.trim()}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium"
                >
                  {savingBackup ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditingBackup(false);
                    setPendingBackup("");
                  }}
                  className="px-4 py-2 bg-slate-600 text-slate-300 rounded-lg hover:bg-slate-500"
                >
                  Cancel
                </button>
              </div>

              {/* Search input */}
              <input
                type="text"
                value={pendingBackup}
                onChange={(e) => setPendingBackup(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pendingBackup.trim()) {
                    handleSetBackup(pendingBackup);
                  } else if (e.key === "Escape") {
                    setEditingBackup(false);
                    setPendingBackup("");
                  }
                }}
                placeholder="Search DMC # or color name..."
                className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-600"
              />

              {/* Color grid */}
              <div className="max-h-64 overflow-y-auto rounded-lg bg-slate-800 p-2">
                <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-1">
                  {(pendingBackup.trim() ? backupColorSuggestions : DMC_PEARL_COTTON).map((color) => (
                    <button
                      key={color.dmcNumber}
                      onClick={() => {
                        setPendingBackup(color.dmcNumber);
                      }}
                      className={`aspect-square rounded-md flex items-center justify-center transition-all ${
                        pendingBackup === color.dmcNumber
                          ? "ring-2 ring-amber-500 scale-110 z-10"
                          : "hover:scale-105 hover:ring-1 hover:ring-white/50"
                      }`}
                      style={{ backgroundColor: color.hex }}
                      title={`DMC ${color.dmcNumber} - ${color.name}`}
                    >
                      <span
                        className="text-[7px] font-bold leading-none select-none"
                        style={{ color: getContrastTextColor(color.hex) }}
                      >
                        {color.dmcNumber}
                      </span>
                    </button>
                  ))}
                </div>
                {pendingBackup.trim() && backupColorSuggestions.length === 0 && (
                  <p className="text-slate-500 text-center py-4 text-sm">No colors found</p>
                )}
              </div>

              {backupDmcNumber && (
                <button
                  onClick={() => handleSetBackup("")}
                  disabled={savingBackup}
                  className="mt-3 text-red-400 hover:text-red-300 text-sm"
                >
                  Remove backup color
                </button>
              )}
            </div>
          ) : backupDmcNumber && backupColorInfo ? (
            <div className="bg-slate-700/50 rounded-lg p-4">
              <div className="flex items-center gap-4">
                <Link
                  href={`/inventory/color/${backupDmcNumber}?size=${threadSize}`}
                  className="w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-amber-500 transition-all"
                  style={{ backgroundColor: backupColorInfo.hex }}
                >
                  <span
                    className="text-lg font-bold"
                    style={{ color: getContrastTextColor(backupColorInfo.hex) }}
                  >
                    {backupDmcNumber}
                  </span>
                </Link>
                <div className="flex-1">
                  <Link
                    href={`/inventory/color/${backupDmcNumber}?size=${threadSize}`}
                    className="text-white font-medium hover:text-amber-400 transition-colors"
                  >
                    DMC {backupDmcNumber}
                  </Link>
                  <p className="text-slate-400 text-sm">{backupColorInfo.name}</p>
                  <p className={`text-sm font-medium ${(backupInventory?.skeins || 0) > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {backupInventory?.skeins || 0} in stock
                  </p>
                </div>
                <button
                  onClick={() => {
                    setPendingBackup(backupDmcNumber);
                    setEditingBackup(true);
                  }}
                  className="px-4 py-2 bg-slate-600 text-slate-300 rounded-lg hover:bg-slate-500 text-sm"
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditingBackup(true)}
              className="w-full py-4 border-2 border-dashed border-slate-600 rounded-lg text-slate-400 hover:text-amber-400 hover:border-amber-600 transition-colors"
            >
              + Add backup color
            </button>
          )}
        </div>

        {/* Designs Using This Color */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Designs Using This Color
          </h2>

          {loadingUsage ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-slate-600 border-t-rose-500" />
            </div>
          ) : sizedDesigns.length === 0 ? (
            <p className="text-slate-400 text-center py-8">
              No Size {threadSize} designs use this color
            </p>
          ) : (
            <div className="space-y-3">
              {sizedDesigns.map((design) => (
                <Link
                  key={design.id}
                  href={`/design/${design.id}/info`}
                  className="flex items-center gap-4 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
                >
                  {design.previewImageUrl ? (
                    <img
                      src={design.previewImageUrl}
                      alt={design.name}
                      className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-slate-600 flex items-center justify-center flex-shrink-0">
                      <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{design.name}</p>
                    <p className="text-slate-400 text-sm">
                      {design.meshCount} mesh &middot; {design.stitchCount.toLocaleString()} stitches
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-white font-medium">
                      {design.bobbinYards > 0 && design.fullSkeins === 0
                        ? `${design.bobbinYards} yd bobbin`
                        : `${design.fullSkeins} skein${design.fullSkeins !== 1 ? "s" : ""}`}
                    </p>
                    <p className="text-slate-400 text-sm">
                      {design.yardsWithBuffer} yds total
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Designs Using This Color as a Backup */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-1">
            Designs Using This as a Backup
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            Designs where this color stands in if the primary runs out.
          </p>

          {loadingUsage ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-slate-600 border-t-rose-500" />
            </div>
          ) : sizedBackupFor.length === 0 ? (
            <p className="text-slate-400 text-center py-8">
              This color isn&apos;t a backup for any Size {threadSize} design
            </p>
          ) : (
            <div className="space-y-3">
              {sizedBackupFor.map((design) => {
                const primaries = design.primaryDmcNumbers
                  .map((p) => {
                    const c = getDmcColorByNumber(p);
                    return c ? `${p} ${c.name}` : p;
                  })
                  .join(", ");
                return (
                  <Link
                    key={design.id}
                    href={`/design/${design.id}/info`}
                    className="flex items-center gap-4 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
                  >
                    {design.previewImageUrl ? (
                      <img
                        src={design.previewImageUrl}
                        alt={design.name}
                        className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-slate-600 flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{design.name}</p>
                      <p className="text-slate-400 text-sm">{design.meshCount} mesh</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-amber-300/90 text-sm font-medium">Backup for</p>
                      <p className="text-slate-300 text-sm truncate max-w-[10rem]">{primaries}</p>
                    </div>
                    <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Back link */}
        <div className="text-center">
          <Link
            href="/inventory"
            className="text-slate-400 hover:text-white transition-colors"
          >
            &larr; Back to Inventory
          </Link>
        </div>
      </div>
    </div>
  );
}

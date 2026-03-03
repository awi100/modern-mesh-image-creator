"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

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

interface ColorUsage {
  dmcNumber: string;
  designs: DesignUsage[];
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

  // Fetch inventory data (Size 5 only - internal app uses 14 mesh)
  const { data: inventory5, mutate: mutateInventory5 } = useSWR<InventoryItem[]>(
    "/api/inventory?size=5",
    { revalidateOnFocus: false }
  );

  // Fetch global color backups
  const { data: backupData, mutate: mutateBackups } = useSWR<ColorBackupResponse>(
    "/api/color-backups",
    { revalidateOnFocus: false }
  );

  const [updatingInventory, setUpdatingInventory] = useState<number | null>(null);
  const [pendingValue, setPendingValue] = useState<string>("");
  const [editingBackup, setEditingBackup] = useState(false);
  const [pendingBackup, setPendingBackup] = useState("");
  const [savingBackup, setSavingBackup] = useState(false);

  // Get backup color for this DMC number
  const backupDmcNumber = backupData?.backupMap?.[dmcNumber] || null;
  const backupColorInfo = backupDmcNumber ? getDmcColorByNumber(backupDmcNumber) : null;
  const backupInventory = backupDmcNumber ? inventory5?.find(i => i.dmcNumber === backupDmcNumber) : null;

  // Find this color's usage
  const colorUsage = useMemo(() => {
    if (!colorUsageData) return null;
    return colorUsageData.find(c => c.dmcNumber === dmcNumber);
  }, [colorUsageData, dmcNumber]);

  // Find inventory for this color (Size 5 only)
  const inventorySize5 = inventory5?.find(i => i.dmcNumber === dmcNumber);

  // Handle inventory update (Size 5 only)
  const handleUpdateInventory = async (delta: number) => {
    setUpdatingInventory(5);

    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, size: 5, delta }),
      });

      if (!res.ok) throw new Error("Failed to update");

      mutateInventory5();
    } catch (error) {
      console.error("Error updating inventory:", error);
    } finally {
      setUpdatingInventory(null);
    }
  };

  // Handle setting inventory to a specific value
  const handleSetInventory = async (newValue: number) => {
    const currentValue = inventorySize5?.skeins || 0;
    const delta = newValue - currentValue;
    if (delta === 0) return;
    await handleUpdateInventory(delta);
    setPendingValue("");
  };

  // Handle setting backup color
  const handleSetBackup = async (newBackupDmc: string) => {
    setSavingBackup(true);
    try {
      const res = await fetch("/api/color-backups", {
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

  const totalDesigns = colorUsage?.designs.length || 0;
  const totalSkeinsNeeded = colorUsage?.designs.reduce(
    (sum, d) => sum + d.skeinsNeeded,
    0
  ) || 0;

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
          <h2 className="text-lg font-semibold text-white mb-4">Inventory (Size 5 Pearl Cotton)</h2>
          <div className="bg-slate-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-300">Current Stock</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleUpdateInventory(-1)}
                  disabled={updatingInventory === 5 || (inventorySize5?.skeins || 0) <= 0}
                  className="w-10 h-10 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-xl font-bold"
                >
                  −
                </button>
                <input
                  type="number"
                  min="0"
                  value={pendingValue !== "" ? pendingValue : (inventorySize5?.skeins || 0)}
                  onChange={(e) => setPendingValue(e.target.value)}
                  onBlur={() => {
                    if (pendingValue !== "") {
                      const val = parseInt(pendingValue, 10);
                      if (!isNaN(val) && val >= 0) {
                        handleSetInventory(val);
                      } else {
                        setPendingValue("");
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseInt(pendingValue, 10);
                      if (!isNaN(val) && val >= 0) {
                        handleSetInventory(val);
                      } else {
                        setPendingValue("");
                      }
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onFocus={(e) => {
                    setPendingValue(String(inventorySize5?.skeins || 0));
                    e.target.select();
                  }}
                  className={`w-20 h-10 px-3 rounded-lg bg-slate-800 border border-slate-600 text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-rose-800 ${
                    (inventorySize5?.skeins || 0) > 0 ? "text-emerald-400" : "text-slate-400"
                  }`}
                />
                <button
                  onClick={() => handleUpdateInventory(1)}
                  disabled={updatingInventory === 5}
                  className="w-10 h-10 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-xl font-bold"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm mr-2">Quick add:</span>
              <button
                onClick={() => handleUpdateInventory(5)}
                disabled={updatingInventory === 5}
                className="px-4 h-10 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium"
              >
                +5
              </button>
              <button
                onClick={() => handleUpdateInventory(10)}
                disabled={updatingInventory === 5}
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
            <div className="bg-slate-700/50 rounded-lg p-4">
              <div className="flex items-center gap-3">
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
                  placeholder="Enter DMC number (e.g. 504)"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-600"
                  autoFocus
                />
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
                  href={`/inventory/color/${backupDmcNumber}`}
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
                    href={`/inventory/color/${backupDmcNumber}`}
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
          ) : !colorUsage || colorUsage.designs.length === 0 ? (
            <p className="text-slate-400 text-center py-8">
              This color is not used in any completed designs
            </p>
          ) : (
            <div className="space-y-3">
              {colorUsage.designs.map((design) => (
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

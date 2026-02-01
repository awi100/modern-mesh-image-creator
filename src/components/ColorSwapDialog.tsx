"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getDmcColorByNumber, searchDmcColors, DMC_PEARL_COTTON, DmcColor } from "@/lib/dmc-pearl-cotton";

interface DesignColor {
  dmcNumber: string;
  stitchCount: number;
}

interface ColorSwapDialogProps {
  designId: string;
  designName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ColorMapping {
  from: string;
  to: string | null; // null means no change
}

export default function ColorSwapDialog({
  designId,
  designName,
  onClose,
  onSuccess,
}: ColorSwapDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colors, setColors] = useState<DesignColor[]>([]);
  const [mappings, setMappings] = useState<Map<string, string | null>>(new Map());
  const [variantName, setVariantName] = useState("");

  // Color picker state
  const [selectingFor, setSelectingFor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch design colors on mount
  useEffect(() => {
    const fetchColors = async () => {
      try {
        const response = await fetch(`/api/designs/${designId}/color-variant`);
        if (!response.ok) {
          throw new Error("Failed to load design colors");
        }
        const data = await response.json();
        setColors(data.colors);
        setVariantName(`${data.designName} (Color Variant)`);

        // Initialize mappings with no changes
        const initialMappings = new Map<string, string | null>();
        for (const color of data.colors) {
          initialMappings.set(color.dmcNumber, null);
        }
        setMappings(initialMappings);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load colors");
      } finally {
        setLoading(false);
      }
    };

    fetchColors();
  }, [designId]);

  // Filter colors for picker
  const filteredColors = useMemo(() => {
    if (!searchQuery.trim()) {
      return DMC_PEARL_COTTON;
    }
    return searchDmcColors(searchQuery);
  }, [searchQuery]);

  // Count how many colors have been changed
  const changedCount = useMemo(() => {
    let count = 0;
    mappings.forEach((to) => {
      if (to !== null) count++;
    });
    return count;
  }, [mappings]);

  const handleSetMapping = (from: string, to: string | null) => {
    setMappings(prev => {
      const next = new Map(prev);
      next.set(from, to);
      return next;
    });
    setSelectingFor(null);
    setSearchQuery("");
  };

  const handleClearMapping = (from: string) => {
    setMappings(prev => {
      const next = new Map(prev);
      next.set(from, null);
      return next;
    });
  };

  const handleCreate = async () => {
    // Build color mappings array (only changed colors)
    const colorMappings: { from: string; to: string }[] = [];
    mappings.forEach((to, from) => {
      if (to !== null) {
        colorMappings.push({ from, to });
      }
    });

    if (colorMappings.length === 0) {
      setError("Please change at least one color to create a variant");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/designs/${designId}/color-variant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colorMappings,
          name: variantName,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create color variant");
      }

      const result = await response.json();

      // Navigate to the new design
      if (onSuccess) {
        onSuccess();
      }
      onClose();
      router.push(`/design/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create variant");
      setSaving(false);
    }
  };

  // Get text color for contrast
  const getContrastColor = (hex: string): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#FFFFFF";
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-700 flex-shrink-0">
          <h2 className="text-xl font-semibold text-white">Create Color Variant</h2>
          <p className="text-sm text-slate-400 mt-1">
            Map colors to create a new version of &quot;{designName}&quot;
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="w-8 h-8 text-rose-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Variant name */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Variant Name
                </label>
                <input
                  type="text"
                  value={variantName}
                  onChange={(e) => setVariantName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-rose-800"
                />
              </div>

              {/* Color mappings */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Color Mappings ({changedCount} of {colors.length} changed)
                </label>
                <div className="space-y-2">
                  {colors.map((color) => {
                    const dmcColor = getDmcColorByNumber(color.dmcNumber);
                    const mappedTo = mappings.get(color.dmcNumber);
                    const mappedColor = mappedTo ? getDmcColorByNumber(mappedTo) : null;
                    const isSelecting = selectingFor === color.dmcNumber;

                    return (
                      <div key={color.dmcNumber} className="relative">
                        <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
                          {/* Original color */}
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div
                              className="w-10 h-10 rounded-lg border-2 border-slate-500 flex-shrink-0 flex items-center justify-center text-xs font-bold"
                              style={{
                                backgroundColor: dmcColor?.hex || "#888",
                                color: dmcColor ? getContrastColor(dmcColor.hex) : "#fff",
                              }}
                            >
                              {color.dmcNumber}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm text-white truncate">
                                {dmcColor?.name || "Unknown"}
                              </p>
                              <p className="text-xs text-slate-400">
                                {color.stitchCount.toLocaleString()} stitches
                              </p>
                            </div>
                          </div>

                          {/* Arrow */}
                          <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                          </svg>

                          {/* Mapped color or picker button */}
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {mappedColor ? (
                              <>
                                <div
                                  className="w-10 h-10 rounded-lg border-2 border-emerald-500 flex-shrink-0 flex items-center justify-center text-xs font-bold"
                                  style={{
                                    backgroundColor: mappedColor.hex,
                                    color: getContrastColor(mappedColor.hex),
                                  }}
                                >
                                  {mappedTo}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm text-white truncate">
                                    {mappedColor.name}
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleClearMapping(color.dmcNumber)}
                                  className="p-1 text-slate-400 hover:text-red-400"
                                  title="Clear mapping"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setSelectingFor(isSelecting ? null : color.dmcNumber)}
                                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                                  isSelecting
                                    ? "bg-rose-900 text-white"
                                    : "bg-slate-600 text-slate-300 hover:bg-slate-500"
                                }`}
                              >
                                {isSelecting ? "Cancel" : "Select New Color"}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Color picker dropdown */}
                        {isSelecting && (
                          <div className="mt-2 p-3 bg-slate-700 rounded-lg border border-slate-600">
                            {/* Search */}
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="Search colors by name or DMC number..."
                              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800 mb-3"
                              autoFocus
                            />

                            {/* Color grid */}
                            <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                              {filteredColors.slice(0, 100).map((c) => (
                                <button
                                  key={c.dmcNumber}
                                  onClick={() => handleSetMapping(color.dmcNumber, c.dmcNumber)}
                                  className="w-8 h-8 rounded border border-slate-500 hover:border-white hover:scale-110 transition-transform relative group"
                                  style={{ backgroundColor: c.hex }}
                                  title={`${c.dmcNumber} - ${c.name}`}
                                >
                                  <span
                                    className="text-[8px] font-bold"
                                    style={{ color: getContrastColor(c.hex) }}
                                  >
                                    {c.dmcNumber}
                                  </span>
                                </button>
                              ))}
                            </div>

                            {filteredColors.length > 100 && (
                              <p className="text-xs text-slate-400 mt-2 text-center">
                                Showing first 100 results. Type to search for more.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 flex-shrink-0 flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-slate-400 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || saving || changedCount === 0}
            className="px-6 py-2 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                Create Variant
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

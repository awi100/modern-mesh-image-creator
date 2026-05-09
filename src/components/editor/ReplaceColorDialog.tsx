"use client";

import React, { useState, useMemo } from "react";
import { useEditorStore } from "@/lib/store";
import { DMC_PEARL_COTTON, DmcColor, searchDmcColors } from "@/lib/dmc-pearl-cotton";

interface ReplaceColorDialogProps {
  onClose: () => void;
  mode?: "replace" | "remove"; // remove = swap with empty
}

export default function ReplaceColorDialog({ onClose, mode = "replace" }: ReplaceColorDialogProps) {
  const { getUsedColors, replaceAllColor } = useEditorStore();
  const usedColors = getUsedColors();

  const [fromColor, setFromColor] = useState<DmcColor | null>(null);
  const [toColor, setToColor] = useState<DmcColor | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [picking, setPicking] = useState<"from" | "to" | null>("from");

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return DMC_PEARL_COTTON.slice(0, 30);
    return searchDmcColors(searchQuery).slice(0, 30);
  }, [searchQuery]);

  const handleApply = () => {
    if (!fromColor) return;
    if (mode === "remove") {
      replaceAllColor(fromColor.dmcNumber, null);
    } else {
      if (!toColor) return;
      replaceAllColor(fromColor.dmcNumber, toColor.dmcNumber);
    }
    onClose();
  };

  const handlePickColor = (color: DmcColor) => {
    if (picking === "from") {
      setFromColor(color);
      setPicking(mode === "remove" ? null : "to");
    } else if (picking === "to") {
      setToColor(color);
      setPicking(null);
    }
    setSearchQuery("");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-md shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {mode === "remove" ? "Remove a Color" : "Replace a Color"}
          </h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {/* Color slots */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPicking("from")}
              className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                picking === "from"
                  ? "border-rose-500 bg-rose-50 dark:bg-rose-900/20"
                  : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700"
              }`}
            >
              {fromColor ? (
                <>
                  <div className="w-8 h-8 rounded border border-slate-400" style={{ backgroundColor: fromColor.hex }} />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-xs text-slate-500 uppercase">From</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      DMC {fromColor.dmcNumber}
                    </p>
                  </div>
                </>
              ) : (
                <span className="text-sm text-slate-500 mx-auto">
                  Pick color to {mode === "remove" ? "remove" : "replace"}
                </span>
              )}
            </button>

            {mode === "replace" && (
              <>
                <span className="text-slate-400">→</span>
                <button
                  onClick={() => setPicking("to")}
                  className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                    picking === "to"
                      ? "border-rose-500 bg-rose-50 dark:bg-rose-900/20"
                      : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700"
                  }`}
                >
                  {toColor ? (
                    <>
                      <div className="w-8 h-8 rounded border border-slate-400" style={{ backgroundColor: toColor.hex }} />
                      <div className="text-left flex-1 min-w-0">
                        <p className="text-xs text-slate-500 uppercase">To</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          DMC {toColor.dmcNumber}
                        </p>
                      </div>
                    </>
                  ) : (
                    <span className="text-sm text-slate-500 mx-auto">Pick replacement</span>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Color picker */}
          {picking && (
            <>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {picking === "from"
                  ? "Pick a color from your design (or any DMC color):"
                  : "Pick the new color:"}
              </div>
              {picking === "from" && usedColors.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Colors in this design</p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {usedColors.map((c) => (
                      <button
                        key={c.dmcNumber}
                        onClick={() => handlePickColor(c)}
                        className="aspect-square rounded border border-slate-300 dark:border-slate-600 hover:ring-2 hover:ring-rose-500"
                        style={{ backgroundColor: c.hex }}
                        title={`DMC ${c.dmcNumber} ${c.name}`}
                      />
                    ))}
                  </div>
                </div>
              )}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search DMC number or name..."
                className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
              <div className="grid grid-cols-6 gap-1.5 max-h-48 overflow-y-auto">
                {searchResults.map((c) => (
                  <button
                    key={c.dmcNumber}
                    onClick={() => handlePickColor(c)}
                    className="aspect-square rounded border border-slate-300 dark:border-slate-600 hover:ring-2 hover:ring-rose-500"
                    style={{ backgroundColor: c.hex }}
                    title={`DMC ${c.dmcNumber} ${c.name}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!fromColor || (mode === "replace" && !toColor)}
            className="px-4 py-2 bg-rose-900 hover:bg-rose-800 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mode === "remove" ? "Remove All" : "Replace All"}
          </button>
        </div>
      </div>
    </div>
  );
}

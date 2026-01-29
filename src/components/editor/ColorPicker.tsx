"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { DMC_PEARL_COTTON, DmcColor, searchDmcColors } from "@/lib/dmc-pearl-cotton";

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

export default function ColorPicker() {
  const { currentColor, setCurrentColor, getUsedColors, replaceAllColor, grid, meshCount } = useEditorStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showReplacePanel, setShowReplacePanel] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState<DmcColor | null>(null);
  const [replaceTo, setReplaceTo] = useState<DmcColor | null>(null);
  const [selectingFor, setSelectingFor] = useState<'from' | 'to' | null>(null);

  // Inventory: fetch stock for the relevant thread size (14 mesh → size 5, 18 mesh → size 8)
  const [inStockSet, setInStockSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    const threadSize = meshCount === 14 ? 5 : 8;
    fetch(`/api/inventory?size=${threadSize}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((items: { dmcNumber: string; skeins: number }[]) => {
        setInStockSet(new Set(items.filter((i) => i.skeins > 0).map((i) => i.dmcNumber)));
      })
      .catch(() => {});
  }, [meshCount]);

  const usedColors = getUsedColors();

  const filteredColors = useMemo(() => {
    if (searchQuery) {
      return searchDmcColors(searchQuery);
    }
    return showAll ? DMC_PEARL_COTTON : usedColors;
  }, [searchQuery, showAll, usedColors]);

  const handleColorClick = (color: DmcColor) => {
    if (selectingFor === 'from') {
      setReplaceFrom(color);
      setSelectingFor(null);
    } else if (selectingFor === 'to') {
      setReplaceTo(color);
      setSelectingFor(null);
    } else {
      setCurrentColor(color);
    }
  };

  const handleReplace = () => {
    if (replaceFrom && replaceTo) {
      replaceAllColor(replaceFrom.dmcNumber, replaceTo.dmcNumber);
      setReplaceFrom(null);
      setReplaceTo(null);
      setShowReplacePanel(false);
    }
  };

  const handleCloseReplace = () => {
    setShowReplacePanel(false);
    setReplaceFrom(null);
    setReplaceTo(null);
    setSelectingFor(null);
  };

  return (
    <div className="bg-slate-800 md:border-l border-slate-700 w-full md:w-64 flex flex-col h-full">
      {/* Current color */}
      <div className="p-4 border-b border-slate-700">
        <h3 className="text-sm font-medium text-slate-400 mb-2">Current Color</h3>
        {currentColor ? (
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-lg border-2 border-white/20"
              style={{ backgroundColor: currentColor.hex }}
            />
            <div>
              <p className="text-white font-medium">DMC {currentColor.dmcNumber}</p>
              <p className="text-slate-400 text-sm">{currentColor.name}</p>
            </div>
          </div>
        ) : (
          <p className="text-slate-500">No color selected</p>
        )}
      </div>

      {/* Search */}
      <div className="p-4 border-b border-slate-700">
        <input
          type="text"
          placeholder="Search colors..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        <button
          onClick={() => setShowAll(false)}
          className={`flex-1 py-2 text-sm ${
            !showAll ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          Used ({usedColors.length})
        </button>
        <button
          onClick={() => setShowAll(true)}
          className={`flex-1 py-2 text-sm ${
            showAll ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          All Colors
        </button>
      </div>

      {/* Replace color toggle */}
      <div className="p-2 border-b border-slate-700">
        <button
          onClick={() => setShowReplacePanel(!showReplacePanel)}
          className={`w-full py-2 px-3 rounded-lg text-sm flex items-center justify-center gap-2 ${
            showReplacePanel
              ? "bg-orange-600 text-white"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Replace Color
        </button>
      </div>

      {/* Replace color panel */}
      {showReplacePanel && (
        <div className="p-3 border-b border-slate-700 bg-slate-750 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase tracking-wider">Replace Color</span>
            <button
              onClick={handleCloseReplace}
              className="text-slate-400 hover:text-white p-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* From color slot */}
            <button
              onClick={() => setSelectingFor('from')}
              className={`flex-1 p-2 rounded-lg border-2 transition-all ${
                selectingFor === 'from'
                  ? 'border-orange-500 bg-slate-700'
                  : 'border-slate-600 bg-slate-700 hover:border-slate-500'
              }`}
            >
              <div className="text-xs text-slate-400 mb-1">From</div>
              {replaceFrom ? (
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded border border-white/20"
                    style={{ backgroundColor: replaceFrom.hex }}
                  />
                  <span className="text-white text-xs truncate">{replaceFrom.dmcNumber}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded border-2 border-dashed border-slate-500 flex items-center justify-center">
                    <span className="text-slate-500 text-lg">+</span>
                  </div>
                  <span className="text-slate-500 text-xs">Select</span>
                </div>
              )}
            </button>

            {/* Arrow */}
            <div className="text-slate-500">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>

            {/* To color slot */}
            <button
              onClick={() => setSelectingFor('to')}
              className={`flex-1 p-2 rounded-lg border-2 transition-all ${
                selectingFor === 'to'
                  ? 'border-orange-500 bg-slate-700'
                  : 'border-slate-600 bg-slate-700 hover:border-slate-500'
              }`}
            >
              <div className="text-xs text-slate-400 mb-1">To</div>
              {replaceTo ? (
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded border border-white/20"
                    style={{ backgroundColor: replaceTo.hex }}
                  />
                  <span className="text-white text-xs truncate">{replaceTo.dmcNumber}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded border-2 border-dashed border-slate-500 flex items-center justify-center">
                    <span className="text-slate-500 text-lg">+</span>
                  </div>
                  <span className="text-slate-500 text-xs">Select</span>
                </div>
              )}
            </button>
          </div>

          {/* Selection hint */}
          {selectingFor && (
            <p className="text-xs text-orange-400 text-center">
              Click a color below to select the &quot;{selectingFor}&quot; color
            </p>
          )}

          {/* Replace button */}
          <button
            onClick={handleReplace}
            disabled={!replaceFrom || !replaceTo}
            className="w-full py-2 px-3 rounded-lg text-sm bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Replace All
          </button>
        </div>
      )}

      {/* Color grid */}
      <div
        className="flex-1 overflow-y-auto p-2 min-h-0 max-h-[40vh] md:max-h-none overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="grid grid-cols-5 gap-1">
          {filteredColors.map((color) => {
            const isCurrentColor = currentColor?.dmcNumber === color.dmcNumber;
            const isReplaceFrom = replaceFrom?.dmcNumber === color.dmcNumber;
            const isReplaceTo = replaceTo?.dmcNumber === color.dmcNumber;
            const isSelecting = selectingFor !== null;
            const isInStock = inStockSet.has(color.dmcNumber);

            return (
              <button
                key={color.dmcNumber}
                onClick={() => handleColorClick(color)}
                className={`aspect-square rounded-md border-2 transition-all flex items-center justify-center relative ${
                  isReplaceFrom
                    ? "border-orange-500 scale-110 z-10 ring-2 ring-orange-500/50"
                    : isReplaceTo
                    ? "border-green-500 scale-110 z-10 ring-2 ring-green-500/50"
                    : isCurrentColor && !isSelecting
                    ? "border-white scale-110 z-10"
                    : isSelecting
                    ? "border-transparent hover:border-orange-400 hover:scale-105"
                    : "border-transparent hover:border-white/50"
                }${!isInStock && inStockSet.size > 0 ? " opacity-40" : ""}`}
                style={{ backgroundColor: color.hex }}
                title={`DMC ${color.dmcNumber} - ${color.name}${isInStock ? " (In Stock)" : inStockSet.size > 0 ? " (Not In Stock)" : ""}`}
              >
                <span
                  className="text-[8px] font-bold leading-none select-none"
                  style={{ color: getContrastTextColor(color.hex) }}
                >
                  {color.dmcNumber}
                </span>
                {isInStock && (
                  <span className="absolute top-0 right-0 w-2 h-2 bg-green-400 rounded-full border border-green-600" />
                )}
              </button>
            );
          })}
        </div>

        {filteredColors.length === 0 && (
          <p className="text-slate-500 text-center py-4 text-sm">
            {searchQuery ? "No colors found" : "No colors used yet"}
          </p>
        )}
      </div>
    </div>
  );
}

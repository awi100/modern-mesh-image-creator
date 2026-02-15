"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import { DMC_PEARL_COTTON, DmcColor, searchDmcColors, findSimilarInStockColor, getSimilarityDescription } from "@/lib/dmc-pearl-cotton";
import { ColorSwatch } from "./ColorSwatch";

export default function ColorPicker() {
  const { currentColor, setCurrentColor, getUsedColors, replaceAllColor, meshCount } = useEditorStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showReplacePanel, setShowReplacePanel] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState<DmcColor | null>(null);
  const [replaceTo, setReplaceTo] = useState<DmcColor | null>(null);
  const [selectingFor, setSelectingFor] = useState<'from' | 'to' | null>(null);

  // Remove color mode
  const [showRemovePanel, setShowRemovePanel] = useState(false);
  const [removeColor, setRemoveColor] = useState<DmcColor | null>(null);
  const [selectingRemove, setSelectingRemove] = useState(false);

  // Color recommendation for out-of-stock colors
  const [recommendation, setRecommendation] = useState<{
    selected: DmcColor;
    suggested: DmcColor;
    deltaE: number;
  } | null>(null);

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

  const handleColorClick = useCallback((color: DmcColor) => {
    if (selectingFor === 'from') {
      setReplaceFrom(color);
      setSelectingFor(null);
    } else if (selectingFor === 'to') {
      setReplaceTo(color);
      setSelectingFor(null);
    } else if (selectingRemove) {
      setRemoveColor(color);
      setSelectingRemove(false);
    } else {
      // Check if color is out of stock and we have inventory data
      const isOutOfStock = inStockSet.size > 0 && !inStockSet.has(color.dmcNumber);

      if (isOutOfStock) {
        // Try to find a similar in-stock color
        const similar = findSimilarInStockColor(color, inStockSet);
        if (similar) {
          setRecommendation({
            selected: color,
            suggested: similar.color,
            deltaE: similar.deltaE,
          });
          return; // Don't select yet, show recommendation modal
        }
      }

      setCurrentColor(color);
    }
  }, [selectingFor, selectingRemove, inStockSet, setCurrentColor]);

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

  const handleRemove = () => {
    if (removeColor) {
      replaceAllColor(removeColor.dmcNumber, null);
      setRemoveColor(null);
      setShowRemovePanel(false);
    }
  };

  const handleCloseRemove = () => {
    setShowRemovePanel(false);
    setRemoveColor(null);
    setSelectingRemove(false);
  };

  const handleUseRecommended = () => {
    if (recommendation) {
      setCurrentColor(recommendation.suggested);
      setRecommendation(null);
    }
  };

  const handleUseOriginal = () => {
    if (recommendation) {
      setCurrentColor(recommendation.selected);
      setRecommendation(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 md:border-l border-slate-200 dark:border-slate-700 w-full md:w-64 flex flex-col h-full">
      {/* Current color */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Current Color</h3>
        {currentColor ? (
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-lg border-2 border-slate-300 dark:border-white/20"
              style={{ backgroundColor: currentColor.hex }}
            />
            <div>
              <p className="text-slate-900 dark:text-white font-medium">DMC {currentColor.dmcNumber}</p>
              <p className="text-slate-500 dark:text-slate-400 text-sm">{currentColor.name}</p>
            </div>
          </div>
        ) : (
          <p className="text-slate-500">No color selected</p>
        )}
      </div>

      {/* Search */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <input
          type="text"
          placeholder="Search colors..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setShowAll(false)}
          className={`flex-1 py-2 text-sm ${
            !showAll ? "bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          Used ({usedColors.length})
        </button>
        <button
          onClick={() => setShowAll(true)}
          className={`flex-1 py-2 text-sm ${
            showAll ? "bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          All Colors
        </button>
      </div>

      {/* Replace color toggle */}
      <div className="p-2 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setShowReplacePanel(!showReplacePanel)}
          className={`w-full py-2 px-3 rounded-lg text-sm flex items-center justify-center gap-2 ${
            showReplacePanel
              ? "bg-orange-600 text-white"
              : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
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
        <div className="p-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-750 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">Replace Color</span>
            <button
              onClick={handleCloseReplace}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1"
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
                  : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">From</div>
              {replaceFrom ? (
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded border border-white/20"
                    style={{ backgroundColor: replaceFrom.hex }}
                  />
                  <span className="text-slate-900 dark:text-white text-xs truncate">{replaceFrom.dmcNumber}</span>
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
                  : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">To</div>
              {replaceTo ? (
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded border border-white/20"
                    style={{ backgroundColor: replaceTo.hex }}
                  />
                  <span className="text-slate-900 dark:text-white text-xs truncate">{replaceTo.dmcNumber}</span>
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

      {/* Remove color toggle */}
      <div className="p-2 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => {
            setShowRemovePanel(!showRemovePanel);
            if (showReplacePanel) handleCloseReplace();
          }}
          className={`w-full py-2 px-3 rounded-lg text-sm flex items-center justify-center gap-2 ${
            showRemovePanel
              ? "bg-red-600 text-white"
              : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Remove Color
        </button>
      </div>

      {/* Remove color panel */}
      {showRemovePanel && (
        <div className="p-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-750 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">Remove Color</span>
            <button
              onClick={handleCloseRemove}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-xs text-slate-400">
            Select a color to remove all its stitches (make them empty).
            Great for removing backgrounds from imported images.
          </p>

          {/* Color to remove slot */}
          <button
            onClick={() => setSelectingRemove(true)}
            className={`w-full p-2 rounded-lg border-2 transition-all ${
              selectingRemove
                ? 'border-red-500 bg-slate-700'
                : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
            }`}
          >
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Color to remove</div>
            {removeColor ? (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded border border-white/20"
                  style={{ backgroundColor: removeColor.hex }}
                />
                <span className="text-white text-sm">DMC {removeColor.dmcNumber} - {removeColor.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded border-2 border-dashed border-slate-500 flex items-center justify-center">
                  <span className="text-slate-500 text-lg">+</span>
                </div>
                <span className="text-slate-500 text-sm">Click to select a color</span>
              </div>
            )}
          </button>

          {/* Selection hint */}
          {selectingRemove && (
            <p className="text-xs text-red-400 text-center">
              Click a color below to select it for removal
            </p>
          )}

          {/* Remove button */}
          <button
            onClick={handleRemove}
            disabled={!removeColor}
            className="w-full py-2 px-3 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Remove All Instances
          </button>
        </div>
      )}

      {/* Color recommendation modal */}
      {recommendation && (
        <div className="p-3 border-b border-slate-700 bg-amber-900/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-400 uppercase tracking-wider font-medium">Out of Stock</span>
            <button
              onClick={() => setRecommendation(null)}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-xs text-slate-300">
            <span className="font-medium text-white">DMC {recommendation.selected.dmcNumber}</span> is not in stock.
            We found a similar color:
          </p>

          {/* Color comparison */}
          <div className="flex items-center gap-3">
            {/* Selected (out of stock) */}
            <div className="flex-1 text-center">
              <div
                className="w-12 h-12 rounded-lg border-2 border-red-500/50 mx-auto opacity-60"
                style={{ backgroundColor: recommendation.selected.hex }}
              />
              <p className="text-xs text-slate-400 mt-1">DMC {recommendation.selected.dmcNumber}</p>
              <p className="text-[10px] text-red-400">Out of stock</p>
            </div>

            {/* Arrow */}
            <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>

            {/* Suggested (in stock) */}
            <div className="flex-1 text-center">
              <div
                className="w-12 h-12 rounded-lg border-2 border-green-500/50 mx-auto"
                style={{ backgroundColor: recommendation.suggested.hex }}
              />
              <p className="text-xs text-white mt-1">DMC {recommendation.suggested.dmcNumber}</p>
              <p className="text-[10px] text-green-400">In stock</p>
            </div>
          </div>

          {/* Similarity indicator */}
          <div className="text-center">
            <span className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300">
              {getSimilarityDescription(recommendation.deltaE)}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleUseRecommended}
              className="flex-1 py-2 px-3 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 font-medium"
            >
              Use {recommendation.suggested.dmcNumber}
            </button>
            <button
              onClick={handleUseOriginal}
              className="flex-1 py-2 px-3 rounded-lg text-sm bg-slate-600 text-white hover:bg-slate-500"
            >
              Use Anyway
            </button>
          </div>
        </div>
      )}

      {/* Color grid */}
      <div
        className="flex-1 overflow-y-auto p-2 min-h-0 max-h-[40vh] md:max-h-none overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="grid grid-cols-5 gap-1">
          {filteredColors.map((color) => (
            <ColorSwatch
              key={color.dmcNumber}
              color={color}
              isCurrentColor={currentColor?.dmcNumber === color.dmcNumber}
              isReplaceFrom={replaceFrom?.dmcNumber === color.dmcNumber}
              isReplaceTo={replaceTo?.dmcNumber === color.dmcNumber}
              isRemoveTarget={removeColor?.dmcNumber === color.dmcNumber}
              isSelecting={selectingFor !== null || selectingRemove}
              selectingRemove={selectingRemove}
              selectingFor={selectingFor}
              isInStock={inStockSet.has(color.dmcNumber)}
              hasInventoryData={inStockSet.size > 0}
              onClick={() => handleColorClick(color)}
            />
          ))}
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

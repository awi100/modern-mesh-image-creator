"use client";

import React, { useState, useMemo } from "react";
import { useEditorStore } from "@/lib/store";
import { DMC_PEARL_COTTON, DmcColor, searchDmcColors } from "@/lib/dmc-pearl-cotton";

export default function ColorPicker() {
  const { currentColor, setCurrentColor, getUsedColors, replaceAllColor, grid } = useEditorStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState<DmcColor | null>(null);

  const usedColors = getUsedColors();

  const filteredColors = useMemo(() => {
    if (searchQuery) {
      return searchDmcColors(searchQuery);
    }
    return showAll ? DMC_PEARL_COTTON : usedColors;
  }, [searchQuery, showAll, usedColors]);

  const handleColorClick = (color: DmcColor) => {
    if (replaceMode) {
      if (!replaceFrom) {
        setReplaceFrom(color);
      } else {
        replaceAllColor(replaceFrom.dmcNumber, color.dmcNumber);
        setReplaceFrom(null);
        setReplaceMode(false);
      }
    } else {
      setCurrentColor(color);
    }
  };

  return (
    <div className="bg-slate-800 md:border-l border-slate-700 w-full md:w-64 flex flex-col">
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

      {/* Replace mode */}
      <div className="p-2 border-b border-slate-700">
        <button
          onClick={() => {
            setReplaceMode(!replaceMode);
            setReplaceFrom(null);
          }}
          className={`w-full py-2 px-3 rounded-lg text-sm ${
            replaceMode
              ? "bg-orange-600 text-white"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
        >
          {replaceMode
            ? replaceFrom
              ? `Replace ${replaceFrom.dmcNumber} with...`
              : "Select color to replace"
            : "Replace Color Mode"}
        </button>
      </div>

      {/* Color grid */}
      <div className="flex-1 overflow-auto p-2">
        <div className="grid grid-cols-5 gap-1">
          {filteredColors.map((color) => (
            <button
              key={color.dmcNumber}
              onClick={() => handleColorClick(color)}
              className={`aspect-square rounded-md border-2 transition-all ${
                currentColor?.dmcNumber === color.dmcNumber
                  ? "border-white scale-110 z-10"
                  : replaceFrom?.dmcNumber === color.dmcNumber
                  ? "border-orange-500 scale-110 z-10"
                  : "border-transparent hover:border-white/50"
              }`}
              style={{ backgroundColor: color.hex }}
              title={`DMC ${color.dmcNumber} - ${color.name}`}
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

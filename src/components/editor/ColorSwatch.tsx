"use client";

import React, { memo } from "react";
import { DmcColor } from "@/lib/dmc-pearl-cotton";

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

interface ColorSwatchProps {
  color: DmcColor;
  isCurrentColor: boolean;
  isReplaceFrom: boolean;
  isReplaceTo: boolean;
  isRemoveTarget: boolean;
  isSelecting: boolean;
  selectingRemove: boolean;
  selectingFor: 'from' | 'to' | null;
  isInStock: boolean;
  hasInventoryData: boolean;
  onClick: () => void;
}

function ColorSwatchComponent({
  color,
  isCurrentColor,
  isReplaceFrom,
  isReplaceTo,
  isRemoveTarget,
  isSelecting,
  selectingRemove,
  selectingFor,
  isInStock,
  hasInventoryData,
  onClick,
}: ColorSwatchProps) {
  return (
    <button
      onClick={onClick}
      className={`aspect-square rounded-md border-2 transition-all flex items-center justify-center relative ${
        isRemoveTarget
          ? "border-red-500 scale-110 z-10 ring-2 ring-red-500/50"
          : isReplaceFrom
          ? "border-orange-500 scale-110 z-10 ring-2 ring-orange-500/50"
          : isReplaceTo
          ? "border-green-500 scale-110 z-10 ring-2 ring-green-500/50"
          : isCurrentColor && !isSelecting
          ? "border-white scale-110 z-10"
          : selectingRemove
          ? "border-transparent hover:border-red-400 hover:scale-105"
          : selectingFor
          ? "border-transparent hover:border-orange-400 hover:scale-105"
          : "border-transparent hover:border-white/50"
      }${!isInStock && hasInventoryData ? " opacity-40" : ""}`}
      style={{ backgroundColor: color.hex }}
      title={`DMC ${color.dmcNumber} - ${color.name}${isInStock ? " (In Stock)" : hasInventoryData ? " (Not In Stock)" : ""}`}
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
}

// Memoize to prevent unnecessary re-renders when other colors change
export const ColorSwatch = memo(ColorSwatchComponent, (prevProps, nextProps) => {
  return (
    prevProps.color.dmcNumber === nextProps.color.dmcNumber &&
    prevProps.isCurrentColor === nextProps.isCurrentColor &&
    prevProps.isReplaceFrom === nextProps.isReplaceFrom &&
    prevProps.isReplaceTo === nextProps.isReplaceTo &&
    prevProps.isRemoveTarget === nextProps.isRemoveTarget &&
    prevProps.isSelecting === nextProps.isSelecting &&
    prevProps.selectingRemove === nextProps.selectingRemove &&
    prevProps.selectingFor === nextProps.selectingFor &&
    prevProps.isInStock === nextProps.isInStock &&
    prevProps.hasInventoryData === nextProps.hasInventoryData
  );
});

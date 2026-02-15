"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "@/lib/store";
import { getDmcColorByNumber, DMC_PEARL_COTTON, DmcColor } from "@/lib/dmc-pearl-cotton";
import {
  renderTextToPixels,
  addBorder,
  TEXT_FONTS,
  RenderedText,
  BorderOptions,
} from "@/lib/text-renderer";

interface AddTextDialogProps {
  onClose: () => void;
  onAddText: (
    pixels: (string | null)[][],
    width: number,
    height: number,
    textOptions?: {
      text: string;
      fontFamily: string;
      heightInStitches: number;
      bold: boolean;
      italic: boolean;
      letterSpacing: number;
      borderEnabled: boolean;
      borderWidth: number;
      borderPadding: number;
    },
    dmcNumber?: string
  ) => void;
}

export default function AddTextDialog({ onClose, onAddText }: AddTextDialogProps) {
  const { currentColor, setCurrentColor } = useEditorStore();
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Text settings
  const [text, setText] = useState("");
  const [selectedFont, setSelectedFont] = useState(TEXT_FONTS[0].id);
  const [heightInStitches, setHeightInStitches] = useState(12);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [letterSpacing, setLetterSpacing] = useState(0);

  // Border settings
  const [borderEnabled, setBorderEnabled] = useState(false);
  const [borderWidth, setBorderWidth] = useState(1);
  const [borderPadding, setBorderPadding] = useState(2);

  // Color picker state
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Rendered result
  const [rendered, setRendered] = useState<RenderedText | null>(null);

  const dmcNumber = currentColor?.dmcNumber || "310"; // Default to black
  const textColor = currentColor?.hex || "#000000";

  // Get font family from selected font
  const fontFamily = TEXT_FONTS.find((f) => f.id === selectedFont)?.family || TEXT_FONTS[0].family;

  // Render text when settings change
  useEffect(() => {
    if (!text.trim()) {
      setRendered(null);
      return;
    }

    const result = renderTextToPixels(
      {
        text,
        fontFamily,
        heightInStitches,
        bold,
        italic,
        letterSpacing,
      },
      dmcNumber
    );

    const borderOptions: BorderOptions = {
      enabled: borderEnabled,
      width: borderWidth,
      padding: borderPadding,
    };

    const withBorder = addBorder(result, borderOptions, dmcNumber);
    setRendered(withBorder);
  }, [text, fontFamily, heightInStitches, bold, italic, letterSpacing, borderEnabled, borderWidth, borderPadding, dmcNumber]);

  // Draw preview
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !rendered || rendered.width === 0) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#64748b";
          ctx.font = "14px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("Type text above to preview", canvas.width / 2, canvas.height / 2);
        }
      }
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate cell size to fit in preview
    const maxWidth = canvas.width;
    const maxHeight = canvas.height;
    const cellSize = Math.min(
      Math.floor(maxWidth / rendered.width),
      Math.floor(maxHeight / rendered.height),
      8 // Max cell size
    );

    // Calculate offset to center
    const totalWidth = rendered.width * cellSize;
    const totalHeight = rendered.height * cellSize;
    const offsetX = Math.floor((maxWidth - totalWidth) / 2);
    const offsetY = Math.floor((maxHeight - totalHeight) / 2);

    // Clear canvas
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, maxWidth, maxHeight);

    // Draw grid background
    ctx.fillStyle = "#334155";
    ctx.fillRect(offsetX, offsetY, totalWidth, totalHeight);

    // Draw pixels
    for (let y = 0; y < rendered.height; y++) {
      for (let x = 0; x < rendered.width; x++) {
        const dmcNum = rendered.pixels[y]?.[x];
        if (dmcNum) {
          // Look up hex color from DMC number
          const dmcColor = getDmcColorByNumber(dmcNum);
          ctx.fillStyle = dmcColor?.hex || textColor;
          ctx.fillRect(
            offsetX + x * cellSize,
            offsetY + y * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }

    // Draw subtle grid lines
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= rendered.width; x++) {
      ctx.beginPath();
      ctx.moveTo(offsetX + x * cellSize, offsetY);
      ctx.lineTo(offsetX + x * cellSize, offsetY + totalHeight);
      ctx.stroke();
    }
    for (let y = 0; y <= rendered.height; y++) {
      ctx.beginPath();
      ctx.moveTo(offsetX, offsetY + y * cellSize);
      ctx.lineTo(offsetX + totalWidth, offsetY + y * cellSize);
      ctx.stroke();
    }
  }, [rendered]);

  const handleAdd = useCallback(() => {
    if (rendered && rendered.width > 0) {
      // Pass text options for resize capability during placement
      onAddText(
        rendered.pixels,
        rendered.width,
        rendered.height,
        {
          text,
          fontFamily,
          heightInStitches,
          bold,
          italic,
          letterSpacing,
          borderEnabled,
          borderWidth,
          borderPadding,
        },
        dmcNumber
      );
    }
  }, [rendered, onAddText, text, fontFamily, heightInStitches, bold, italic, letterSpacing, borderEnabled, borderWidth, borderPadding, dmcNumber]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Add Text</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Text input */}
        <div className="mb-4">
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Text</label>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter your text..."
            className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-lg focus:outline-none focus:ring-2 focus:ring-rose-800"
            autoFocus
          />
        </div>

        {/* Font and style */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Font</label>
            <select
              value={selectedFont}
              onChange={(e) => setSelectedFont(e.target.value)}
              className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-800"
            >
              {TEXT_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Height (stitches)</label>
            <input
              type="number"
              min="6"
              max="100"
              value={heightInStitches}
              onChange={(e) => setHeightInStitches(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-800"
            />
          </div>
        </div>

        {/* Bold/Italic toggles and color */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setBold(!bold)}
            className={`px-4 py-2 rounded-lg font-bold transition-colors ${
              bold
                ? "bg-rose-900 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            B
          </button>
          <button
            onClick={() => setItalic(!italic)}
            className={`px-4 py-2 rounded-lg italic transition-colors ${
              italic
                ? "bg-rose-900 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            I
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">Color:</span>
            <button
              onClick={() => setShowColorPicker(true)}
              className="w-8 h-8 rounded border-2 border-slate-500 hover:border-rose-500 transition-colors cursor-pointer"
              style={{ backgroundColor: textColor }}
              title={currentColor ? `DMC ${currentColor.dmcNumber} - Click to change` : "Click to select color"}
            />
            {currentColor && (
              <span className="text-xs text-slate-500 dark:text-slate-400">{currentColor.dmcNumber}</span>
            )}
          </div>
        </div>

        {/* Letter spacing */}
        <div className="mb-4 p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Letter Spacing</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="-5"
              max="20"
              value={letterSpacing}
              onChange={(e) => setLetterSpacing(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-sm text-slate-600 dark:text-slate-300 w-12 text-right">
              {letterSpacing > 0 ? `+${letterSpacing}` : letterSpacing}
            </span>
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>Tight</span>
            <span>Normal</span>
            <span>Wide</span>
          </div>
        </div>

        {/* Border options */}
        <div className="mb-4 p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={borderEnabled}
              onChange={(e) => setBorderEnabled(e.target.checked)}
              className="w-4 h-4 text-rose-900 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-rose-800"
            />
            <span className="text-slate-600 dark:text-slate-300">Add border</span>
          </label>

          {borderEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Border width</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={borderWidth}
                  onChange={(e) => setBorderWidth(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Padding</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={borderPadding}
                  onChange={(e) => setBorderPadding(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                />
              </div>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="mb-4">
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Preview</label>
          <canvas
            ref={previewCanvasRef}
            width={400}
            height={150}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600"
          />
          {rendered && rendered.width > 0 && (
            <p className="text-xs text-slate-500 mt-2 text-center">
              Size: {rendered.width} × {rendered.height} stitches
            </p>
          )}
        </div>

        {/* Tip */}
        <p className="text-xs text-slate-500 mb-4">
          Tip: Select a DMC color first. After adding, click on the canvas to place the text.
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!rendered || rendered.width === 0}
            className="flex-1 py-2.5 px-4 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Add to Canvas
          </button>
        </div>
      </div>

      {/* Color picker modal */}
      {showColorPicker && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 w-full max-w-md max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Select Color</h3>
              <button
                onClick={() => setShowColorPicker(false)}
                className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-8 gap-1">
              {DMC_PEARL_COTTON.map((color: DmcColor) => (
                <button
                  key={color.dmcNumber}
                  onClick={() => {
                    setCurrentColor(color);
                    setShowColorPicker(false);
                  }}
                  className={`w-8 h-8 rounded border-2 transition-all ${
                    currentColor?.dmcNumber === color.dmcNumber
                      ? "border-rose-500 scale-110"
                      : "border-transparent hover:border-slate-400"
                  }`}
                  style={{ backgroundColor: color.hex }}
                  title={`DMC ${color.dmcNumber} - ${color.name}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

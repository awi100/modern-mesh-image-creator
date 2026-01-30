// PDF export utilities for needlepoint designs

import { jsPDF } from "jspdf";
import { PixelGrid } from "./color-utils";
import { DmcColor, getDmcColorByNumber } from "./dmc-pearl-cotton";
import { SYMBOLS } from "./symbols";

const DPI = 72; // jsPDF uses 72 DPI

interface ExportOptions {
  grid: PixelGrid;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  designName: string;
  usedColors: DmcColor[];
  fitToOnePage?: boolean; // If true, scale pattern to fit on one page
}

// Count stitches for each color in the grid
function countStitches(grid: PixelGrid): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== null) {
        counts.set(cell, (counts.get(cell) || 0) + 1);
      }
    }
  }
  return counts;
}

// Get contrasting color (black or white) for text/symbols on a background
function getContrastColor(r: number, g: number, b: number): string {
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

// Export artwork PDF - exact size, no grid, for printing
export function exportArtworkPdf(options: ExportOptions): jsPDF {
  const { grid, widthInches, heightInches, meshCount, designName } = options;

  // Create PDF at exact physical size
  const doc = new jsPDF({
    orientation: widthInches > heightInches ? "landscape" : "portrait",
    unit: "in",
    format: [widthInches, heightInches],
  });

  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  // Calculate cell size in inches
  const cellWidth = widthInches / gridWidth;
  const cellHeight = heightInches / gridHeight;

  // Draw each pixel
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y][x];
      if (dmcNumber === null) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      doc.setFillColor(color.rgb.r, color.rgb.g, color.rgb.b);
      doc.rect(
        x * cellWidth,
        y * cellHeight,
        cellWidth,
        cellHeight,
        "F"
      );
    }
  }

  return doc;
}

// Export stitch guide PDF - single page with image and legend
export function exportStitchGuidePdf(options: ExportOptions): jsPDF {
  const { grid, widthInches, heightInches, meshCount, designName, usedColors } = options;

  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  // Count stitches per color
  const stitchCounts = countStitches(grid);

  // Create symbol map for colors
  const colorSymbols = new Map<string, string>();
  usedColors.forEach((color, i) => {
    colorSymbols.set(color.dmcNumber, SYMBOLS[i % SYMBOLS.length]);
  });

  // Always use landscape for better layout with image + legend side by side
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "in",
    format: "letter",
  });

  const pageWidth = 11;
  const pageHeight = 8.5;
  const margin = 0.4;

  // Calculate total stitches
  const totalStitches = Array.from(stitchCounts.values()).reduce((a, b) => a + b, 0);

  // --- Title at top ---
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(designName, pageWidth / 2, margin + 0.2, { align: "center" });

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(
    `${widthInches}" × ${heightInches}" at ${meshCount} mesh | ${gridWidth} × ${gridHeight} grid | ${totalStitches.toLocaleString()} stitches | ${usedColors.length} colors`,
    pageWidth / 2,
    margin + 0.45,
    { align: "center" }
  );

  const contentStartY = margin + 0.7;
  const contentHeight = pageHeight - contentStartY - margin;

  // Layout: Image on left (60%), Legend on right (40%)
  const imageAreaWidth = (pageWidth - 2 * margin) * 0.58;
  const legendAreaWidth = (pageWidth - 2 * margin) * 0.38;
  const gapBetween = (pageWidth - 2 * margin) * 0.04;

  // --- Draw the stitch image on the left ---
  const imageX = margin;
  const imageY = contentStartY;

  // Calculate cell size to fit image in available space
  const maxImageWidth = imageAreaWidth;
  const maxImageHeight = contentHeight;
  const cellSize = Math.min(maxImageWidth / gridWidth, maxImageHeight / gridHeight);
  const actualImageWidth = cellSize * gridWidth;
  const actualImageHeight = cellSize * gridHeight;

  // Center the image in its area
  const imageOffsetX = imageX + (maxImageWidth - actualImageWidth) / 2;
  const imageOffsetY = imageY + (maxImageHeight - actualImageHeight) / 2;

  // Draw pixels
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y][x];
      if (dmcNumber === null) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      doc.setFillColor(color.rgb.r, color.rgb.g, color.rgb.b);
      doc.rect(
        imageOffsetX + x * cellSize,
        imageOffsetY + y * cellSize,
        cellSize,
        cellSize,
        "F"
      );
    }
  }

  // Draw border around image
  doc.setDrawColor(0);
  doc.setLineWidth(0.01);
  doc.rect(imageOffsetX, imageOffsetY, actualImageWidth, actualImageHeight);

  // --- Draw legend on the right ---
  const legendX = margin + imageAreaWidth + gapBetween;
  const legendY = contentStartY;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Color Legend", legendX, legendY + 0.15);

  const legendStartY = legendY + 0.4;
  const colorBoxSize = 0.25;
  const legendLineHeight = 0.38;

  // Calculate how many colors can fit
  const maxLegendRows = Math.floor((contentHeight - 0.4) / legendLineHeight);

  usedColors.forEach((color, i) => {
    if (i >= maxLegendRows) return; // Skip if too many colors

    const y = legendStartY + i * legendLineHeight;

    // Color box with symbol
    doc.setFillColor(color.rgb.r, color.rgb.g, color.rgb.b);
    doc.rect(legendX, y, colorBoxSize, colorBoxSize, "F");
    doc.setDrawColor(0);
    doc.setLineWidth(0.005);
    doc.rect(legendX, y, colorBoxSize, colorBoxSize);

    // Draw symbol in center of color box
    const symbol = colorSymbols.get(color.dmcNumber) || "●";
    const contrastColor = getContrastColor(color.rgb.r, color.rgb.g, color.rgb.b);
    doc.setTextColor(contrastColor);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(symbol, legendX + colorBoxSize / 2, y + colorBoxSize / 2 + 0.03, { align: "center" });

    // Reset text color
    doc.setTextColor(0, 0, 0);

    // DMC number, name, and stitch count on one line
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const count = stitchCounts.get(color.dmcNumber) || 0;
    doc.text(`${color.dmcNumber}`, legendX + colorBoxSize + 0.08, y + 0.1);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    // Truncate name if too long
    const maxNameLength = 18;
    const displayName = color.name.length > maxNameLength
      ? color.name.substring(0, maxNameLength - 1) + "…"
      : color.name;
    doc.text(displayName, legendX + colorBoxSize + 0.08, y + 0.22);

    doc.setTextColor(100, 100, 100);
    doc.text(`${count.toLocaleString()}`, legendX + legendAreaWidth - 0.1, y + 0.16, { align: "right" });
    doc.setTextColor(0, 0, 0);
  });

  // If there are more colors than fit, show a note
  if (usedColors.length > maxLegendRows) {
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(
      `+ ${usedColors.length - maxLegendRows} more colors`,
      legendX,
      legendStartY + maxLegendRows * legendLineHeight + 0.1
    );
    doc.setTextColor(0, 0, 0);
  }

  return doc;
}

// Generate preview image as data URL
export function generatePreviewImage(
  grid: PixelGrid,
  maxSize: number = 400
): string {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  if (gridWidth === 0 || gridHeight === 0) {
    return "";
  }

  const scale = Math.min(maxSize / gridWidth, maxSize / gridHeight);
  const width = Math.floor(gridWidth * scale);
  const height = Math.floor(gridHeight * scale);
  const cellWidth = width / gridWidth;
  const cellHeight = height / gridHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) return "";

  // Fill background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  // Draw pixels
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y][x];
      if (dmcNumber === null) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      ctx.fillStyle = color.hex;
      ctx.fillRect(
        Math.floor(x * cellWidth),
        Math.floor(y * cellHeight),
        Math.ceil(cellWidth),
        Math.ceil(cellHeight)
      );
    }
  }

  return canvas.toDataURL("image/png");
}

/**
 * Generate a full-resolution image where each grid cell = meshCount pixels
 * @param grid - The pixel grid
 * @param meshCount - Mesh count (14 or 18), each cell becomes this many pixels
 * @param format - "png" or "jpeg"
 * @returns Data URL of the generated image
 */
export function generateFullResImage(
  grid: PixelGrid,
  meshCount: number,
  format: "png" | "jpeg" = "png"
): string {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  if (gridWidth === 0 || gridHeight === 0) {
    return "";
  }

  // Each grid cell = meshCount pixels
  const cellSize = meshCount;
  const width = gridWidth * cellSize;
  const height = gridHeight * cellSize;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) return "";

  // Fill background with white
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  // Draw pixels
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y][x];
      if (dmcNumber === null) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      ctx.fillStyle = color.hex;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const quality = format === "jpeg" ? 0.92 : undefined;
  return canvas.toDataURL(mimeType, quality);
}

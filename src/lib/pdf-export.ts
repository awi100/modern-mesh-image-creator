// PDF export utilities for needlepoint designs

import { jsPDF } from "jspdf";
import { PixelGrid } from "./color-utils";
import { DmcColor, getDmcColorByNumber } from "./dmc-pearl-cotton";

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

// Export stitch guide as image with design and legend side by side
export function exportStitchGuideImage(options: ExportOptions): string {
  const { grid, designName, usedColors } = options;

  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  if (gridWidth === 0 || gridHeight === 0) {
    return "";
  }

  // Count stitches per color
  const stitchCounts = countStitches(grid);

  // Canvas dimensions (landscape, similar to letter size ratio)
  const canvasWidth = 2200;
  const canvasHeight = 1700;
  const margin = 40;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");

  if (!ctx) return "";

  // Fill background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // --- Title at top ---
  ctx.fillStyle = "#000000";
  ctx.font = "bold 48px Arial";
  ctx.textAlign = "center";
  ctx.fillText(designName, canvasWidth / 2, margin + 40);

  const contentStartY = margin + 70;
  const contentHeight = canvasHeight - contentStartY - margin;

  // Layout: Image on left (70%), Legend on right (30%)
  const imageAreaWidth = (canvasWidth - 2 * margin) * 0.70;
  const legendAreaWidth = (canvasWidth - 2 * margin) * 0.26;
  const gapBetween = (canvasWidth - 2 * margin) * 0.04;

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

      ctx.fillStyle = color.hex;
      ctx.fillRect(
        imageOffsetX + x * cellSize,
        imageOffsetY + y * cellSize,
        cellSize,
        cellSize
      );
    }
  }

  // Draw border around image
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.strokeRect(imageOffsetX, imageOffsetY, actualImageWidth, actualImageHeight);

  // --- Draw compact legend on the right ---
  const legendX = margin + imageAreaWidth + gapBetween;
  const legendY = contentStartY;

  ctx.fillStyle = "#000000";
  ctx.font = "bold 28px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Legend", legendX, legendY + 25);

  const legendStartY = legendY + 50;
  const colorBoxSize = 36;
  const legendLineHeight = 50;

  // Calculate how many colors can fit
  const maxLegendRows = Math.floor((contentHeight - 50) / legendLineHeight);

  usedColors.forEach((color, i) => {
    if (i >= maxLegendRows) return; // Skip if too many colors

    const y = legendStartY + i * legendLineHeight;

    // Color box
    ctx.fillStyle = color.hex;
    ctx.fillRect(legendX, y, colorBoxSize, colorBoxSize);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, y, colorBoxSize, colorBoxSize);

    // DMC number and stitch count
    ctx.fillStyle = "#000000";
    ctx.font = "bold 20px Arial";
    const count = stitchCounts.get(color.dmcNumber) || 0;
    ctx.fillText(`${color.dmcNumber}`, legendX + colorBoxSize + 12, y + 16);

    ctx.font = "16px Arial";
    ctx.fillStyle = "#666666";
    ctx.fillText(`${count.toLocaleString()}`, legendX + colorBoxSize + 12, y + 34);
  });

  // If there are more colors than fit, show a note
  if (usedColors.length > maxLegendRows) {
    ctx.font = "16px Arial";
    ctx.fillStyle = "#888888";
    ctx.fillText(
      `+ ${usedColors.length - maxLegendRows} more`,
      legendX,
      legendStartY + maxLegendRows * legendLineHeight + 20
    );
  }

  return canvas.toDataURL("image/png");
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

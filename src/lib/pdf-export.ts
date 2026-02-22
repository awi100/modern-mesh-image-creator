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
  // Use higher resolution for cleaner grid lines
  const canvasWidth = 3300;
  const canvasHeight = 2550;
  const margin = 60;

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
  ctx.font = "bold 64px Arial";
  ctx.textAlign = "center";
  ctx.fillText(designName, canvasWidth / 2, margin + 50);

  const contentStartY = margin + 90;
  const contentHeight = canvasHeight - contentStartY - margin;

  // Layout: Image on left (72%), Legend on right (28%)
  const imageAreaWidth = (canvasWidth - 2 * margin) * 0.72;
  const legendAreaWidth = (canvasWidth - 2 * margin) * 0.24;
  const gapBetween = (canvasWidth - 2 * margin) * 0.04;

  // --- Draw the stitch image on the left ---
  const imageX = margin;
  const imageY = contentStartY;

  // Calculate cell size to fit image in available space
  // Ensure minimum cell size for visible grid lines
  const maxImageWidth = imageAreaWidth;
  const maxImageHeight = contentHeight;
  const cellSize = Math.max(
    Math.min(maxImageWidth / gridWidth, maxImageHeight / gridHeight),
    4 // Minimum 4 pixels per cell for visibility
  );
  const actualImageWidth = cellSize * gridWidth;
  const actualImageHeight = cellSize * gridHeight;

  // Center the image in its area
  const imageOffsetX = imageX + (maxImageWidth - actualImageWidth) / 2;
  const imageOffsetY = imageY + (maxImageHeight - actualImageHeight) / 2;

  // Draw pixels (fill cells first)
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y][x];
      if (dmcNumber === null) {
        // Draw empty cells with very light gray
        ctx.fillStyle = "#FAFAFA";
        ctx.fillRect(
          imageOffsetX + x * cellSize,
          imageOffsetY + y * cellSize,
          cellSize,
          cellSize
        );
        continue;
      }

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

  // Draw grid lines for each stitch
  ctx.strokeStyle = "#CCCCCC";
  ctx.lineWidth = 0.5;

  // Vertical lines
  for (let x = 0; x <= gridWidth; x++) {
    const lineX = imageOffsetX + x * cellSize;
    ctx.beginPath();
    ctx.moveTo(lineX, imageOffsetY);
    ctx.lineTo(lineX, imageOffsetY + actualImageHeight);
    ctx.stroke();
  }

  // Horizontal lines
  for (let y = 0; y <= gridHeight; y++) {
    const lineY = imageOffsetY + y * cellSize;
    ctx.beginPath();
    ctx.moveTo(imageOffsetX, lineY);
    ctx.lineTo(imageOffsetX + actualImageWidth, lineY);
    ctx.stroke();
  }

  // Draw thicker lines every 10 stitches for easier counting
  ctx.strokeStyle = "#888888";
  ctx.lineWidth = 1.5;

  // Vertical lines every 10
  for (let x = 0; x <= gridWidth; x += 10) {
    const lineX = imageOffsetX + x * cellSize;
    ctx.beginPath();
    ctx.moveTo(lineX, imageOffsetY);
    ctx.lineTo(lineX, imageOffsetY + actualImageHeight);
    ctx.stroke();
  }

  // Horizontal lines every 10
  for (let y = 0; y <= gridHeight; y += 10) {
    const lineY = imageOffsetY + y * cellSize;
    ctx.beginPath();
    ctx.moveTo(imageOffsetX, lineY);
    ctx.lineTo(imageOffsetX + actualImageWidth, lineY);
    ctx.stroke();
  }

  // Draw border around image
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  ctx.strokeRect(imageOffsetX, imageOffsetY, actualImageWidth, actualImageHeight);

  // --- Draw compact legend on the right ---
  const legendX = margin + imageAreaWidth + gapBetween;
  const legendY = contentStartY;

  ctx.fillStyle = "#000000";
  ctx.font = "bold 36px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Legend", legendX, legendY + 35);

  const legendStartY = legendY + 70;
  const colorBoxSize = 48;
  const legendLineHeight = 64;

  // Calculate how many colors can fit
  const maxLegendRows = Math.floor((contentHeight - 70) / legendLineHeight);

  usedColors.forEach((color, i) => {
    if (i >= maxLegendRows) return; // Skip if too many colors

    const y = legendStartY + i * legendLineHeight;

    // Color box
    ctx.fillStyle = color.hex;
    ctx.fillRect(legendX, y, colorBoxSize, colorBoxSize);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(legendX, y, colorBoxSize, colorBoxSize);

    // DMC number and stitch count
    ctx.fillStyle = "#000000";
    ctx.font = "bold 26px Arial";
    const count = stitchCounts.get(color.dmcNumber) || 0;
    ctx.fillText(`${color.dmcNumber}`, legendX + colorBoxSize + 16, y + 22);

    ctx.font = "20px Arial";
    ctx.fillStyle = "#666666";
    ctx.fillText(`${count.toLocaleString()} stitches`, legendX + colorBoxSize + 16, y + 44);
  });

  // If there are more colors than fit, show a note
  if (usedColors.length > maxLegendRows) {
    ctx.font = "22px Arial";
    ctx.fillStyle = "#888888";
    ctx.fillText(
      `+ ${usedColors.length - maxLegendRows} more colors`,
      legendX,
      legendStartY + maxLegendRows * legendLineHeight + 30
    );
  }

  // Add grid dimensions at the bottom
  ctx.font = "20px Arial";
  ctx.fillStyle = "#666666";
  ctx.textAlign = "center";
  ctx.fillText(
    `${gridWidth} × ${gridHeight} stitches`,
    canvasWidth / 2,
    canvasHeight - margin / 2
  );

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

/**
 * Generate a 1:1 pixel image where each grid cell = 1 pixel
 * For an 8.5" × 11" design at 14 mesh, this produces a 119 × 154 pixel image
 * @param grid - The pixel grid
 * @param format - "png" or "jpeg"
 * @returns Data URL of the generated image
 */
export function generateOneToOneImage(
  grid: PixelGrid,
  format: "png" | "jpeg" = "png"
): string {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  if (gridWidth === 0 || gridHeight === 0) {
    return "";
  }

  // Each grid cell = 1 pixel
  const canvas = document.createElement("canvas");
  canvas.width = gridWidth;
  canvas.height = gridHeight;
  const ctx = canvas.getContext("2d");

  if (!ctx) return "";

  // Fill background with white
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, gridWidth, gridHeight);

  // Draw pixels - 1 pixel per stitch
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y][x];
      if (dmcNumber === null) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      ctx.fillStyle = color.hex;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const quality = format === "jpeg" ? 0.92 : undefined;
  return canvas.toDataURL(mimeType, quality);
}

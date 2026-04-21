// PDF export utilities for needlepoint designs

import { jsPDF } from "jspdf";
import { PixelGrid } from "./color-utils";
import { DmcColor, getDmcColorByNumber } from "./dmc-pearl-cotton";

const DPI = 72; // jsPDF uses 72 DPI

// ---- Print color compensation ----
// Compensates for 3rd-party printer darkening saturated and dark colors.
// Printers darken based on ink density, which depends on BOTH lightness and
// saturation. A saturated mid-tone purple (L=52, S=36) prints much darker
// than it appears on screen.
//
// PRINT_BOOST_MAX: max lightness points added to the highest-ink-density colors.
// PRINT_LIGHTNESS_THRESHOLD: pure-lightness cutoff — above this, no boost at all.
// PRINT_SATURATION_WEIGHT: how much saturation contributes to ink density (0-1).
//   0 = ignore saturation, 1 = fully saturated mid-tones get same boost as darks.
//
// Change these values based on test prints.
const PRINT_BOOST_MAX = 12;
const PRINT_LIGHTNESS_THRESHOLD = 65;
const PRINT_SATURATION_WEIGHT = 0.4;

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Lighten colors for print compensation based on ink density.
 * Ink density is estimated from both darkness (low lightness) and saturation.
 * A saturated purple at L=52 gets a meaningful boost. A pale pink at L=86 doesn't.
 * Contrast is preserved — the boost is proportional to each color's ink density,
 * so two similar colors maintain their relative difference.
 */
function adjustColorForPrint(hex: string): string {
  const hsl = hexToHsl(hex);
  if (hsl.l >= PRINT_LIGHTNESS_THRESHOLD) return hex;

  // Darkness factor: 1.0 at L=0, tapering to 0 at threshold
  const darknessFactor = 1 - hsl.l / PRINT_LIGHTNESS_THRESHOLD;

  // Saturation factor: saturated colors use more ink, even at moderate lightness
  const saturationFactor = (hsl.s / 100) * PRINT_SATURATION_WEIGHT;

  // Combined ink density: darkness is primary, saturation adds to it
  const inkDensity = Math.min(1, darknessFactor + saturationFactor * darknessFactor);

  const boost = PRINT_BOOST_MAX * inkDensity;
  return hslToHex(hsl.h, hsl.s, hsl.l + boost);
}

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
 * Shared helper: render a high-res image PDF page (300 DPI, no grid).
 * Returns the jsPDF doc without saving.
 */
function createImagePdfDoc(options: {
  grid: PixelGrid;
  widthInches: number;
  heightInches: number;
}): jsPDF | null {
  const { grid, widthInches, heightInches } = options;

  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;
  if (gridWidth === 0 || gridHeight === 0) return null;

  const pdfDpi = 300;
  const pxWidth = Math.round(widthInches * pdfDpi);
  const pxHeight = Math.round(heightInches * pdfDpi);

  const cellW = pxWidth / gridWidth;
  const cellH = pxHeight / gridHeight;

  const canvas = document.createElement("canvas");
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, pxWidth, pxHeight);

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y][x];
      if (dmcNumber === null) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      ctx.fillStyle = adjustColorForPrint(color.hex);
      ctx.fillRect(
        Math.floor(x * cellW),
        Math.floor(y * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH)
      );
    }
  }

  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  const doc = new jsPDF({
    orientation: widthInches > heightInches ? "landscape" : "portrait",
    unit: "in",
    format: [widthInches, heightInches],
  });

  doc.addImage(imgData, "JPEG", 0, 0, widthInches, heightInches);
  return doc;
}

/**
 * Export a high-res PDF containing only the design image (no grid, no legend, no text).
 * Renders at 300 DPI for print quality.
 */
export function exportImagePdf(options: {
  grid: PixelGrid;
  widthInches: number;
  heightInches: number;
  designName: string;
}): void {
  const doc = createImagePdfDoc(options);
  if (!doc) return;
  doc.save(`${options.designName.replace(/\s+/g, "_")}_print.pdf`);
}

/**
 * Generate a high-res image PDF as an ArrayBuffer (for zipping multiple PDFs).
 */
export function generateImagePdfBlob(options: {
  grid: PixelGrid;
  widthInches: number;
  heightInches: number;
  designName: string;
}): ArrayBuffer | null {
  const doc = createImagePdfDoc(options);
  if (!doc) return null;
  return doc.output("arraybuffer");
}

/**
 * Options for print order PDF (image + spec sheet).
 */
interface PrintOrderOptions {
  grid: PixelGrid;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  gridWidth: number;
  gridHeight: number;
  designName: string;
  colorsUsed?: string[] | null;
}

/**
 * Shared helper: create a 2-page print order PDF.
 * Page 1: high-res image at 300 DPI (no grid).
 * Page 2: spec sheet with all printer-required info.
 */
function createPrintOrderDoc(options: PrintOrderOptions): jsPDF | null {
  const { grid, widthInches, heightInches, meshCount, gridWidth, gridHeight, designName, colorsUsed } = options;

  const doc = createImagePdfDoc({ grid, widthInches, heightInches });
  if (!doc) return null;

  // Count colors and stitches from grid
  const colorSet = new Set<string>();
  let totalStitches = 0;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < (grid[0]?.length || 0); x++) {
      const c = grid[y][x];
      if (c !== null) {
        colorSet.add(c);
        totalStitches++;
      }
    }
  }
  const colorCount = colorsUsed ? colorsUsed.length : colorSet.size;

  // Page 2: spec sheet on US Letter
  doc.addPage("letter", "portrait");

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(30, 30, 30);
  doc.text(designName, 0.75, 1);

  // Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(120, 120, 120);
  doc.text("Canvas Print Specification Sheet", 0.75, 1.35);

  // Horizontal rule
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.01);
  doc.line(0.75, 1.5, 7.75, 1.5);

  // Spec rows
  const specs: [string, string][] = [
    ["Pattern Dimensions", `${widthInches}" × ${heightInches}"`],
    ["Mesh Count", `${meshCount} CT`],
    ["Grid Size", `${gridWidth} × ${gridHeight} stitches`],
    ["Vertical Grid Lines", `${gridWidth + 1}`],
    ["Horizontal Grid Lines", `${gridHeight + 1}`],
    ["Canvas Size", `${widthInches + 4}" × ${heightInches + 4}"`],
    ["Colors", `${colorCount}`],
    ["Total Stitches", totalStitches.toLocaleString()],
  ];

  let y = 2.0;
  for (const [label, value] of specs) {
    // Label
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(120, 120, 120);
    doc.text(label, 0.75, y);

    // Value
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    doc.text(value, 3.25, y);

    // Light separator
    doc.setDrawColor(230, 230, 230);
    doc.line(0.75, y + 0.12, 7.75, y + 0.12);

    y += 0.45;
  }

  // Footer
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(160, 160, 160);
  doc.text(`Generated ${date}`, 0.75, 10.25);

  return doc;
}

/**
 * Export a 2-page print order PDF (image + spec sheet) and download it.
 */
export function exportPrintOrderPdf(options: PrintOrderOptions): void {
  const doc = createPrintOrderDoc(options);
  if (!doc) return;
  doc.save(`${options.designName.replace(/\s+/g, "_")}_print_order.pdf`);
}

/**
 * Generate a 2-page print order PDF as an ArrayBuffer (for zipping).
 */
export function generatePrintOrderPdfBlob(options: PrintOrderOptions): ArrayBuffer | null {
  const doc = createPrintOrderDoc(options);
  if (!doc) return null;
  return doc.output("arraybuffer");
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

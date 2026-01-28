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

// Export stitch guide PDF - with grid, legend, and cover page
export function exportStitchGuidePdf(options: ExportOptions): jsPDF {
  const { grid, widthInches, heightInches, meshCount, designName, usedColors, fitToOnePage = false } = options;

  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  // Count stitches per color
  const stitchCounts = countStitches(grid);

  // Create symbol map for colors
  const colorSymbols = new Map<string, string>();
  usedColors.forEach((color, i) => {
    colorSymbols.set(color.dmcNumber, SYMBOLS[i % SYMBOLS.length]);
  });

  // Use letter size for stitch guide (or landscape if wider)
  const isWide = gridWidth > gridHeight * 1.3;
  const doc = new jsPDF({
    orientation: fitToOnePage && isWide ? "landscape" : "portrait",
    unit: "in",
    format: "letter",
  });

  const pageWidth = fitToOnePage && isWide ? 11 : 8.5;
  const pageHeight = fitToOnePage && isWide ? 8.5 : 11;
  const margin = 0.5;
  const contentWidth = pageWidth - 2 * margin;
  const contentHeight = pageHeight - 2 * margin;

  // Calculate total stitches
  const totalStitches = Array.from(stitchCounts.values()).reduce((a, b) => a + b, 0);

  // --- Cover Page ---
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text(designName, pageWidth / 2, 2, { align: "center" });

  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.text(`${widthInches}" × ${heightInches}" at ${meshCount} mesh`, pageWidth / 2, 2.5, { align: "center" });
  doc.text(`${gridWidth} × ${gridHeight} grid (${totalStitches.toLocaleString()} total stitches)`, pageWidth / 2, 2.9, { align: "center" });
  doc.text(`${usedColors.length} colors`, pageWidth / 2, 3.2, { align: "center" });

  // Preview image
  const previewSize = 4;
  const previewX = (pageWidth - previewSize) / 2;
  const previewY = 3.8;

  const cellSize = previewSize / Math.max(gridWidth, gridHeight);
  const previewWidth = cellSize * gridWidth;
  const previewHeight = cellSize * gridHeight;
  const actualPreviewX = previewX + (previewSize - previewWidth) / 2;
  const actualPreviewY = previewY + (previewSize - previewHeight) / 2;

  // Draw preview
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const dmcNumber = grid[y][x];
      if (dmcNumber === null) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      doc.setFillColor(color.rgb.r, color.rgb.g, color.rgb.b);
      doc.rect(
        actualPreviewX + x * cellSize,
        actualPreviewY + y * cellSize,
        cellSize,
        cellSize,
        "F"
      );
    }
  }

  // Draw border around preview
  doc.setDrawColor(0);
  doc.setLineWidth(0.01);
  doc.rect(actualPreviewX, actualPreviewY, previewWidth, previewHeight);

  // --- Legend Page ---
  doc.addPage();

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Color Legend", margin, margin + 0.3);

  const legendStartY = margin + 0.8;
  const colorBoxSize = 0.35;
  const legendLineHeight = 0.55;
  const colWidth = contentWidth / 2;

  usedColors.forEach((color, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * colWidth;
    const y = legendStartY + row * legendLineHeight;

    // Skip if off page
    if (y > pageHeight - margin) return;

    // Color box with symbol
    doc.setFillColor(color.rgb.r, color.rgb.g, color.rgb.b);
    doc.rect(x, y, colorBoxSize, colorBoxSize, "F");
    doc.setDrawColor(0);
    doc.rect(x, y, colorBoxSize, colorBoxSize);

    // Draw symbol in center of color box
    const symbol = colorSymbols.get(color.dmcNumber) || "●";
    const contrastColor = getContrastColor(color.rgb.r, color.rgb.g, color.rgb.b);
    doc.setTextColor(contrastColor);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(symbol, x + colorBoxSize / 2, y + colorBoxSize / 2 + 0.05, { align: "center" });

    // Reset text color
    doc.setTextColor(0, 0, 0);

    // DMC number and name
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    const count = stitchCounts.get(color.dmcNumber) || 0;
    doc.text(`DMC ${color.dmcNumber}`, x + colorBoxSize + 0.1, y + 0.12);
    doc.setFont("helvetica", "normal");
    doc.text(color.name, x + colorBoxSize + 0.1, y + 0.25);
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`${count.toLocaleString()} stitches`, x + colorBoxSize + 0.1, y + 0.38);
    doc.setTextColor(0, 0, 0);
  });

  // --- Pattern Pages ---
  // Calculate how to tile the pattern across multiple pages

  let pagesX: number;
  let pagesY: number;
  let cellsPerPageX: number;
  let cellsPerPageY: number;
  let actualCellSize: number;

  if (fitToOnePage) {
    // Scale to fit entire pattern on one page
    actualCellSize = Math.min(
      contentWidth / gridWidth,
      contentHeight / gridHeight
    );
    cellsPerPageX = gridWidth;
    cellsPerPageY = gridHeight;
    pagesX = 1;
    pagesY = 1;
  } else {
    // Target cell size for readability (in inches)
    const targetCellSize = 0.15; // ~10.5 cells per inch

    // Calculate cells per page
    cellsPerPageX = Math.floor(contentWidth / targetCellSize);
    cellsPerPageY = Math.floor(contentHeight / targetCellSize);

    // Calculate number of pages needed
    pagesX = Math.ceil(gridWidth / cellsPerPageX);
    pagesY = Math.ceil(gridHeight / cellsPerPageY);

    // Actual cell size to fit evenly
    actualCellSize = Math.min(
      contentWidth / Math.min(gridWidth, cellsPerPageX),
      contentHeight / Math.min(gridHeight, cellsPerPageY)
    );
  }

  for (let pageY = 0; pageY < pagesY; pageY++) {
    for (let pageX = 0; pageX < pagesX; pageX++) {
      doc.addPage();

      const startX = pageX * cellsPerPageX;
      const startY = pageY * cellsPerPageY;
      const endX = Math.min(startX + cellsPerPageX, gridWidth);
      const endY = Math.min(startY + cellsPerPageY, gridHeight);

      // Page header
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Page ${pageY * pagesX + pageX + 1} of ${pagesX * pagesY} | Columns ${startX + 1}-${endX} | Rows ${startY + 1}-${endY}`,
        margin,
        margin - 0.1
      );

      // Draw grid
      // Calculate font size for symbols based on cell size
      const symbolFontSize = Math.max(4, Math.min(10, actualCellSize * 50));

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const drawX = margin + (x - startX) * actualCellSize;
          const drawY = margin + (y - startY) * actualCellSize;

          const dmcNumber = grid[y][x];

          if (dmcNumber !== null) {
            const color = getDmcColorByNumber(dmcNumber);
            if (color) {
              // Fill cell with color
              doc.setFillColor(color.rgb.r, color.rgb.g, color.rgb.b);
              doc.rect(drawX, drawY, actualCellSize, actualCellSize, "F");

              // Draw symbol in cell (only if cell is large enough)
              if (actualCellSize >= 0.08) {
                const symbol = colorSymbols.get(dmcNumber) || "●";
                const contrastColor = getContrastColor(color.rgb.r, color.rgb.g, color.rgb.b);
                doc.setTextColor(contrastColor);
                doc.setFontSize(symbolFontSize);
                doc.setFont("helvetica", "bold");
                doc.text(
                  symbol,
                  drawX + actualCellSize / 2,
                  drawY + actualCellSize / 2 + actualCellSize * 0.15,
                  { align: "center" }
                );
              }
            }
          }

          // Grid line
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.005);
          doc.rect(drawX, drawY, actualCellSize, actualCellSize);
        }
      }

      // Reset text color
      doc.setTextColor(0, 0, 0);

      // Draw heavier lines every 10 cells
      doc.setDrawColor(100, 100, 100);
      doc.setLineWidth(0.015);

      for (let x = startX; x <= endX; x++) {
        if (x % 10 === 0) {
          const drawX = margin + (x - startX) * actualCellSize;
          doc.line(drawX, margin, drawX, margin + (endY - startY) * actualCellSize);
        }
      }

      for (let y = startY; y <= endY; y++) {
        if (y % 10 === 0) {
          const drawY = margin + (y - startY) * actualCellSize;
          doc.line(margin, drawY, margin + (endX - startX) * actualCellSize, drawY);
        }
      }

      // Row/column numbers
      doc.setFontSize(6);
      doc.setTextColor(100, 100, 100);

      // Column numbers at top
      for (let x = startX; x < endX; x++) {
        if ((x + 1) % 5 === 0) {
          const drawX = margin + (x - startX) * actualCellSize + actualCellSize / 2;
          doc.text(String(x + 1), drawX, margin - 0.05, { align: "center" });
        }
      }

      // Row numbers at left
      for (let y = startY; y < endY; y++) {
        if ((y + 1) % 5 === 0) {
          const drawY = margin + (y - startY) * actualCellSize + actualCellSize / 2 + 0.02;
          doc.text(String(y + 1), margin - 0.05, drawY, { align: "right" });
        }
      }

      doc.setTextColor(0, 0, 0);
    }
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

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
  const { grid, widthInches, heightInches, meshCount, designName, usedColors } = options;

  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  // Use letter size for stitch guide
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "in",
    format: "letter",
  });

  const pageWidth = 8.5;
  const pageHeight = 11;
  const margin = 0.5;
  const contentWidth = pageWidth - 2 * margin;
  const contentHeight = pageHeight - 2 * margin;

  // --- Cover Page ---
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text(designName, pageWidth / 2, 2, { align: "center" });

  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.text(`${widthInches}" × ${heightInches}" at ${meshCount} mesh`, pageWidth / 2, 2.5, { align: "center" });
  doc.text(`${gridWidth} × ${gridHeight} stitches`, pageWidth / 2, 2.9, { align: "center" });

  // Preview image
  const previewSize = 4;
  const previewX = (pageWidth - previewSize) / 2;
  const previewY = 3.5;

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
  const colorBoxSize = 0.3;
  const legendLineHeight = 0.45;
  const colWidth = contentWidth / 2;

  usedColors.forEach((color, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * colWidth;
    const y = legendStartY + row * legendLineHeight;

    // Skip if off page
    if (y > pageHeight - margin) return;

    // Color box
    doc.setFillColor(color.rgb.r, color.rgb.g, color.rgb.b);
    doc.rect(x, y, colorBoxSize, colorBoxSize, "F");
    doc.setDrawColor(0);
    doc.rect(x, y, colorBoxSize, colorBoxSize);

    // DMC number and name
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`DMC ${color.dmcNumber}`, x + colorBoxSize + 0.1, y + 0.12);
    doc.setFont("helvetica", "normal");
    doc.text(color.name, x + colorBoxSize + 0.1, y + 0.25);
  });

  // --- Pattern Pages ---
  // Calculate how to tile the pattern across multiple pages

  // Target cell size for readability (in inches)
  const targetCellSize = 0.15; // ~10.5 cells per inch

  // Calculate cells per page
  const cellsPerPageX = Math.floor(contentWidth / targetCellSize);
  const cellsPerPageY = Math.floor(contentHeight / targetCellSize);

  // Calculate number of pages needed
  const pagesX = Math.ceil(gridWidth / cellsPerPageX);
  const pagesY = Math.ceil(gridHeight / cellsPerPageY);

  // Actual cell size to fit evenly
  const actualCellSize = Math.min(
    contentWidth / Math.min(gridWidth, cellsPerPageX),
    contentHeight / Math.min(gridHeight, cellsPerPageY)
  );

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
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const drawX = margin + (x - startX) * actualCellSize;
          const drawY = margin + (y - startY) * actualCellSize;

          const dmcNumber = grid[y][x];

          if (dmcNumber !== null) {
            const color = getDmcColorByNumber(dmcNumber);
            if (color) {
              doc.setFillColor(color.rgb.r, color.rgb.g, color.rgb.b);
              doc.rect(drawX, drawY, actualCellSize, actualCellSize, "F");
            }
          }

          // Grid line
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.005);
          doc.rect(drawX, drawY, actualCellSize, actualCellSize);
        }
      }

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

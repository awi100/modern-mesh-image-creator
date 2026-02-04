// Realistic stitch preview and canvas preview renderer
import { getDmcColorByNumber } from "./dmc-pearl-cotton";

interface StitchPreviewOptions {
  grid: (string | null)[][];
  cellSize: number;
  stitchType: "continental" | "basketweave";
  showGrid: boolean;
  canvasColor?: string;
}

interface CanvasPreviewOptions {
  grid: (string | null)[][];
  cellSize: number;
  canvasColor?: string;
  showMesh?: boolean;
}

// Lighten a color by a percentage
function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round((num >> 16) + (255 - (num >> 16)) * percent));
  const g = Math.min(255, Math.round(((num >> 8) & 0x00ff) + (255 - ((num >> 8) & 0x00ff)) * percent));
  const b = Math.min(255, Math.round((num & 0x0000ff) + (255 - (num & 0x0000ff)) * percent));
  return `rgb(${r}, ${g}, ${b})`;
}

// Darken a color by a percentage
function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.round((num >> 16) * (1 - percent));
  const g = Math.round(((num >> 8) & 0x00ff) * (1 - percent));
  const b = Math.round((num & 0x0000ff) * (1 - percent));
  return `rgb(${r}, ${g}, ${b})`;
}

// Draw a single continental stitch (diagonal from bottom-left to top-right)
function drawContinentalStitch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  color: string,
  row: number,
  col: number
) {
  const padding = cellSize * 0.08;
  const threadWidth = cellSize * 0.35;

  // Base stitch - diagonal line
  ctx.beginPath();
  ctx.moveTo(x + padding, y + cellSize - padding);
  ctx.lineTo(x + cellSize - padding, y + padding);
  ctx.strokeStyle = color;
  ctx.lineWidth = threadWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  // Highlight on top edge of thread (light from top-left)
  ctx.beginPath();
  ctx.moveTo(x + padding + threadWidth * 0.2, y + cellSize - padding - threadWidth * 0.3);
  ctx.lineTo(x + cellSize - padding - threadWidth * 0.1, y + padding + threadWidth * 0.1);
  ctx.strokeStyle = lightenColor(color, 0.3);
  ctx.lineWidth = threadWidth * 0.25;
  ctx.stroke();

  // Shadow on bottom edge
  ctx.beginPath();
  ctx.moveTo(x + padding + threadWidth * 0.1, y + cellSize - padding + threadWidth * 0.1);
  ctx.lineTo(x + cellSize - padding + threadWidth * 0.2, y + padding + threadWidth * 0.3);
  ctx.strokeStyle = darkenColor(color, 0.25);
  ctx.lineWidth = threadWidth * 0.2;
  ctx.stroke();
}

// Draw a basketweave stitch (alternating directions)
function drawBasketweaveStitch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  color: string,
  row: number,
  col: number
) {
  const padding = cellSize * 0.08;
  const threadWidth = cellSize * 0.35;

  // Determine direction based on position (checkerboard pattern)
  const isAscending = (row + col) % 2 === 0;

  if (isAscending) {
    // Ascending stitch (bottom-left to top-right)
    ctx.beginPath();
    ctx.moveTo(x + padding, y + cellSize - padding);
    ctx.lineTo(x + cellSize - padding, y + padding);
    ctx.strokeStyle = color;
    ctx.lineWidth = threadWidth;
    ctx.lineCap = "round";
    ctx.stroke();

    // Highlight
    ctx.beginPath();
    ctx.moveTo(x + padding + threadWidth * 0.15, y + cellSize - padding - threadWidth * 0.25);
    ctx.lineTo(x + cellSize - padding - threadWidth * 0.1, y + padding + threadWidth * 0.1);
    ctx.strokeStyle = lightenColor(color, 0.35);
    ctx.lineWidth = threadWidth * 0.2;
    ctx.stroke();
  } else {
    // Descending stitch (top-left to bottom-right) - creates woven appearance
    ctx.beginPath();
    ctx.moveTo(x + padding, y + padding);
    ctx.lineTo(x + cellSize - padding, y + cellSize - padding);
    ctx.strokeStyle = color;
    ctx.lineWidth = threadWidth;
    ctx.lineCap = "round";
    ctx.stroke();

    // Highlight
    ctx.beginPath();
    ctx.moveTo(x + padding + threadWidth * 0.1, y + padding + threadWidth * 0.15);
    ctx.lineTo(x + cellSize - padding - threadWidth * 0.15, y + cellSize - padding - threadWidth * 0.2);
    ctx.strokeStyle = lightenColor(color, 0.35);
    ctx.lineWidth = threadWidth * 0.2;
    ctx.stroke();
  }

  // Add subtle shadow
  ctx.beginPath();
  if (isAscending) {
    ctx.moveTo(x + padding - threadWidth * 0.05, y + cellSize - padding + threadWidth * 0.15);
    ctx.lineTo(x + cellSize - padding + threadWidth * 0.15, y + padding - threadWidth * 0.05);
  } else {
    ctx.moveTo(x + padding - threadWidth * 0.05, y + padding - threadWidth * 0.05);
    ctx.lineTo(x + cellSize - padding + threadWidth * 0.15, y + cellSize - padding + threadWidth * 0.15);
  }
  ctx.strokeStyle = darkenColor(color, 0.2);
  ctx.lineWidth = threadWidth * 0.15;
  ctx.stroke();
}

// Draw canvas/mesh grid
function drawCanvasGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize: number,
  canvasColor: string
) {
  ctx.strokeStyle = canvasColor;
  ctx.lineWidth = 1;

  // Vertical lines
  for (let x = 0; x <= width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellSize, 0);
    ctx.lineTo(x * cellSize, height * cellSize);
    ctx.stroke();
  }

  // Horizontal lines
  for (let y = 0; y <= height; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellSize);
    ctx.lineTo(width * cellSize, y * cellSize);
    ctx.stroke();
  }
}

// Generate the realistic stitch preview
export function generateStitchPreview(
  options: StitchPreviewOptions
): HTMLCanvasElement {
  const { grid, cellSize, stitchType, showGrid, canvasColor = "#f5f0e6" } = options;

  const height = grid.length;
  const width = grid[0]?.length || 0;

  const canvas = document.createElement("canvas");
  canvas.width = width * cellSize;
  canvas.height = height * cellSize;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Fill background with canvas/mesh color
  ctx.fillStyle = canvasColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw grid first (underneath stitches)
  if (showGrid) {
    drawCanvasGrid(ctx, width, height, cellSize, darkenColor(canvasColor, 0.15));
  }

  // Draw stitches
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const dmcNumber = grid[row]?.[col];
      if (!dmcNumber) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      const x = col * cellSize;
      const y = row * cellSize;

      if (stitchType === "continental") {
        drawContinentalStitch(ctx, x, y, cellSize, color.hex, row, col);
      } else {
        drawBasketweaveStitch(ctx, x, y, cellSize, color.hex, row, col);
      }
    }
  }

  return canvas;
}

// Export as data URL
export function generateStitchPreviewDataUrl(
  options: StitchPreviewOptions,
  format: "png" | "jpeg" = "png"
): string {
  const canvas = generateStitchPreview(options);
  return canvas.toDataURL(`image/${format}`, format === "jpeg" ? 0.9 : undefined);
}

// =============================================================================
// CANVAS PREVIEW (Before Stitching) - Shows printed canvas look
// =============================================================================

// Desaturate a color by a percentage (makes it look like printed ink on canvas)
function desaturateColor(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;

  // Calculate grayscale (luminance)
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  // Blend toward gray by the percentage
  const newR = Math.round(r + (gray - r) * percent);
  const newG = Math.round(g + (gray - g) * percent);
  const newB = Math.round(b + (gray - b) * percent);

  return `rgb(${newR}, ${newG}, ${newB})`;
}

// Draw the canvas mesh texture (background with thread pattern)
function drawCanvasMeshTexture(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize: number,
  canvasColor: string
) {
  const canvasWidth = width * cellSize;
  const canvasHeight = height * cellSize;

  // Fill base canvas color
  ctx.fillStyle = canvasColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw horizontal canvas threads (slightly darker than background)
  const threadColor = darkenColor(canvasColor, 0.06);
  const threadWidth = Math.max(1, cellSize * 0.08);

  ctx.fillStyle = threadColor;
  for (let y = 0; y <= height; y++) {
    ctx.fillRect(0, y * cellSize - threadWidth / 2, canvasWidth, threadWidth);
  }

  // Draw vertical canvas threads
  for (let x = 0; x <= width; x++) {
    ctx.fillRect(x * cellSize - threadWidth / 2, 0, threadWidth, canvasHeight);
  }

  // Draw intersection points (the holes in the canvas mesh)
  const holeColor = darkenColor(canvasColor, 0.12);
  const holeRadius = Math.max(1, cellSize * 0.06);

  ctx.fillStyle = holeColor;
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x <= width; x++) {
      ctx.beginPath();
      ctx.arc(x * cellSize, y * cellSize, holeRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Draw a single printed color cell (looks like paint/ink on canvas)
function drawPrintedCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  hex: string
) {
  // Desaturate slightly to look like printed canvas (ink absorbs into canvas)
  const printedColor = desaturateColor(hex, 0.12);

  // Small padding to let canvas mesh show through at edges
  const padding = cellSize * 0.04;

  ctx.fillStyle = printedColor;
  ctx.fillRect(
    x * cellSize + padding,
    y * cellSize + padding,
    cellSize - padding * 2,
    cellSize - padding * 2
  );

  // Add subtle texture variation to simulate print quality
  ctx.fillStyle = darkenColor(hex, 0.03);
  ctx.globalAlpha = 0.3;
  ctx.fillRect(
    x * cellSize + padding,
    y * cellSize + cellSize * 0.6,
    cellSize - padding * 2,
    cellSize * 0.35
  );
  ctx.globalAlpha = 1;
}

// Generate the canvas preview (before stitching - printed canvas look)
export function generateCanvasPreview(
  options: CanvasPreviewOptions
): HTMLCanvasElement {
  const { grid, cellSize, canvasColor = "#f5f0e6", showMesh = true } = options;

  const height = grid.length;
  const width = grid[0]?.length || 0;

  const canvas = document.createElement("canvas");
  canvas.width = width * cellSize;
  canvas.height = height * cellSize;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Draw canvas mesh texture first
  if (showMesh) {
    drawCanvasMeshTexture(ctx, width, height, cellSize, canvasColor);
  } else {
    // Just fill with plain canvas color
    ctx.fillStyle = canvasColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw printed colors
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const dmcNumber = grid[row]?.[col];
      if (!dmcNumber) continue;

      const color = getDmcColorByNumber(dmcNumber);
      if (!color) continue;

      drawPrintedCell(ctx, col, row, cellSize, color.hex);
    }
  }

  // Redraw mesh lines on top of printed colors for realism
  if (showMesh) {
    const threadColor = darkenColor(canvasColor, 0.08);
    const threadWidth = Math.max(0.5, cellSize * 0.04);

    ctx.strokeStyle = threadColor;
    ctx.lineWidth = threadWidth;

    // Draw grid lines on top
    for (let x = 0; x <= width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellSize, 0);
      ctx.lineTo(x * cellSize, height * cellSize);
      ctx.stroke();
    }

    for (let y = 0; y <= height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellSize);
      ctx.lineTo(width * cellSize, y * cellSize);
      ctx.stroke();
    }
  }

  return canvas;
}

// Export canvas preview as data URL
export function generateCanvasPreviewDataUrl(
  options: CanvasPreviewOptions,
  format: "png" | "jpeg" = "png"
): string {
  const canvas = generateCanvasPreview(options);
  return canvas.toDataURL(`image/${format}`, format === "jpeg" ? 0.9 : undefined);
}

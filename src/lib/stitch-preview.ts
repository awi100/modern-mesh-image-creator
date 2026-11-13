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

// Parse hex color to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const num = parseInt(hex.slice(1), 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

// RGB to hex
function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Lighten a color by a percentage.
//
// Blends toward white, so it flattens out at the white end the same way the
// multiply below flattens at the black end: at the 0.35 highlight BLANC
// #FCFCFC gains 1 level of 255 and B5200 #FDFDFF gains 1 on R and G and none
// on B, which is already at 255. That is left alone on
// purpose. A near-white stitch still reads as a tube because its SHADOW half is
// intact (BLANC's 0.30 shadow is #B0B0B0), and the only way to manufacture a
// highlight above #FCFCFC would be to draw the crown darker than the body,
// which reads as a groove rather than a round thread. Near-black had the
// opposite problem and no compensating half, which is what darkenColor fixes.
function lightenColor(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const newR = Math.min(255, Math.round(r + (255 - r) * percent));
  const newG = Math.min(255, Math.round(g + (255 - g) * percent));
  const newB = Math.min(255, Math.round(b + (255 - b) * percent));
  return rgbToHex(newR, newG, newB);
}

// The smallest shade step worth drawing, per 1.0 of `percent`: 14 levels of 255
// at the 0.30 stitch edge, 7 at the 0.15 mid-shadow. Below about 10 levels the
// strand edges stop being visible against the strand body at preview zoom.
const MIN_SHADE_PER_PERCENT = 48;

// Darken a color by a percentage.
//
// Multiplying channels is right for a mid colour but has nothing left to take
// at the dark end, and the stitch gradient is three strands whose edges are
// drawn with this: 310 Black at #000000 returned #000000 for every percent, so
// a black stitch lost both shadow stops and the three strands rendered as one
// flat black lozenge — the one colour in the palette that did not read as
// stitching. 310 is back at #000000 and staying there (its hex seeds the saved
// print overrides; see dmc-pearl-cotton.ts), so the fix belongs here.
//
// Multiplying is kept wherever it already moves the colour by at least the
// minimum step, which is 464 of the 480 palette entries — everything above
// L*21.6 renders exactly as it did. The 15 very dark entries below that (939,
// 823, 938, 820, 898, 3371, 814 …) take the step as a flat subtraction
// instead, and because each channel is capped at whatever the multiply gave,
// those shades can only come out darker than before, never lighter: the one
// thing a shadow stop must never do is drift toward the body colour.
//
// Where even subtraction has no room — #000000 itself — the shade is LIFTED by
// the step instead. Real black thread has no darker-than-black side either;
// what makes it read is that the crown catches light and the edges do not, so
// drawing the edge a few levels off the core is the only way to put that
// distinction on screen. 310's stops go #0E0E0E / #070707 / #000000 / #2E2E2E
// / #595959, which is a tube again instead of a flat lozenge.
function darkenColor(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const step = Math.round(MIN_SHADE_PER_PERCENT * percent);
  // Perceived brightness, same weights as desaturateColor below. It is linear
  // in the channels, so `lum * percent` IS the drop the multiply would give.
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const scaled = [r, g, b].map(v => Math.round(v * (1 - percent)));

  if (lum * percent >= step) {
    return rgbToHex(scaled[0], scaled[1], scaled[2]);
  }

  if (lum >= step) {
    const dropped = [r, g, b].map((v, i) => Math.max(0, Math.min(scaled[i], v - step)));
    return rgbToHex(dropped[0], dropped[1], dropped[2]);
  }

  const lifted = [r, g, b].map(v => Math.min(255, v + step));
  return rgbToHex(lifted[0], lifted[1], lifted[2]);
}

// Desaturate a color
function desaturateColor(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const newR = Math.round(r + (gray - r) * percent);
  const newG = Math.round(g + (gray - g) * percent);
  const newB = Math.round(b + (gray - b) * percent);
  return rgbToHex(newR, newG, newB);
}

// Draw a realistic continental stitch with twisted thread texture
function drawRealisticStitch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  hex: string,
  isAscending: boolean = true
) {
  const padding = cellSize * 0.06;
  const threadWidth = cellSize * 0.42;

  // Start and end points for the diagonal stitch
  let x1: number, y1: number, x2: number, y2: number;

  if (isAscending) {
    // Bottom-left to top-right
    x1 = x + padding;
    y1 = y + cellSize - padding;
    x2 = x + cellSize - padding;
    y2 = y + padding;
  } else {
    // Top-left to bottom-right
    x1 = x + padding;
    y1 = y + padding;
    x2 = x + cellSize - padding;
    y2 = y + cellSize - padding;
  }

  // Calculate the angle and perpendicular for thread width
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const perpAngle = angle + Math.PI / 2;

  // Create colors for the twisted thread effect
  const baseColor = hex;
  const highlightColor = lightenColor(hex, 0.35);
  const shadowColor = darkenColor(hex, 0.30);
  const midHighlight = lightenColor(hex, 0.18);
  const midShadow = darkenColor(hex, 0.15);

  // Draw multiple strands to simulate twisted pearl cotton thread
  const numStrands = 3;
  const strandWidth = threadWidth / numStrands;

  for (let i = 0; i < numStrands; i++) {
    // Offset each strand slightly perpendicular to the stitch direction
    const strandOffset = (i - (numStrands - 1) / 2) * strandWidth * 0.7;
    const offsetX = Math.cos(perpAngle) * strandOffset;
    const offsetY = Math.sin(perpAngle) * strandOffset;

    // Create gradient along the thread for 3D roundness
    const gradient = ctx.createLinearGradient(
      x1 + offsetX - Math.cos(perpAngle) * strandWidth,
      y1 + offsetY - Math.sin(perpAngle) * strandWidth,
      x1 + offsetX + Math.cos(perpAngle) * strandWidth,
      y1 + offsetY + Math.sin(perpAngle) * strandWidth
    );

    // Pearl cotton has a subtle sheen - create rounded appearance
    gradient.addColorStop(0, shadowColor);
    gradient.addColorStop(0.2, midShadow);
    gradient.addColorStop(0.4, baseColor);
    gradient.addColorStop(0.55, midHighlight);
    gradient.addColorStop(0.7, highlightColor);
    gradient.addColorStop(0.85, midHighlight);
    gradient.addColorStop(1, baseColor);

    ctx.beginPath();
    ctx.moveTo(x1 + offsetX, y1 + offsetY);
    ctx.lineTo(x2 + offsetX, y2 + offsetY);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = strandWidth * 1.1;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Add subtle twist marks along the thread
  const stitchLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const numTwists = Math.max(2, Math.floor(stitchLength / (cellSize * 0.25)));

  ctx.strokeStyle = `rgba(255, 255, 255, 0.12)`;
  ctx.lineWidth = 1;

  for (let t = 1; t < numTwists; t++) {
    const progress = t / numTwists;
    const px = x1 + (x2 - x1) * progress;
    const py = y1 + (y2 - y1) * progress;

    // Small highlight mark perpendicular to thread
    const markLength = threadWidth * 0.3;
    ctx.beginPath();
    ctx.moveTo(
      px - Math.cos(perpAngle) * markLength,
      py - Math.sin(perpAngle) * markLength
    );
    ctx.lineTo(
      px + Math.cos(perpAngle) * markLength * 0.5,
      py + Math.sin(perpAngle) * markLength * 0.5
    );
    ctx.stroke();
  }

  // Add shadow underneath the stitch for depth
  ctx.strokeStyle = `rgba(0, 0, 0, 0.15)`;
  ctx.lineWidth = threadWidth * 0.15;
  ctx.beginPath();
  ctx.moveTo(x1 + 1, y1 + 1);
  ctx.lineTo(x2 + 1, y2 + 1);
  ctx.stroke();
}

// Draw realistic canvas mesh texture.
//
// `threadsAtCenter` controls where the woven threads sit relative to the grid:
//   false → threads run along the grid lines (cell edges). Used for the printed
//           canvas preview, where each cell is a painted block.
//   true  → thread intersections sit at the CENTER of each cell, with the needle
//           holes at the cell corners. This matches how a tent stitch is actually
//           worked: the diagonal passes over one thread intersection, anchored in
//           the two diagonally-adjacent holes.
function drawRealisticCanvasMesh(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  cellSize: number,
  canvasColor: string,
  threadsAtCenter: boolean = false
) {
  const { r, g, b } = hexToRgb(canvasColor);

  // Fill base with slightly varied canvas color for texture
  ctx.fillStyle = canvasColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Add subtle noise/texture to canvas background
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 8;
    data[i] = Math.max(0, Math.min(255, r + noise));
    data[i + 1] = Math.max(0, Math.min(255, g + noise));
    data[i + 2] = Math.max(0, Math.min(255, b + noise));
  }
  ctx.putImageData(imageData, 0, 0);

  // Draw woven canvas threads
  const threadWidth = Math.max(1.5, cellSize * 0.12);
  const threadColor = darkenColor(canvasColor, 0.08);
  const threadHighlight = lightenColor(canvasColor, 0.05);
  const threadShadow = darkenColor(canvasColor, 0.15);

  const cols = Math.round(canvasWidth / cellSize);
  const rows = Math.round(canvasHeight / cellSize);
  // When threads run through cell centers there is one thread per cell (offset
  // by half a cell); along the grid lines there is one more line than cells.
  const offset = threadsAtCenter ? 0.5 : 0;
  const rowLines = threadsAtCenter ? rows : rows + 1;
  const colLines = threadsAtCenter ? cols : cols + 1;

  // Horizontal threads (weft)
  for (let row = 0; row < rowLines; row++) {
    const y = (row + offset) * cellSize;

    // Thread shadow
    ctx.fillStyle = threadShadow;
    ctx.fillRect(0, y - threadWidth / 2 + 1, canvasWidth, threadWidth);

    // Thread body
    ctx.fillStyle = threadColor;
    ctx.fillRect(0, y - threadWidth / 2, canvasWidth, threadWidth * 0.8);

    // Thread highlight
    ctx.fillStyle = threadHighlight;
    ctx.fillRect(0, y - threadWidth / 2, canvasWidth, threadWidth * 0.3);
  }

  // Vertical threads (warp) - drawn on top to create weave
  for (let col = 0; col < colLines; col++) {
    const x = (col + offset) * cellSize;

    // Thread shadow
    ctx.fillStyle = threadShadow;
    ctx.fillRect(x - threadWidth / 2 + 1, 0, threadWidth, canvasHeight);

    // Thread body
    ctx.fillStyle = threadColor;
    ctx.fillRect(x - threadWidth / 2, 0, threadWidth * 0.8, canvasHeight);

    // Thread highlight
    ctx.fillStyle = threadHighlight;
    ctx.fillRect(x - threadWidth / 2, 0, threadWidth * 0.3, canvasHeight);
  }

  // Draw needle holes. When intersections sit at cell centers the holes are at
  // the cell corners (the openings between four threads); otherwise they fall on
  // the grid crossings.
  const holeRadius = Math.max(1, cellSize * 0.08);
  const holeColor = darkenColor(canvasColor, 0.20);

  ctx.fillStyle = holeColor;
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const x = col * cellSize;
      const y = row * cellSize;

      ctx.beginPath();
      ctx.arc(x, y, holeRadius, 0, Math.PI * 2);
      ctx.fill();
    }
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

  // Draw realistic canvas mesh as background. Intersections sit at cell centers
  // so each diagonal tent stitch passes over one intersection (true needlepoint),
  // rather than across the open middle of a mesh square.
  drawRealisticCanvasMesh(ctx, canvas.width, canvas.height, cellSize, canvasColor, true);

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
        drawRealisticStitch(ctx, x, y, cellSize, color.hex, true);
      } else {
        // Basketweave alternates direction
        const isAscending = (row + col) % 2 === 0;
        drawRealisticStitch(ctx, x, y, cellSize, color.hex, isAscending);
      }
    }
  }

  // Optional: Add subtle grid overlay to help see stitch boundaries
  if (showGrid) {
    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    ctx.lineWidth = 0.5;

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

// Export as data URL
export function generateStitchPreviewDataUrl(
  options: StitchPreviewOptions,
  format: "png" | "jpeg" = "png"
): string {
  const canvas = generateStitchPreview(options);
  return canvas.toDataURL(`image/${format}`, format === "jpeg" ? 0.92 : undefined);
}

// =============================================================================
// CANVAS PREVIEW (Before Stitching) - Shows printed canvas look
// =============================================================================

// Draw a printed color cell that looks like ink/paint on canvas
function drawPrintedCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  hex: string,
  canvasColor: string
) {
  // Desaturate and slightly lighten to look like printed canvas
  const printedColor = desaturateColor(hex, 0.15);
  const fadedColor = lightenColor(printedColor, 0.08);

  // Small padding to show canvas mesh at edges
  const padding = cellSize * 0.03;

  // Fill with base printed color
  ctx.fillStyle = fadedColor;
  ctx.fillRect(
    x * cellSize + padding,
    y * cellSize + padding,
    cellSize - padding * 2,
    cellSize - padding * 2
  );

  // Add texture variation to simulate print on fabric
  const { r, g, b } = hexToRgb(fadedColor);

  // Create subtle mottled effect (ink absorption varies on canvas)
  for (let i = 0; i < 3; i++) {
    const spotX = x * cellSize + padding + Math.random() * (cellSize - padding * 2);
    const spotY = y * cellSize + padding + Math.random() * (cellSize - padding * 2);
    const spotRadius = cellSize * (0.1 + Math.random() * 0.15);

    const variation = (Math.random() - 0.5) * 15;
    ctx.fillStyle = rgbToHex(
      Math.max(0, Math.min(255, r + variation)),
      Math.max(0, Math.min(255, g + variation)),
      Math.max(0, Math.min(255, b + variation))
    );
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(spotX, spotY, spotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Subtle shadow at bottom/right edge (print has slight thickness)
  ctx.fillStyle = darkenColor(hex, 0.12);
  ctx.globalAlpha = 0.4;
  ctx.fillRect(
    x * cellSize + padding,
    y * cellSize + cellSize - padding - cellSize * 0.08,
    cellSize - padding * 2,
    cellSize * 0.08
  );
  ctx.fillRect(
    x * cellSize + cellSize - padding - cellSize * 0.06,
    y * cellSize + padding,
    cellSize * 0.06,
    cellSize - padding * 2
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
    drawRealisticCanvasMesh(ctx, canvas.width, canvas.height, cellSize, canvasColor);
  } else {
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

      drawPrintedCell(ctx, col, row, cellSize, color.hex, canvasColor);
    }
  }

  // Redraw mesh lines on top for realism (threads go over the paint)
  if (showMesh) {
    const threadWidth = Math.max(0.8, cellSize * 0.06);
    const threadColor = darkenColor(canvasColor, 0.12);

    ctx.strokeStyle = threadColor;
    ctx.lineWidth = threadWidth;
    ctx.globalAlpha = 0.6;

    // Vertical threads
    for (let x = 0; x <= width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellSize, 0);
      ctx.lineTo(x * cellSize, height * cellSize);
      ctx.stroke();
    }

    // Horizontal threads
    for (let y = 0; y <= height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellSize);
      ctx.lineTo(width * cellSize, y * cellSize);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  return canvas;
}

// Export canvas preview as data URL
export function generateCanvasPreviewDataUrl(
  options: CanvasPreviewOptions,
  format: "png" | "jpeg" = "png"
): string {
  const canvas = generateCanvasPreview(options);
  return canvas.toDataURL(`image/${format}`, format === "jpeg" ? 0.92 : undefined);
}

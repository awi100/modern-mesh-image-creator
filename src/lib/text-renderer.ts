// Text to pixel grid rendering for needlepoint designs

export interface TextRenderOptions {
  text: string;
  fontFamily: string;
  heightInStitches: number;
  bold?: boolean;
  italic?: boolean;
  letterSpacing?: number; // Extra pixels between characters (can be negative)
}

export interface BorderOptions {
  enabled: boolean;
  width: number; // Border thickness in stitches
  padding: number; // Space between text and border
}

export interface RenderedText {
  pixels: (string | null)[][];
  width: number;
  height: number;
}

// Available fonts optimized for pixel rendering
export const TEXT_FONTS = [
  { id: "sans", name: "Sans Serif", family: "Arial, Helvetica, sans-serif", isCursive: false },
  { id: "serif", name: "Serif", family: "Georgia, Times New Roman, serif", isCursive: false },
  { id: "mono", name: "Monospace", family: "Courier New, monospace", isCursive: false },
  { id: "block", name: "Block", family: "Impact, Arial Black, sans-serif", isCursive: false },
  { id: "script", name: "Script", family: "Brush Script MT, cursive", isCursive: true },
  { id: "rounded", name: "Rounded", family: "Verdana, Geneva, sans-serif", isCursive: false },
  { id: "narrow", name: "Narrow", family: "Arial Narrow, sans-serif", isCursive: false },
  { id: "classic", name: "Classic", family: "Palatino Linotype, Book Antiqua, serif", isCursive: false },
  { id: "handwritten", name: "Handwritten", family: "Comic Sans MS, cursive", isCursive: true },
  { id: "stencil", name: "Stencil", family: "Stencil, fantasy", isCursive: false },
];

// Letters that should be horizontally symmetric
const SYMMETRIC_LETTERS = new Set([
  'A', 'H', 'I', 'M', 'O', 'T', 'U', 'V', 'W', 'X', 'Y',
  'i', 'l', 'o', 'v', 'w', 'x',
  '0', '1', '8',
]);

/**
 * Enforces horizontal symmetry on a pixel grid
 * For each row, if one side has a filled pixel and the mirror position doesn't, fill both
 */
function enforceSymmetry(pixels: (string | null)[][]): (string | null)[][] {
  if (pixels.length === 0 || pixels[0].length === 0) {
    return pixels;
  }

  const height = pixels.length;
  const width = pixels[0].length;
  const result: (string | null)[][] = pixels.map(row => [...row]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < Math.ceil(width / 2); x++) {
      const mirrorX = width - 1 - x;
      const leftPixel = result[y][x];
      const rightPixel = result[y][mirrorX];

      // If either side has a pixel, fill both sides
      if (leftPixel !== null || rightPixel !== null) {
        const fillColor = leftPixel || rightPixel;
        result[y][x] = fillColor;
        result[y][mirrorX] = fillColor;
      }
    }
  }

  return result;
}

/**
 * Renders a single character to a pixel grid
 */
function renderSingleChar(
  char: string,
  fontFamily: string,
  heightInStitches: number,
  bold: boolean,
  italic: boolean,
  dmcNumber: string
): RenderedText {
  if (char === ' ') {
    // Return empty space with approximate width
    const spaceWidth = Math.max(2, Math.floor(heightInStitches / 3));
    const pixels: (string | null)[][] = [];
    for (let y = 0; y < heightInStitches; y++) {
      pixels[y] = new Array(spaceWidth).fill(null);
    }
    return { pixels, width: spaceWidth, height: heightInStitches };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return { pixels: [], width: 0, height: 0 };
  }

  const fontStyle = `${italic ? "italic " : ""}${bold ? "bold " : ""}`;
  const baseSize = 200;
  ctx.font = `${fontStyle}${baseSize}px ${fontFamily}`;

  const metrics = ctx.measureText(char);
  const charWidth = metrics.width;
  const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

  if (textHeight === 0 || charWidth === 0) {
    return { pixels: [], width: 0, height: 0 };
  }

  const scale = heightInStitches / textHeight;
  const finalWidth = Math.ceil(charWidth * scale) + 2; // Add small buffer
  const finalHeight = heightInStitches;

  canvas.width = finalWidth;
  canvas.height = finalHeight;

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, finalWidth, finalHeight);

  const scaledFontSize = baseSize * scale;
  ctx.font = `${fontStyle}${scaledFontSize}px ${fontFamily}`;
  ctx.fillStyle = "black";
  ctx.textBaseline = "top";

  const scaledMetrics = ctx.measureText(char);
  const yOffset = (finalHeight - (scaledMetrics.actualBoundingBoxAscent + scaledMetrics.actualBoundingBoxDescent)) / 2;

  ctx.fillText(char, 1, yOffset); // Small offset from left edge

  const imageData = ctx.getImageData(0, 0, finalWidth, finalHeight);
  const pixels: (string | null)[][] = [];

  for (let y = 0; y < finalHeight; y++) {
    pixels[y] = [];
    for (let x = 0; x < finalWidth; x++) {
      const i = (y * finalWidth + x) * 4;
      const brightness = (imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3;
      pixels[y][x] = brightness < 200 ? dmcNumber : null;
    }
  }

  return trimPixels(pixels);
}

/**
 * Renders text to a pixel grid suitable for needlepoint
 * @param options - Text rendering options
 * @param dmcNumber - The DMC color number to use for filled pixels (e.g., "310", "blanc")
 */
export function renderTextToPixels(
  options: TextRenderOptions,
  dmcNumber: string
): RenderedText {
  const { text, fontFamily, heightInStitches, bold = false, italic = false, letterSpacing = 0 } = options;

  if (!text.trim()) {
    return { pixels: [], width: 0, height: 0 };
  }

  // Check if this is a cursive font (skip symmetry for cursive)
  const fontConfig = TEXT_FONTS.find(f => f.family === fontFamily);
  const isCursive = fontConfig?.isCursive ?? false;

  // Render each character separately
  const charResults: RenderedText[] = [];

  for (const char of text) {
    let charResult = renderSingleChar(char, fontFamily, heightInStitches, bold, italic, dmcNumber);

    // Apply symmetry to symmetric letters (unless cursive font)
    if (!isCursive && SYMMETRIC_LETTERS.has(char) && charResult.pixels.length > 0) {
      charResult = {
        ...charResult,
        pixels: enforceSymmetry(charResult.pixels),
      };
    }

    charResults.push(charResult);
  }

  // Calculate total width with spacing
  const spacing = Math.round(letterSpacing * heightInStitches / 10);
  let totalWidth = 0;
  for (let i = 0; i < charResults.length; i++) {
    totalWidth += charResults[i].width;
    if (i < charResults.length - 1) {
      totalWidth += spacing;
    }
  }

  if (totalWidth === 0) {
    return { pixels: [], width: 0, height: 0 };
  }

  // Find the maximum height among all characters
  const maxHeight = Math.max(...charResults.map(r => r.height), 1);

  // Combine all characters into final grid
  const finalPixels: (string | null)[][] = [];
  for (let y = 0; y < maxHeight; y++) {
    finalPixels[y] = new Array(totalWidth).fill(null);
  }

  let xOffset = 0;
  for (let i = 0; i < charResults.length; i++) {
    const charResult = charResults[i];
    // Center character vertically
    const yOffset = Math.floor((maxHeight - charResult.height) / 2);

    for (let y = 0; y < charResult.height; y++) {
      for (let x = 0; x < charResult.width; x++) {
        const pixel = charResult.pixels[y]?.[x];
        if (pixel !== null && yOffset + y < maxHeight) {
          finalPixels[yOffset + y][xOffset + x] = pixel;
        }
      }
    }

    xOffset += charResult.width;
    if (i < charResults.length - 1) {
      xOffset += spacing;
    }
  }

  // Trim empty rows and columns
  return trimPixels(finalPixels);
}

/**
 * Removes empty rows and columns from edges of pixel grid
 */
function trimPixels(pixels: (string | null)[][]): RenderedText {
  if (pixels.length === 0) {
    return { pixels: [], width: 0, height: 0 };
  }

  let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;

  // Find bounds of non-null pixels
  for (let y = 0; y < pixels.length; y++) {
    for (let x = 0; x < pixels[y].length; x++) {
      if (pixels[y][x] !== null) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  // If no pixels found, return empty
  if (maxX === -1) {
    return { pixels: [], width: 0, height: 0 };
  }

  // Extract trimmed region
  const trimmed: (string | null)[][] = [];
  for (let y = minY; y <= maxY; y++) {
    trimmed.push(pixels[y].slice(minX, maxX + 1));
  }

  return {
    pixels: trimmed,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Adds a border around rendered text
 * @param rendered - The rendered text to add border to
 * @param borderOptions - Border configuration
 * @param dmcNumber - The DMC color number for the border (e.g., "310", "blanc")
 * @param borderDmcNumber - Optional different DMC color for border (defaults to same as text)
 */
export function addBorder(
  rendered: RenderedText,
  borderOptions: BorderOptions,
  dmcNumber: string,
  borderDmcNumber?: string
): RenderedText {
  if (!borderOptions.enabled || rendered.width === 0) {
    return rendered;
  }

  const { width: borderWidth, padding } = borderOptions;
  const effectiveBorderColor = borderDmcNumber || dmcNumber;

  // Calculate new dimensions
  const totalPadding = padding + borderWidth;
  const newWidth = rendered.width + totalPadding * 2;
  const newHeight = rendered.height + totalPadding * 2;

  // Create new pixel array
  const pixels: (string | null)[][] = [];

  for (let y = 0; y < newHeight; y++) {
    pixels[y] = [];
    for (let x = 0; x < newWidth; x++) {
      // Check if this is a border pixel
      const isTopBorder = y < borderWidth;
      const isBottomBorder = y >= newHeight - borderWidth;
      const isLeftBorder = x < borderWidth;
      const isRightBorder = x >= newWidth - borderWidth;

      if (isTopBorder || isBottomBorder || isLeftBorder || isRightBorder) {
        pixels[y][x] = effectiveBorderColor;
      } else {
        // Map to original pixel position
        const origX = x - totalPadding;
        const origY = y - totalPadding;

        if (
          origX >= 0 &&
          origX < rendered.width &&
          origY >= 0 &&
          origY < rendered.height
        ) {
          pixels[y][x] = rendered.pixels[origY][origX];
        } else {
          pixels[y][x] = null;
        }
      }
    }
  }

  return { pixels, width: newWidth, height: newHeight };
}

/**
 * Creates a simple preview canvas element from pixels
 */
export function createPreviewCanvas(
  rendered: RenderedText,
  cellSize: number = 4,
  bgColor: string = "#1e293b"
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = rendered.width * cellSize;
  canvas.height = rendered.height * cellSize;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Fill background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw pixels
  for (let y = 0; y < rendered.height; y++) {
    for (let x = 0; x < rendered.width; x++) {
      const color = rendered.pixels[y]?.[x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }

  return canvas;
}

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
  { id: "sans", name: "Sans Serif", family: "Arial, Helvetica, sans-serif" },
  { id: "serif", name: "Serif", family: "Georgia, Times New Roman, serif" },
  { id: "mono", name: "Monospace", family: "Courier New, monospace" },
  { id: "block", name: "Block", family: "Impact, Arial Black, sans-serif" },
  { id: "script", name: "Script", family: "Brush Script MT, cursive" },
  { id: "rounded", name: "Rounded", family: "Verdana, Geneva, sans-serif" },
  { id: "narrow", name: "Narrow", family: "Arial Narrow, sans-serif" },
  { id: "classic", name: "Classic", family: "Palatino Linotype, Book Antiqua, serif" },
  { id: "handwritten", name: "Handwritten", family: "Comic Sans MS, cursive" },
  { id: "stencil", name: "Stencil", family: "Stencil, fantasy" },
];

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

  // Create offscreen canvas for text measurement and rendering
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return { pixels: [], width: 0, height: 0 };
  }

  // Build font string
  const fontStyle = `${italic ? "italic " : ""}${bold ? "bold " : ""}`;

  // Use a large base size for measurement accuracy
  const baseSize = 200;
  ctx.font = `${fontStyle}${baseSize}px ${fontFamily}`;

  // Measure text at base size (character by character for spacing)
  let textWidth = 0;
  for (let i = 0; i < text.length; i++) {
    textWidth += ctx.measureText(text[i]).width;
    if (i < text.length - 1) {
      textWidth += letterSpacing * baseSize / 10; // Scale spacing relative to font size
    }
  }
  const metrics = ctx.measureText(text);
  const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

  if (textHeight === 0) {
    return { pixels: [], width: 0, height: 0 };
  }

  // Calculate scale to achieve desired stitch height
  const scale = heightInStitches / textHeight;
  const finalWidth = Math.ceil(textWidth * scale);
  const finalHeight = heightInStitches;

  // Set canvas to final pixel dimensions
  canvas.width = finalWidth;
  canvas.height = finalHeight;

  // Clear and set up context
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, finalWidth, finalHeight);

  // Calculate scaled font size
  const scaledFontSize = baseSize * scale;
  ctx.font = `${fontStyle}${scaledFontSize}px ${fontFamily}`;
  ctx.fillStyle = "black";
  ctx.textBaseline = "top";

  // Calculate vertical offset to center text
  const scaledMetrics = ctx.measureText(text);
  const yOffset = (finalHeight - (scaledMetrics.actualBoundingBoxAscent + scaledMetrics.actualBoundingBoxDescent)) / 2;

  // Render text character by character with spacing
  let xPos = 0;
  const scaledSpacing = letterSpacing * scaledFontSize / 10;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], xPos, yOffset);
    xPos += ctx.measureText(text[i]).width + (i < text.length - 1 ? scaledSpacing : 0);
  }

  // Sample pixels from canvas
  const imageData = ctx.getImageData(0, 0, finalWidth, finalHeight);
  const pixels: (string | null)[][] = [];

  for (let y = 0; y < finalHeight; y++) {
    pixels[y] = [];
    for (let x = 0; x < finalWidth; x++) {
      const i = (y * finalWidth + x) * 4;
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];

      // Convert to grayscale and threshold
      const brightness = (r + g + b) / 3;
      // Threshold at 200 (mostly white = empty, darker = filled)
      pixels[y][x] = brightness < 200 ? dmcNumber : null;
    }
  }

  // Trim empty rows and columns
  return trimPixels(pixels);
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

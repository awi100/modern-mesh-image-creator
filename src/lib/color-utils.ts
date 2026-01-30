// Color utilities for image processing and pixel manipulation

import { DmcColor, findNearestDmcColor, findNearestFromSubset, rgbToLab, deltaE76, isNearWhite } from "./dmc-pearl-cotton";

export type PixelGrid = (string | null)[][]; // DMC number or null for empty

// K-means clustering for color quantization
export function kMeansCluster(
  colors: { r: number; g: number; b: number }[],
  k: number,
  maxIterations: number = 20
): { r: number; g: number; b: number }[] {
  if (colors.length === 0 || k <= 0) return [];
  if (colors.length <= k) return colors;

  // Initialize centroids randomly
  const shuffled = [...colors].sort(() => Math.random() - 0.5);
  let centroids = shuffled.slice(0, k).map(c => ({ ...c }));

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each color to nearest centroid
    const clusters: { r: number; g: number; b: number }[][] = Array.from({ length: k }, () => []);

    for (const color of colors) {
      let minDist = Infinity;
      let nearestIdx = 0;

      for (let i = 0; i < centroids.length; i++) {
        const dist = Math.sqrt(
          Math.pow(color.r - centroids[i].r, 2) +
          Math.pow(color.g - centroids[i].g, 2) +
          Math.pow(color.b - centroids[i].b, 2)
        );
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = i;
        }
      }

      clusters[nearestIdx].push(color);
    }

    // Update centroids
    const newCentroids = clusters.map((cluster, i) => {
      if (cluster.length === 0) return centroids[i];
      return {
        r: Math.round(cluster.reduce((sum, c) => sum + c.r, 0) / cluster.length),
        g: Math.round(cluster.reduce((sum, c) => sum + c.g, 0) / cluster.length),
        b: Math.round(cluster.reduce((sum, c) => sum + c.b, 0) / cluster.length),
      };
    });

    // Check for convergence
    const converged = centroids.every((c, i) =>
      c.r === newCentroids[i].r && c.g === newCentroids[i].g && c.b === newCentroids[i].b
    );

    centroids = newCentroids;
    if (converged) break;
  }

  return centroids;
}

// Process image data to pixel grid
export function processImageToGrid(
  imageData: ImageData,
  gridWidth: number,
  gridHeight: number,
  maxColors: number = 16,
  dmcSubset?: DmcColor[],
  treatWhiteAsEmpty: boolean = false,
  whiteThreshold: number = 250
): { grid: PixelGrid; usedColors: DmcColor[] } {
  const { data, width, height } = imageData;

  // Sample colors from image
  const cellWidth = width / gridWidth;
  const cellHeight = height / gridHeight;
  const sampledColors: { r: number; g: number; b: number }[] = [];

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const centerX = Math.floor((gx + 0.5) * cellWidth);
      const centerY = Math.floor((gy + 0.5) * cellHeight);
      const idx = (centerY * width + centerX) * 4;

      // Skip transparent pixels
      if (data[idx + 3] < 128) continue;

      // Skip near-white pixels if treating white as empty
      if (treatWhiteAsEmpty && isNearWhite(data[idx], data[idx + 1], data[idx + 2], whiteThreshold)) continue;

      sampledColors.push({
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
      });
    }
  }

  // Quantize colors using K-means
  const quantizedCentroids = kMeansCluster(sampledColors, maxColors);

  // Map centroids to DMC colors
  const dmcCentroids = quantizedCentroids.map(c =>
    dmcSubset ? findNearestFromSubset(c.r, c.g, c.b, dmcSubset) : findNearestDmcColor(c.r, c.g, c.b)
  );

  // Remove duplicates
  const uniqueDmcColors = Array.from(
    new Map(dmcCentroids.map(c => [c.dmcNumber, c])).values()
  );

  // Create pixel grid
  const grid: PixelGrid = [];

  for (let gy = 0; gy < gridHeight; gy++) {
    const row: (string | null)[] = [];

    for (let gx = 0; gx < gridWidth; gx++) {
      const centerX = Math.floor((gx + 0.5) * cellWidth);
      const centerY = Math.floor((gy + 0.5) * cellHeight);
      const idx = (centerY * width + centerX) * 4;

      // Transparent = empty cell
      if (data[idx + 3] < 128) {
        row.push(null);
        continue;
      }

      const pixelColor = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };

      // Near-white = empty cell (if option enabled)
      if (treatWhiteAsEmpty && isNearWhite(pixelColor.r, pixelColor.g, pixelColor.b, whiteThreshold)) {
        row.push(null);
        continue;
      }

      // Find nearest DMC color from our limited palette
      const nearestDmc = findNearestFromSubset(pixelColor.r, pixelColor.g, pixelColor.b, uniqueDmcColors);
      row.push(nearestDmc.dmcNumber);
    }

    grid.push(row);
  }

  return { grid, usedColors: uniqueDmcColors };
}

// Reduce colors in existing grid
export function reduceColors(
  grid: PixelGrid,
  currentColors: DmcColor[],
  targetCount: number
): { grid: PixelGrid; usedColors: DmcColor[] } {
  if (currentColors.length <= targetCount) {
    return { grid, usedColors: currentColors };
  }

  // Use K-means to find the best subset
  const rgbColors = currentColors.map(c => c.rgb);
  const centroids = kMeansCluster(rgbColors, targetCount);

  // Map centroids to DMC colors
  const newDmcColors = centroids.map(c => findNearestDmcColor(c.r, c.g, c.b));

  // Remove duplicates
  const uniqueNewColors = Array.from(
    new Map(newDmcColors.map(c => [c.dmcNumber, c])).values()
  );

  // Remap grid
  const newGrid: PixelGrid = grid.map(row =>
    row.map(cell => {
      if (cell === null) return null;

      const oldColor = currentColors.find(c => c.dmcNumber === cell);
      if (!oldColor) return cell;

      const nearest = findNearestFromSubset(oldColor.rgb.r, oldColor.rgb.g, oldColor.rgb.b, uniqueNewColors);
      return nearest.dmcNumber;
    })
  );

  return { grid: newGrid, usedColors: uniqueNewColors };
}

// Flood fill algorithm
export function floodFill(
  grid: PixelGrid,
  startX: number,
  startY: number,
  newColor: string | null
): PixelGrid {
  const height = grid.length;
  const width = grid[0]?.length || 0;

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return grid;
  }

  const targetColor = grid[startY][startX];

  // Don't fill if same color
  if (targetColor === newColor) return grid;

  const newGrid = grid.map(row => [...row]);
  const stack: [number, number][] = [[startX, startY]];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;

    if (visited.has(key)) continue;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (newGrid[y][x] !== targetColor) continue;

    visited.add(key);
    newGrid[y][x] = newColor;

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return newGrid;
}

// Replace all instances of a color
export function replaceColor(
  grid: PixelGrid,
  oldColor: string | null,
  newColor: string | null
): PixelGrid {
  return grid.map(row =>
    row.map(cell => (cell === oldColor ? newColor : cell))
  );
}

// Get selection bounds
export function getSelectionBounds(selection: boolean[][]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasSelection = false;

  for (let y = 0; y < selection.length; y++) {
    for (let x = 0; x < selection[y].length; x++) {
      if (selection[y][x]) {
        hasSelection = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return hasSelection ? { minX, minY, maxX, maxY } : null;
}

// Copy selection to clipboard format
export function copySelection(
  grid: PixelGrid,
  selection: boolean[][]
): { data: PixelGrid; width: number; height: number } | null {
  const bounds = getSelectionBounds(selection);
  if (!bounds) return null;

  const { minX, minY, maxX, maxY } = bounds;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  const data: PixelGrid = [];

  for (let y = minY; y <= maxY; y++) {
    const row: (string | null)[] = [];
    for (let x = minX; x <= maxX; x++) {
      row.push(selection[y][x] ? grid[y][x] : null);
    }
    data.push(row);
  }

  return { data, width, height };
}

// Paste clipboard data
export function pasteData(
  grid: PixelGrid,
  clipboard: { data: PixelGrid; width: number; height: number },
  targetX: number,
  targetY: number
): PixelGrid {
  const newGrid = grid.map(row => [...row]);
  const gridHeight = newGrid.length;
  const gridWidth = newGrid[0]?.length || 0;

  for (let y = 0; y < clipboard.height; y++) {
    for (let x = 0; x < clipboard.width; x++) {
      const targetPosX = targetX + x;
      const targetPosY = targetY + y;

      if (targetPosX >= 0 && targetPosX < gridWidth && targetPosY >= 0 && targetPosY < gridHeight) {
        const value = clipboard.data[y][x];
        if (value !== null) {
          newGrid[targetPosY][targetPosX] = value;
        }
      }
    }
  }

  return newGrid;
}

// Scale pixel grid using nearest neighbor
export function scalePixelGrid(
  grid: PixelGrid,
  newWidth: number,
  newHeight: number
): PixelGrid {
  const oldHeight = grid.length;
  const oldWidth = grid[0]?.length || 0;

  if (oldWidth === 0 || oldHeight === 0) {
    return Array.from({ length: newHeight }, () => Array(newWidth).fill(null));
  }

  const newGrid: PixelGrid = [];

  for (let y = 0; y < newHeight; y++) {
    const row: (string | null)[] = [];
    const srcY = Math.floor((y / newHeight) * oldHeight);

    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.floor((x / newWidth) * oldWidth);
      row.push(grid[srcY]?.[srcX] ?? null);
    }

    newGrid.push(row);
  }

  return newGrid;
}

// Mirror grid horizontally
export function mirrorHorizontal(grid: PixelGrid): PixelGrid {
  return grid.map(row => [...row].reverse());
}

// Mirror grid vertically
export function mirrorVertical(grid: PixelGrid): PixelGrid {
  return [...grid].reverse().map(row => [...row]);
}

// Rotate grid 90 degrees clockwise
export function rotate90Clockwise(grid: PixelGrid): PixelGrid {
  const height = grid.length;
  const width = grid[0]?.length || 0;

  const newGrid: PixelGrid = [];

  for (let x = 0; x < width; x++) {
    const row: (string | null)[] = [];
    for (let y = height - 1; y >= 0; y--) {
      row.push(grid[y][x]);
    }
    newGrid.push(row);
  }

  return newGrid;
}

// Rotate grid 90 degrees counter-clockwise
export function rotate90CounterClockwise(grid: PixelGrid): PixelGrid {
  const height = grid.length;
  const width = grid[0]?.length || 0;

  const newGrid: PixelGrid = [];

  for (let x = width - 1; x >= 0; x--) {
    const row: (string | null)[] = [];
    for (let y = 0; y < height; y++) {
      row.push(grid[y][x]);
    }
    newGrid.push(row);
  }

  return newGrid;
}

// Get unique colors used in grid
export function getUsedColors(grid: PixelGrid): string[] {
  const colors = new Set<string>();

  for (const row of grid) {
    for (const cell of row) {
      if (cell !== null) {
        colors.add(cell);
      }
    }
  }

  return Array.from(colors);
}

// Count stitches per color
export function countStitchesByColor(grid: PixelGrid): Map<string, number> {
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

// Create empty grid
export function createEmptyGrid(width: number, height: number): PixelGrid {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

// Check if a point is inside a selection
export function isPointInSelection(
  x: number,
  y: number,
  selection: boolean[][] | null
): boolean {
  if (!selection) return false;
  return selection[y]?.[x] === true;
}

// Move selection by offset
export function moveSelectionByOffset(
  selection: boolean[][],
  offsetX: number,
  offsetY: number,
  gridWidth: number,
  gridHeight: number
): boolean[][] {
  const newSelection = Array.from({ length: gridHeight }, () =>
    Array(gridWidth).fill(false)
  );

  for (let y = 0; y < selection.length; y++) {
    for (let x = 0; x < selection[y].length; x++) {
      if (selection[y][x]) {
        const newX = x + offsetX;
        const newY = y + offsetY;
        if (newX >= 0 && newX < gridWidth && newY >= 0 && newY < gridHeight) {
          newSelection[newY][newX] = true;
        }
      }
    }
  }

  return newSelection;
}

// Move pixels by offset (based on selection)
export function movePixelsByOffset(
  grid: PixelGrid,
  selection: boolean[][],
  offsetX: number,
  offsetY: number
): PixelGrid {
  const newGrid = grid.map(row => [...row]);
  const movedPixels: { x: number; y: number; color: string | null }[] = [];

  // Collect pixels to move and clear originals
  for (let y = 0; y < selection.length; y++) {
    for (let x = 0; x < selection[y].length; x++) {
      if (selection[y][x]) {
        movedPixels.push({ x, y, color: grid[y][x] });
        newGrid[y][x] = null; // Clear original
      }
    }
  }

  // Place at new positions
  const gridHeight = newGrid.length;
  const gridWidth = newGrid[0]?.length || 0;

  for (const { x, y, color } of movedPixels) {
    const newX = x + offsetX;
    const newY = y + offsetY;
    if (newX >= 0 && newX < gridWidth && newY >= 0 && newY < gridHeight) {
      newGrid[newY][newX] = color;
    }
  }

  return newGrid;
}

// Layer interface for composite function
interface Layer {
  grid: PixelGrid;
  visible: boolean;
  opacity: number;
}

// Composite all visible layers into a single grid
// Renders from bottom (index 0) to top, respecting visibility and opacity
export function compositeLayers(
  layers: Layer[],
  gridWidth: number,
  gridHeight: number
): PixelGrid {
  const result: PixelGrid = createEmptyGrid(gridWidth, gridHeight);

  // Render layers from bottom to top
  for (const layer of layers) {
    if (!layer.visible) continue;

    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const pixel = layer.grid[y]?.[x];
        // For pixel art, we simply overlay non-null pixels
        // Opacity is handled during canvas rendering, not here
        // (since we're storing DMC color codes, not actual colors)
        if (pixel !== null) {
          result[y][x] = pixel;
        }
      }
    }
  }

  return result;
}

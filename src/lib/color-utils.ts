// Color utilities for image processing and pixel manipulation

import { DmcColor, findNearestDmcColor, findNearestFromSubset, rgbToLab, labToRgb, deltaE76, isNearWhite } from "./dmc-pearl-cotton";

export type PixelGrid = (string | null)[][]; // DMC number or null for empty

// Processing options interface for advanced image conversion
export interface ProcessingOptions {
  maxColors?: number;
  dmcSubset?: DmcColor[];
  treatWhiteAsEmpty?: boolean;
  whiteThreshold?: number;
  // New options
  colorSpace?: 'rgb' | 'lab';
  kmeansInit?: 'random' | 'kmeans++';
  samplingMethod?: 'center' | 'weighted';
  dithering?: 'none' | 'floydSteinberg';
  ditheringStrength?: number;
  contrastEnhance?: number;
  sharpen?: number;
}

// Default processing options
const DEFAULT_OPTIONS: ProcessingOptions = {
  maxColors: 16,
  treatWhiteAsEmpty: false,
  whiteThreshold: 250,
  colorSpace: 'lab',
  kmeansInit: 'kmeans++',
  samplingMethod: 'weighted',
  dithering: 'none',
  ditheringStrength: 50,
  contrastEnhance: 0,
  sharpen: 0,
};

// Seeded random number generator for reproducibility
function seededRandom(seed: number): () => number {
  return function() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Weighted color with frequency and Lab values
interface WeightedColor {
  rgb: { r: number; g: number; b: number };
  lab: { l: number; a: number; b: number };
  weight: number;
}

// K-Means++ initialization - picks centroids that are spread apart
function kMeansPlusPlusInit(
  colors: WeightedColor[],
  k: number,
  rng: () => number = Math.random
): WeightedColor[] {
  if (colors.length === 0 || k <= 0) return [];
  if (colors.length <= k) return colors.slice();

  const centroids: WeightedColor[] = [];

  // First centroid: weighted random selection
  const totalWeight = colors.reduce((sum, c) => sum + c.weight, 0);
  let r = rng() * totalWeight;
  for (const color of colors) {
    r -= color.weight;
    if (r <= 0) {
      centroids.push({ ...color });
      break;
    }
  }
  if (centroids.length === 0) centroids.push({ ...colors[0] });

  // Subsequent centroids: probability proportional to D^2
  while (centroids.length < k) {
    const distances = colors.map(c => {
      const minDist = Math.min(...centroids.map(cent => deltaE76(c.lab, cent.lab)));
      return minDist * minDist * c.weight;
    });

    const totalDist = distances.reduce((sum, d) => sum + d, 0);
    if (totalDist === 0) break;

    let pick = rng() * totalDist;
    for (let i = 0; i < colors.length; i++) {
      pick -= distances[i];
      if (pick <= 0) {
        centroids.push({ ...colors[i] });
        break;
      }
    }
  }

  return centroids;
}

// Improved K-Means using Lab color space for perceptual accuracy
export function kMeansClusterLab(
  colors: WeightedColor[],
  k: number,
  options: { maxIterations?: number; seed?: number } = {}
): { r: number; g: number; b: number }[] {
  const { maxIterations = 30, seed } = options;
  const rng = seed !== undefined ? seededRandom(seed) : Math.random;

  if (colors.length === 0 || k <= 0) return [];
  if (colors.length <= k) return colors.map(c => c.rgb);

  // Initialize with K-Means++
  let centroids = kMeansPlusPlusInit(colors, k, rng);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign colors to nearest centroid using Lab distance
    const clusters: WeightedColor[][] = Array.from({ length: k }, () => []);

    for (const color of colors) {
      let minDist = Infinity;
      let nearestIdx = 0;

      for (let i = 0; i < centroids.length; i++) {
        const dist = deltaE76(color.lab, centroids[i].lab);
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = i;
        }
      }

      clusters[nearestIdx].push(color);
    }

    // Update centroids (weighted average in Lab space)
    let converged = true;
    const newCentroids = clusters.map((cluster, i) => {
      if (cluster.length === 0) return centroids[i];

      const totalWeight = cluster.reduce((sum, c) => sum + c.weight, 0);
      const avgL = cluster.reduce((sum, c) => sum + c.lab.l * c.weight, 0) / totalWeight;
      const avgA = cluster.reduce((sum, c) => sum + c.lab.a * c.weight, 0) / totalWeight;
      const avgB = cluster.reduce((sum, c) => sum + c.lab.b * c.weight, 0) / totalWeight;

      const rgb = labToRgb(avgL, avgA, avgB);
      const lab = { l: avgL, a: avgA, b: avgB };

      // Check convergence (deltaE < 1 is imperceptible)
      if (deltaE76(lab, centroids[i].lab) > 1) {
        converged = false;
      }

      return { rgb, lab, weight: totalWeight };
    });

    centroids = newCentroids;
    if (converged) break;
  }

  return centroids.map(c => c.rgb);
}

// Legacy K-means clustering for backward compatibility (RGB, random init)
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

// Gaussian-weighted sampling - center pixels contribute more
function sampleCellWeighted(
  data: Uint8ClampedArray,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { r: number; g: number; b: number; a: number } | null {
  const cellW = x2 - x1;
  const cellH = y2 - y1;
  if (cellW <= 0 || cellH <= 0) return null;

  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  const sigma = Math.min(cellW, cellH) / 3;
  const sigma2 = 2 * sigma * sigma;

  let totalWeight = 0;
  let r = 0, g = 0, b = 0, a = 0;
  let validPixels = 0;

  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 128) continue; // Skip transparent

      const dx = x - centerX;
      const dy = y - centerY;
      const weight = Math.exp(-(dx * dx + dy * dy) / sigma2);

      r += data[idx] * weight;
      g += data[idx + 1] * weight;
      b += data[idx + 2] * weight;
      a += data[idx + 3] * weight;
      totalWeight += weight;
      validPixels++;
    }
  }

  if (validPixels === 0 || totalWeight === 0) return null;

  return {
    r: Math.round(r / totalWeight),
    g: Math.round(g / totalWeight),
    b: Math.round(b / totalWeight),
    a: Math.round(a / totalWeight),
  };
}

// Simple center-point sampling (legacy)
function sampleCellCenter(
  data: Uint8ClampedArray,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { r: number; g: number; b: number; a: number } | null {
  const centerX = Math.floor((x1 + x2) / 2);
  const centerY = Math.floor((y1 + y2) / 2);
  const idx = (centerY * width + centerX) * 4;

  if (data[idx + 3] < 128) return null;

  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2],
    a: data[idx + 3],
  };
}

// Apply contrast enhancement via histogram stretching
function enhanceContrast(imageData: ImageData, strength: number): ImageData {
  if (strength <= 0) return imageData;

  const data = new Uint8ClampedArray(imageData.data);
  const factor = 1 + (strength / 50); // 0-100 maps to 1-3

  // Find min/max for luminance
  let minL = 255, maxL = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    minL = Math.min(minL, lum);
    maxL = Math.max(maxL, lum);
  }

  const rangeL = maxL - minL || 1;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;

    // Apply contrast per channel relative to mid-gray
    for (let c = 0; c < 3; c++) {
      const normalized = (data[i + c] - minL) / rangeL;
      const contrasted = (normalized - 0.5) * factor + 0.5;
      data[i + c] = Math.max(0, Math.min(255, Math.round(contrasted * 255)));
    }
  }

  return new ImageData(data, imageData.width, imageData.height);
}

// Apply unsharp mask for sharpening
function applySharpen(imageData: ImageData, strength: number): ImageData {
  if (strength <= 0) return imageData;

  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(data);
  const amount = strength / 100;

  // Simple 3x3 sharpen kernel
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] < 128) continue;

      for (let c = 0; c < 3; c++) {
        const center = data[idx + c];
        const neighbors =
          data[((y - 1) * width + x) * 4 + c] +
          data[((y + 1) * width + x) * 4 + c] +
          data[(y * width + x - 1) * 4 + c] +
          data[(y * width + x + 1) * 4 + c];

        const laplacian = center * 4 - neighbors;
        const sharpened = center + laplacian * amount;
        result[idx + c] = Math.max(0, Math.min(255, Math.round(sharpened)));
      }
    }
  }

  return new ImageData(result, width, height);
}

// Preprocess image with contrast and sharpening
function preprocessImage(imageData: ImageData, options: ProcessingOptions): ImageData {
  let result = imageData;

  if (options.contrastEnhance && options.contrastEnhance > 0) {
    result = enhanceContrast(result, options.contrastEnhance);
  }

  if (options.sharpen && options.sharpen > 0) {
    result = applySharpen(result, options.sharpen);
  }

  return result;
}

// Floyd-Steinberg dithering
function applyFloydSteinbergDithering(
  grid: PixelGrid,
  originalColors: ({ r: number; g: number; b: number } | null)[][],
  palette: DmcColor[],
  strength: number
): PixelGrid {
  const height = grid.length;
  const width = grid[0]?.length || 0;
  if (height === 0 || width === 0) return grid;

  // Create float buffer for error diffusion
  const buffer: { r: number; g: number; b: number }[][] = originalColors.map(row =>
    row.map(c => (c ? { ...c } : { r: 0, g: 0, b: 0 }))
  );

  const result: PixelGrid = Array.from({ length: height }, () => Array(width).fill(null));
  const strengthFactor = strength / 100;

  for (let y = 0; y < height; y++) {
    // Serpentine scanning
    const leftToRight = y % 2 === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      if (originalColors[y][x] === null) {
        result[y][x] = null;
        continue;
      }

      const current = buffer[y][x];

      // Find nearest palette color
      const nearest = findNearestFromSubset(
        Math.max(0, Math.min(255, Math.round(current.r))),
        Math.max(0, Math.min(255, Math.round(current.g))),
        Math.max(0, Math.min(255, Math.round(current.b))),
        palette
      );

      result[y][x] = nearest.dmcNumber;

      // Calculate and diffuse error
      const error = {
        r: (current.r - nearest.rgb.r) * strengthFactor,
        g: (current.g - nearest.rgb.g) * strengthFactor,
        b: (current.b - nearest.rgb.b) * strengthFactor,
      };

      // Floyd-Steinberg pattern:    X   7/16
      //                         3/16 5/16 1/16
      const diffuse = (dx: number, dy: number, factor: number) => {
        const nx = x + dx * xStep;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && originalColors[ny][nx] !== null) {
          buffer[ny][nx].r += error.r * factor;
          buffer[ny][nx].g += error.g * factor;
          buffer[ny][nx].b += error.b * factor;
        }
      };

      diffuse(1, 0, 7 / 16);
      diffuse(-1, 1, 3 / 16);
      diffuse(0, 1, 5 / 16);
      diffuse(1, 1, 1 / 16);
    }
  }

  return result;
}

// Advanced image processing with new options
function processImageToGridAdvanced(
  imageData: ImageData,
  gridWidth: number,
  gridHeight: number,
  options: ProcessingOptions
): { grid: PixelGrid; usedColors: DmcColor[] } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { data, width, height } = imageData;

  // Apply preprocessing if enabled
  let processedData = imageData;
  if ((opts.contrastEnhance && opts.contrastEnhance > 0) || (opts.sharpen && opts.sharpen > 0)) {
    processedData = preprocessImage(imageData, opts);
  }
  const pData = processedData.data;

  // Calculate scaling to preserve aspect ratio
  const imageAspect = width / height;
  const canvasAspect = gridWidth / gridHeight;

  let scaledWidth: number;
  let scaledHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (imageAspect > canvasAspect) {
    scaledWidth = gridWidth;
    scaledHeight = Math.round(gridWidth / imageAspect);
    offsetX = 0;
    offsetY = Math.floor((gridHeight - scaledHeight) / 2);
  } else {
    scaledHeight = gridHeight;
    scaledWidth = Math.round(gridHeight * imageAspect);
    offsetX = Math.floor((gridWidth - scaledWidth) / 2);
    offsetY = 0;
  }

  const cellWidth = width / scaledWidth;
  const cellHeight = height / scaledHeight;

  // Sample colors using selected method
  const colorCounts = new Map<string, { rgb: { r: number; g: number; b: number }; count: number }>();

  for (let gy = 0; gy < scaledHeight; gy++) {
    for (let gx = 0; gx < scaledWidth; gx++) {
      const x1 = Math.floor(gx * cellWidth);
      const y1 = Math.floor(gy * cellHeight);
      const x2 = Math.floor((gx + 1) * cellWidth);
      const y2 = Math.floor((gy + 1) * cellHeight);

      let sample: { r: number; g: number; b: number; a: number } | null;

      if (opts.samplingMethod === 'weighted') {
        sample = sampleCellWeighted(pData, width, x1, y1, x2, y2);
      } else {
        sample = sampleCellCenter(pData, width, x1, y1, x2, y2);
      }

      if (!sample) continue;
      if (opts.treatWhiteAsEmpty && isNearWhite(sample.r, sample.g, sample.b, opts.whiteThreshold || 250)) continue;

      // Quantize to reduce unique colors for counting
      const qr = Math.floor(sample.r / 8) * 8;
      const qg = Math.floor(sample.g / 8) * 8;
      const qb = Math.floor(sample.b / 8) * 8;
      const key = `${qr},${qg},${qb}`;

      const existing = colorCounts.get(key);
      if (existing) {
        existing.count++;
        // Running average
        existing.rgb.r = Math.round((existing.rgb.r * (existing.count - 1) + sample.r) / existing.count);
        existing.rgb.g = Math.round((existing.rgb.g * (existing.count - 1) + sample.g) / existing.count);
        existing.rgb.b = Math.round((existing.rgb.b * (existing.count - 1) + sample.b) / existing.count);
      } else {
        colorCounts.set(key, { rgb: { r: sample.r, g: sample.g, b: sample.b }, count: 1 });
      }
    }
  }

  // Convert to weighted colors for clustering
  const weightedColors: WeightedColor[] = Array.from(colorCounts.values()).map(({ rgb, count }) => ({
    rgb,
    lab: rgbToLab(rgb.r, rgb.g, rgb.b),
    weight: count,
  }));

  // Quantize using selected algorithm
  let quantizedCentroids: { r: number; g: number; b: number }[];
  const maxColors = opts.maxColors || 16;

  if (opts.colorSpace === 'lab' && opts.kmeansInit === 'kmeans++') {
    quantizedCentroids = kMeansClusterLab(weightedColors, maxColors);
  } else {
    // Legacy RGB clustering
    const flatColors = weightedColors.flatMap(wc =>
      Array(Math.min(wc.weight, 10)).fill(wc.rgb) // Cap weight to prevent memory issues
    );
    quantizedCentroids = kMeansCluster(flatColors, maxColors);
  }

  // Map centroids to DMC colors
  const dmcCentroids = quantizedCentroids.map(c =>
    opts.dmcSubset ? findNearestFromSubset(c.r, c.g, c.b, opts.dmcSubset) : findNearestDmcColor(c.r, c.g, c.b)
  );

  // Remove duplicates
  const uniqueDmcColors = Array.from(
    new Map(dmcCentroids.map(c => [c.dmcNumber, c])).values()
  );

  // Create pixel grid and store original colors for dithering
  const grid: PixelGrid = [];
  const originalColors: ({ r: number; g: number; b: number } | null)[][] = [];

  for (let gy = 0; gy < gridHeight; gy++) {
    const row: (string | null)[] = [];
    const colorRow: ({ r: number; g: number; b: number } | null)[] = [];

    for (let gx = 0; gx < gridWidth; gx++) {
      const imgX = gx - offsetX;
      const imgY = gy - offsetY;

      if (imgX < 0 || imgX >= scaledWidth || imgY < 0 || imgY >= scaledHeight) {
        row.push(null);
        colorRow.push(null);
        continue;
      }

      const x1 = Math.floor(imgX * cellWidth);
      const y1 = Math.floor(imgY * cellHeight);
      const x2 = Math.floor((imgX + 1) * cellWidth);
      const y2 = Math.floor((imgY + 1) * cellHeight);

      let sample: { r: number; g: number; b: number; a: number } | null;

      if (opts.samplingMethod === 'weighted') {
        sample = sampleCellWeighted(pData, width, x1, y1, x2, y2);
      } else {
        sample = sampleCellCenter(pData, width, x1, y1, x2, y2);
      }

      if (!sample) {
        row.push(null);
        colorRow.push(null);
        continue;
      }

      if (opts.treatWhiteAsEmpty && isNearWhite(sample.r, sample.g, sample.b, opts.whiteThreshold || 250)) {
        row.push(null);
        colorRow.push(null);
        continue;
      }

      colorRow.push({ r: sample.r, g: sample.g, b: sample.b });

      // For non-dithered output, find nearest DMC color now
      const nearestDmc = findNearestFromSubset(sample.r, sample.g, sample.b, uniqueDmcColors);
      row.push(nearestDmc.dmcNumber);
    }

    grid.push(row);
    originalColors.push(colorRow);
  }

  // Apply dithering if enabled
  if (opts.dithering === 'floydSteinberg' && opts.ditheringStrength && opts.ditheringStrength > 0) {
    const ditheredGrid = applyFloydSteinbergDithering(
      grid,
      originalColors,
      uniqueDmcColors,
      opts.ditheringStrength
    );
    return { grid: ditheredGrid, usedColors: uniqueDmcColors };
  }

  return { grid, usedColors: uniqueDmcColors };
}

// Process image data to pixel grid (backward compatible overload)
export function processImageToGrid(
  imageData: ImageData,
  gridWidth: number,
  gridHeight: number,
  arg4?: number | ProcessingOptions,
  dmcSubset?: DmcColor[],
  treatWhiteAsEmpty: boolean = false,
  whiteThreshold: number = 250
): { grid: PixelGrid; usedColors: DmcColor[] } {
  // Check if using new options API
  if (typeof arg4 === 'object' && arg4 !== null) {
    return processImageToGridAdvanced(imageData, gridWidth, gridHeight, arg4);
  }

  // Legacy API - use legacy defaults for backward compatibility
  return processImageToGridAdvanced(imageData, gridWidth, gridHeight, {
    maxColors: arg4 || 16,
    dmcSubset,
    treatWhiteAsEmpty,
    whiteThreshold,
    // Legacy defaults - maintain old behavior
    colorSpace: 'rgb',
    kmeansInit: 'random',
    samplingMethod: 'center',
    dithering: 'none',
  });
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

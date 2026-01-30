// Pre-defined shapes for needlepoint designs

export interface Shape {
  id: string;
  name: string;
  category: string;
  // Base pixels at a reference size (will be scaled)
  basePixels: boolean[][];
}

// Helper to create a shape from a string representation
function parseShape(rows: string[]): boolean[][] {
  return rows.map(row =>
    row.split('').map(c => c === '#')
  );
}

// Heart shape (16x14)
const HEART = parseShape([
  '..##....##..',
  '.####..####.',
  '############',
  '############',
  '############',
  '############',
  '.##########.',
  '..########..',
  '...######...',
  '....####....',
  '.....##.....',
]);

// Circle shape (12x12)
const CIRCLE = parseShape([
  '...####...',
  '.########.',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '.########.',
  '...####...',
]);

// Star shape (12x11)
const STAR = parseShape([
  '.....##.....',
  '.....##.....',
  '....####....',
  '############',
  '.##########.',
  '..########..',
  '...######...',
  '..###..###..',
  '.###....###.',
  '###......###',
]);

// Diamond shape (12x12)
const DIAMOND = parseShape([
  '.....##.....',
  '....####....',
  '...######...',
  '..########..',
  '.##########.',
  '############',
  '############',
  '.##########.',
  '..########..',
  '...######...',
  '....####....',
  '.....##.....',
]);

// Rectangle (filled)
const RECTANGLE = parseShape([
  '############',
  '############',
  '############',
  '############',
  '############',
  '############',
  '############',
  '############',
]);

// Square (filled)
const SQUARE = parseShape([
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
]);

// Oval shape (16x10)
const OVAL = parseShape([
  '....########....',
  '..############..',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
  '....########....',
]);

// Triangle pointing up (12x10)
const TRIANGLE_UP = parseShape([
  '.....##.....',
  '....####....',
  '....####....',
  '...######...',
  '...######...',
  '..########..',
  '..########..',
  '.##########.',
  '.##########.',
  '############',
]);

// Triangle pointing down (12x10)
const TRIANGLE_DOWN = parseShape([
  '############',
  '.##########.',
  '.##########.',
  '..########..',
  '..########..',
  '...######...',
  '...######...',
  '....####....',
  '....####....',
  '.....##.....',
]);

// Crescent moon (12x12)
const MOON = parseShape([
  '....######..',
  '..########..',
  '.#####......',
  '####........',
  '####........',
  '###.........',
  '###.........',
  '####........',
  '####........',
  '.#####......',
  '..########..',
  '....######..',
]);

// Flower shape (12x12)
const FLOWER = parseShape([
  '...##.##....',
  '..####.####.',
  '.###....###.',
  '###..##..###',
  '##..####..##',
  '.#.######.#.',
  '.#.######.#.',
  '##..####..##',
  '###..##..###',
  '.###....###.',
  '..####.####.',
  '...##.##....',
]);

// Bow/Ribbon (14x10)
const BOW = parseShape([
  '###......###',
  '####....####',
  '.####..####.',
  '..########..',
  '....####....',
  '....####....',
  '..########..',
  '.####..####.',
  '####....####',
  '###......###',
]);

// Cross shape (10x10)
const CROSS = parseShape([
  '...####...',
  '...####...',
  '...####...',
  '##########',
  '##########',
  '##########',
  '##########',
  '...####...',
  '...####...',
  '...####...',
]);

// Arrow right (14x8)
const ARROW_RIGHT = parseShape([
  '........##....',
  '........####..',
  '##############',
  '##############',
  '##############',
  '##############',
  '........####..',
  '........##....',
]);

// Hexagon (12x10)
const HEXAGON = parseShape([
  '....####....',
  '..########..',
  '.##########.',
  '############',
  '############',
  '############',
  '############',
  '.##########.',
  '..########..',
  '....####....',
]);

export const SHAPES: Shape[] = [
  { id: 'heart', name: 'Heart', category: 'Basic', basePixels: HEART },
  { id: 'circle', name: 'Circle', category: 'Basic', basePixels: CIRCLE },
  { id: 'square', name: 'Square', category: 'Basic', basePixels: SQUARE },
  { id: 'rectangle', name: 'Rectangle', category: 'Basic', basePixels: RECTANGLE },
  { id: 'oval', name: 'Oval', category: 'Basic', basePixels: OVAL },
  { id: 'diamond', name: 'Diamond', category: 'Basic', basePixels: DIAMOND },
  { id: 'star', name: 'Star', category: 'Decorative', basePixels: STAR },
  { id: 'triangle-up', name: 'Triangle Up', category: 'Basic', basePixels: TRIANGLE_UP },
  { id: 'triangle-down', name: 'Triangle Down', category: 'Basic', basePixels: TRIANGLE_DOWN },
  { id: 'moon', name: 'Crescent Moon', category: 'Decorative', basePixels: MOON },
  { id: 'flower', name: 'Flower', category: 'Decorative', basePixels: FLOWER },
  { id: 'bow', name: 'Bow', category: 'Decorative', basePixels: BOW },
  { id: 'cross', name: 'Cross', category: 'Decorative', basePixels: CROSS },
  { id: 'arrow', name: 'Arrow', category: 'Basic', basePixels: ARROW_RIGHT },
  { id: 'hexagon', name: 'Hexagon', category: 'Basic', basePixels: HEXAGON },
];

/**
 * Scale a shape's pixels to a target size
 * Uses nearest-neighbor scaling for crisp pixel art
 */
export function scaleShape(
  basePixels: boolean[][],
  targetWidth: number,
  targetHeight: number
): boolean[][] {
  const srcHeight = basePixels.length;
  const srcWidth = basePixels[0]?.length || 0;

  if (srcWidth === 0 || srcHeight === 0) {
    return [];
  }

  const result: boolean[][] = [];

  for (let y = 0; y < targetHeight; y++) {
    const row: boolean[] = [];
    const srcY = Math.floor((y / targetHeight) * srcHeight);

    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor((x / targetWidth) * srcWidth);
      row.push(basePixels[srcY]?.[srcX] ?? false);
    }

    result.push(row);
  }

  return result;
}

/**
 * Convert boolean pixels to DMC grid
 */
export function shapeToGrid(
  pixels: boolean[][],
  dmcNumber: string
): (string | null)[][] {
  return pixels.map(row =>
    row.map(filled => filled ? dmcNumber : null)
  );
}

/**
 * Get shape aspect ratio
 */
export function getShapeAspectRatio(shape: Shape): number {
  const height = shape.basePixels.length;
  const width = shape.basePixels[0]?.length || 1;
  return width / height;
}

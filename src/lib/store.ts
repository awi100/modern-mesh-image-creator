import { create } from "zustand";
import { DmcColor, DMC_PEARL_COTTON, getDmcColorByNumber } from "./dmc-pearl-cotton";
import { PixelGrid, floodFill, replaceColor, createEmptyGrid, copySelection, pasteData, getSelectionBounds, mirrorHorizontal, mirrorVertical, rotate90Clockwise, countStitchesByColor, getUsedColors, moveSelectionByOffset, movePixelsByOffset } from "./color-utils";
import { calculateYarnUsage, YarnUsage, StitchType } from "./yarn-calculator";

export type Tool = "pencil" | "brush" | "eraser" | "fill" | "rectangle" | "select" | "magicWand" | "eyedropper" | "move";

interface HistoryEntry {
  grid: PixelGrid;
  timestamp: number;
}

interface Clipboard {
  data: PixelGrid;
  width: number;
  height: number;
}

interface EditorState {
  // Design info
  designId: string | null;
  designName: string;
  folderId: string | null;
  isDraft: boolean;
  widthInches: number;
  heightInches: number;
  meshCount: 14 | 18;
  gridWidth: number;
  gridHeight: number;

  // Pixel data
  grid: PixelGrid;

  // Tool state
  currentTool: Tool;
  currentColor: DmcColor | null;

  // Selection
  selection: boolean[][] | null;
  selectionStart: { x: number; y: number } | null;

  // Move selection state
  moveStart: { x: number; y: number } | null;
  moveOffset: { x: number; y: number } | null;

  // Clipboard
  clipboard: Clipboard | null;

  // History for undo/redo
  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;

  // Reference image
  referenceImageUrl: string | null;
  referenceImageOpacity: number;

  // View state
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  showSymbols: boolean;

  // Brush settings
  brushSize: number;
  eraserSize: number;

  // Settings
  stitchType: StitchType;
  bufferPercent: number;

  // Dirty flag
  isDirty: boolean;

  // Auto-save state
  lastSavedAt: Date | null;
  autoSaveStatus: 'idle' | 'saving' | 'saved' | 'error';

  // Actions
  setDesignInfo: (info: {
    designId?: string | null;
    designName?: string;
    folderId?: string | null;
    isDraft?: boolean;
    widthInches?: number;
    heightInches?: number;
    meshCount?: 14 | 18;
  }) => void;

  initializeGrid: (width: number, height: number, existingGrid?: PixelGrid) => void;

  setTool: (tool: Tool) => void;
  setCurrentColor: (color: DmcColor | null) => void;

  // Pixel operations
  setPixel: (x: number, y: number, color: string | null) => void;
  setBrushPixels: (x: number, y: number, color: string | null, sizeOverride?: number) => void;
  fillArea: (x: number, y: number, color: string | null) => void;
  replaceAllColor: (oldColor: string | null, newColor: string | null) => void;
  drawRectangle: (x1: number, y1: number, x2: number, y2: number, color: string | null, filled: boolean) => void;
  drawLine: (x1: number, y1: number, x2: number, y2: number, color: string | null) => void;

  // Brush settings
  setBrushSize: (size: number) => void;
  setEraserSize: (size: number) => void;

  // Selection operations
  startSelection: (x: number, y: number) => void;
  updateSelection: (x: number, y: number) => void;
  clearSelection: () => void;
  selectAll: () => void;
  selectByColor: (x: number, y: number) => void;
  copySelectionToClipboard: () => void;
  cutSelectionToClipboard: () => void;
  pasteFromClipboard: (x: number, y: number) => void;
  deleteSelection: () => void;

  // Move selection operations
  startMove: (x: number, y: number) => void;
  updateMoveOffset: (x: number, y: number) => void;
  commitMove: () => void;
  cancelMove: () => void;

  // Pixel overlay (for text placement, stamps, etc.)
  applyPixelOverlay: (pixels: (string | null)[][], x: number, y: number) => void;

  // Transform operations
  mirrorHorizontal: () => void;
  mirrorVertical: () => void;
  rotate90: (clockwise: boolean) => void;

  // History operations
  saveToHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // View operations
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;
  setShowGrid: (show: boolean) => void;
  setShowSymbols: (show: boolean) => void;

  // Reference image
  setReferenceImage: (url: string | null, opacity?: number) => void;
  setReferenceOpacity: (opacity: number) => void;

  // Settings
  setStitchType: (type: StitchType) => void;
  setBufferPercent: (percent: number) => void;

  // Computed values
  getUsedColors: () => DmcColor[];
  getStitchCounts: () => Map<string, number>;
  getYarnUsage: () => YarnUsage[];
  getTotalStitches: () => number;

  // Dirty flag
  markClean: () => void;

  // Auto-save
  setAutoSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void;
  setLastSavedAt: (date: Date | null) => void;

  // Reset
  reset: () => void;
}

const createInitialState = () => ({
  designId: null,
  designName: "Untitled Design",
  folderId: null as string | null,
  isDraft: false,
  widthInches: 8,
  heightInches: 8,
  meshCount: 14 as 14 | 18,
  gridWidth: 112,
  gridHeight: 112,
  grid: createEmptyGrid(112, 112),
  currentTool: "pencil" as Tool,
  currentColor: DMC_PEARL_COTTON[0],
  selection: null,
  selectionStart: null,
  moveStart: null,
  moveOffset: null,
  clipboard: null,
  history: [] as HistoryEntry[],
  historyIndex: -1,
  maxHistorySize: 100,
  referenceImageUrl: null,
  referenceImageOpacity: 0.5,
  zoom: 1,
  panX: 0,
  panY: 0,
  showGrid: true,
  showSymbols: true,
  brushSize: 1,
  eraserSize: 1,
  stitchType: "continental" as StitchType,
  bufferPercent: 20,
  isDirty: false,
  lastSavedAt: null,
  autoSaveStatus: 'idle' as 'idle' | 'saving' | 'saved' | 'error',
});

export const useEditorStore = create<EditorState>((set, get) => ({
  ...createInitialState(),

  setDesignInfo: (info) => {
    set((state) => {
      const updates: Partial<EditorState> = { isDirty: true };

      if (info.designId !== undefined) updates.designId = info.designId;
      if (info.designName !== undefined) updates.designName = info.designName;
      if (info.folderId !== undefined) updates.folderId = info.folderId;
      if (info.isDraft !== undefined) updates.isDraft = info.isDraft;
      if (info.widthInches !== undefined) updates.widthInches = info.widthInches;
      if (info.heightInches !== undefined) updates.heightInches = info.heightInches;
      if (info.meshCount !== undefined) updates.meshCount = info.meshCount;

      // Recalculate grid dimensions if size changed
      if (info.widthInches !== undefined || info.heightInches !== undefined || info.meshCount !== undefined) {
        const w = info.widthInches ?? state.widthInches;
        const h = info.heightInches ?? state.heightInches;
        const m = info.meshCount ?? state.meshCount;
        updates.gridWidth = Math.round(w * m);
        updates.gridHeight = Math.round(h * m);
      }

      return updates;
    });
  },

  initializeGrid: (width, height, existingGrid) => {
    const grid = existingGrid || createEmptyGrid(width, height);
    set({
      gridWidth: width,
      gridHeight: height,
      grid,
      history: [{ grid: grid.map(row => [...row]), timestamp: Date.now() }],
      historyIndex: 0,
      selection: null,
      isDirty: false,
    });
  },

  setTool: (tool) => set({ currentTool: tool }),

  setCurrentColor: (color) => set({ currentColor: color }),

  setPixel: (x, y, color) => {
    const { grid, gridWidth, gridHeight } = get();
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;

    const newGrid = grid.map(row => [...row]);
    newGrid[y][x] = color;

    set({ grid: newGrid, isDirty: true });
  },

  setBrushPixels: (x, y, color, sizeOverride?) => {
    const { grid, gridWidth, gridHeight, brushSize } = get();
    const size = sizeOverride ?? brushSize;
    const newGrid = grid.map(row => [...row]);
    const radius = Math.floor(size / 2);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < gridWidth && py >= 0 && py < gridHeight) {
          newGrid[py][px] = color;
        }
      }
    }

    set({ grid: newGrid, isDirty: true });
  },

  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(10, size)) }),

  setEraserSize: (size) => set({ eraserSize: size }),

  fillArea: (x, y, color) => {
    const { grid } = get();
    const newGrid = floodFill(grid, x, y, color);
    get().saveToHistory();
    set({ grid: newGrid, isDirty: true });
  },

  replaceAllColor: (oldColor, newColor) => {
    const { grid } = get();
    get().saveToHistory();
    const newGrid = replaceColor(grid, oldColor, newColor);
    set({ grid: newGrid, isDirty: true });
  },

  drawRectangle: (x1, y1, x2, y2, color, filled) => {
    const { grid, gridWidth, gridHeight } = get();
    get().saveToHistory();

    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(gridWidth - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(gridHeight - 1, Math.max(y1, y2));

    const newGrid = grid.map(row => [...row]);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (filled || x === minX || x === maxX || y === minY || y === maxY) {
          newGrid[y][x] = color;
        }
      }
    }

    set({ grid: newGrid, isDirty: true });
  },

  drawLine: (x1, y1, x2, y2, color) => {
    const { grid, gridWidth, gridHeight } = get();
    get().saveToHistory();

    const newGrid = grid.map(row => [...row]);

    // Bresenham's line algorithm
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;

    let x = x1;
    let y = y1;

    while (true) {
      if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
        newGrid[y][x] = color;
      }

      if (x === x2 && y === y2) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }

    set({ grid: newGrid, isDirty: true });
  },

  startSelection: (x, y) => {
    const { gridWidth, gridHeight } = get();
    const selection = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(false));
    selection[y][x] = true;
    set({ selection, selectionStart: { x, y } });
  },

  updateSelection: (x, y) => {
    const { selectionStart, gridWidth, gridHeight } = get();
    if (!selectionStart) return;

    const selection = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(false));

    const minX = Math.max(0, Math.min(selectionStart.x, x));
    const maxX = Math.min(gridWidth - 1, Math.max(selectionStart.x, x));
    const minY = Math.max(0, Math.min(selectionStart.y, y));
    const maxY = Math.min(gridHeight - 1, Math.max(selectionStart.y, y));

    for (let sy = minY; sy <= maxY; sy++) {
      for (let sx = minX; sx <= maxX; sx++) {
        selection[sy][sx] = true;
      }
    }

    set({ selection });
  },

  clearSelection: () => set({ selection: null, selectionStart: null }),

  selectAll: () => {
    const { gridWidth, gridHeight } = get();
    const selection = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(true));
    set({ selection });
  },

  selectByColor: (x, y) => {
    const { grid, gridWidth, gridHeight } = get();
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;

    const targetColor = grid[y][x];
    const selection = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(false));

    // Flood fill to select all connected pixels of same color
    const stack: [number, number][] = [[x, y]];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const key = `${cx},${cy}`;

      if (visited.has(key)) continue;
      if (cx < 0 || cx >= gridWidth || cy < 0 || cy >= gridHeight) continue;
      if (grid[cy][cx] !== targetColor) continue;

      visited.add(key);
      selection[cy][cx] = true;

      stack.push([cx + 1, cy]);
      stack.push([cx - 1, cy]);
      stack.push([cx, cy + 1]);
      stack.push([cx, cy - 1]);
    }

    set({ selection });
  },

  copySelectionToClipboard: () => {
    const { grid, selection } = get();
    if (!selection) return;

    const clipboard = copySelection(grid, selection);
    if (clipboard) {
      set({ clipboard });
    }
  },

  cutSelectionToClipboard: () => {
    const { grid, selection } = get();
    if (!selection) return;

    const clipboard = copySelection(grid, selection);
    if (clipboard) {
      get().saveToHistory();

      const newGrid = grid.map((row, y) =>
        row.map((cell, x) => (selection[y][x] ? null : cell))
      );

      set({ clipboard, grid: newGrid, isDirty: true });
    }
  },

  pasteFromClipboard: (x, y) => {
    const { grid, clipboard } = get();
    if (!clipboard) return;

    get().saveToHistory();
    const newGrid = pasteData(grid, clipboard, x, y);
    set({ grid: newGrid, isDirty: true });
  },

  applyPixelOverlay: (pixels, x, y) => {
    const { grid, gridWidth, gridHeight } = get();
    if (pixels.length === 0) return;

    get().saveToHistory();
    const newGrid = grid.map(row => [...row]);

    for (let py = 0; py < pixels.length; py++) {
      for (let px = 0; px < (pixels[py]?.length || 0); px++) {
        const color = pixels[py][px];
        if (color !== null) {
          const targetX = x + px;
          const targetY = y + py;
          if (targetX >= 0 && targetX < gridWidth && targetY >= 0 && targetY < gridHeight) {
            newGrid[targetY][targetX] = color;
          }
        }
      }
    }

    set({ grid: newGrid, isDirty: true });
  },

  deleteSelection: () => {
    const { grid, selection } = get();
    if (!selection) return;

    get().saveToHistory();

    const newGrid = grid.map((row, y) =>
      row.map((cell, x) => (selection[y][x] ? null : cell))
    );

    set({ grid: newGrid, selection: null, isDirty: true });
  },

  // Move selection operations
  startMove: (x, y) => {
    set({
      moveStart: { x, y },
      moveOffset: { x: 0, y: 0 },
    });
  },

  updateMoveOffset: (x, y) => {
    const { moveStart } = get();
    if (!moveStart) return;

    set({
      moveOffset: {
        x: x - moveStart.x,
        y: y - moveStart.y,
      },
    });
  },

  commitMove: () => {
    const { grid, selection, moveOffset, gridWidth, gridHeight } = get();
    if (!selection || !moveOffset) return;
    if (moveOffset.x === 0 && moveOffset.y === 0) {
      // No actual movement, just clear move state
      set({ moveStart: null, moveOffset: null });
      return;
    }

    get().saveToHistory();

    // Move the pixels
    const newGrid = movePixelsByOffset(grid, selection, moveOffset.x, moveOffset.y);

    // Move the selection bounds
    const newSelection = moveSelectionByOffset(
      selection,
      moveOffset.x,
      moveOffset.y,
      gridWidth,
      gridHeight
    );

    set({
      grid: newGrid,
      selection: newSelection,
      moveStart: null,
      moveOffset: null,
      isDirty: true,
    });
  },

  cancelMove: () => {
    set({
      moveStart: null,
      moveOffset: null,
    });
  },

  mirrorHorizontal: () => {
    const { grid, selection } = get();
    get().saveToHistory();

    if (selection) {
      const bounds = getSelectionBounds(selection);
      if (bounds) {
        const newGrid = grid.map(row => [...row]);
        const { minX, maxX, minY, maxY } = bounds;
        const width = maxX - minX + 1;

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const mirrorX = maxX - (x - minX);
            if (selection[y][x] && selection[y][mirrorX]) {
              const temp = newGrid[y][x];
              newGrid[y][x] = grid[y][mirrorX];
              newGrid[y][mirrorX] = temp;
            }
          }
        }

        set({ grid: newGrid, isDirty: true });
        return;
      }
    }

    set({ grid: mirrorHorizontal(grid), isDirty: true });
  },

  mirrorVertical: () => {
    const { grid, selection } = get();
    get().saveToHistory();

    if (selection) {
      const bounds = getSelectionBounds(selection);
      if (bounds) {
        const newGrid = grid.map(row => [...row]);
        const { minX, maxX, minY, maxY } = bounds;

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const mirrorY = maxY - (y - minY);
            if (selection[y][x] && selection[mirrorY]?.[x]) {
              const temp = newGrid[y][x];
              newGrid[y][x] = grid[mirrorY][x];
              newGrid[mirrorY][x] = temp;
            }
          }
        }

        set({ grid: newGrid, isDirty: true });
        return;
      }
    }

    set({ grid: mirrorVertical(grid), isDirty: true });
  },

  rotate90: (clockwise) => {
    const { grid } = get();
    get().saveToHistory();

    const newGrid = clockwise ? rotate90Clockwise(grid) : rotate90Clockwise(rotate90Clockwise(rotate90Clockwise(grid)));

    set({
      grid: newGrid,
      gridWidth: newGrid[0]?.length || 0,
      gridHeight: newGrid.length,
      isDirty: true,
    });
  },

  saveToHistory: () => {
    const { grid, history, historyIndex, maxHistorySize } = get();

    // Remove any redo entries
    const newHistory = history.slice(0, historyIndex + 1);

    // Add current state
    newHistory.push({ grid: grid.map(row => [...row]), timestamp: Date.now() });

    // Trim if too long
    while (newHistory.length > maxHistorySize) {
      newHistory.shift();
    }

    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    const entry = history[newIndex];

    set({
      grid: entry.grid.map(row => [...row]),
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    const entry = history[newIndex];

    set({
      grid: entry.grid.map(row => [...row]),
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  canUndo: () => {
    const { historyIndex } = get();
    return historyIndex > 0;
  },

  canRedo: () => {
    const { history, historyIndex } = get();
    return historyIndex < history.length - 1;
  },

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),

  setPan: (x, y) => set({ panX: x, panY: y }),

  resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),

  setShowGrid: (show) => set({ showGrid: show }),

  setShowSymbols: (show) => set({ showSymbols: show }),

  setReferenceImage: (url, opacity) => set({
    referenceImageUrl: url,
    referenceImageOpacity: opacity ?? get().referenceImageOpacity,
  }),

  setReferenceOpacity: (opacity) => set({ referenceImageOpacity: opacity }),

  setStitchType: (type) => set({ stitchType: type, isDirty: true }),

  setBufferPercent: (percent) => set({ bufferPercent: percent, isDirty: true }),

  getUsedColors: () => {
    const { grid } = get();
    const colorNumbers = getUsedColors(grid);
    return colorNumbers
      .map(num => getDmcColorByNumber(num))
      .filter((c): c is DmcColor => c !== undefined);
  },

  getStitchCounts: () => {
    const { grid } = get();
    return countStitchesByColor(grid);
  },

  getYarnUsage: () => {
    const { meshCount, stitchType, bufferPercent } = get();
    const counts = get().getStitchCounts();
    return calculateYarnUsage(counts, meshCount, stitchType, bufferPercent);
  },

  getTotalStitches: () => {
    const counts = get().getStitchCounts();
    let total = 0;
    for (const count of counts.values()) {
      total += count;
    }
    return total;
  },

  markClean: () => set({ isDirty: false }),

  setAutoSaveStatus: (status) => set({ autoSaveStatus: status }),

  setLastSavedAt: (date) => set({ lastSavedAt: date }),

  reset: () => set(createInitialState()),
}));

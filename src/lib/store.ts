import { create } from "zustand";
import { DmcColor, DMC_PEARL_COTTON, getDmcColorByNumber } from "./dmc-pearl-cotton";
import { PixelGrid, floodFill, replaceColor, createEmptyGrid, copySelection, pasteData, getSelectionBounds, mirrorHorizontal, mirrorVertical, rotate90Clockwise, countStitchesByColor, getUsedColors, moveSelectionByOffset, movePixelsByOffset, compositeLayers } from "./color-utils";
import { calculateYarnUsage, YarnUsage, StitchType } from "./yarn-calculator";

export type Tool = "pencil" | "brush" | "eraser" | "fill" | "rectangle" | "select" | "magicWand" | "eyedropper" | "move" | "pan";

// Layer interface for multi-layer support
export interface Layer {
  id: string;
  name: string;
  grid: PixelGrid;
  visible: boolean;
  opacity: number; // 0-1
  locked: boolean;
}

interface HistoryEntry {
  layers: Layer[];
  activeLayerIndex: number;
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

  // Layer data
  layers: Layer[];
  activeLayerIndex: number;

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
  centerSelection: () => void;
  selectAll: () => void;
  selectByColor: (x: number, y: number) => void;
  copySelectionToClipboard: () => void;
  cutSelectionToClipboard: () => void;
  pasteFromClipboard: (x: number, y: number) => void;
  deleteSelection: () => void;
  flipClipboardHorizontal: () => void;
  flipClipboardVertical: () => void;

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
  mirrorSelectionToOpposite: (direction: "horizontal" | "vertical") => void;

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

  // Layer management
  addLayer: () => void;
  deleteLayer: (index: number) => void;
  duplicateLayer: (index: number) => void;
  setActiveLayer: (index: number) => void;
  renameLayer: (index: number, name: string) => void;
  toggleLayerVisibility: (index: number) => void;
  setLayerOpacity: (index: number, opacity: number) => void;
  toggleLayerLock: (index: number) => void;
  moveLayerUp: (index: number) => void;
  moveLayerDown: (index: number) => void;
  reorderLayer: (fromIndex: number, toIndex: number) => void;
  mergeLayerDown: (index: number) => void;
  flattenLayers: () => PixelGrid;
  getActiveLayerGrid: () => PixelGrid;
  getCompositeGrid: () => PixelGrid;

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

// Helper to generate unique layer IDs
const generateLayerId = () => `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Helper to create a new layer
const createLayer = (name: string, width: number, height: number, existingGrid?: PixelGrid): Layer => ({
  id: generateLayerId(),
  name,
  grid: existingGrid || createEmptyGrid(width, height),
  visible: true,
  opacity: 1,
  locked: false,
});

const createInitialState = () => {
  const initialLayer = createLayer("Layer 1", 112, 112);
  return {
    designId: null,
    designName: "Untitled Design",
    folderId: null as string | null,
    isDraft: false,
    widthInches: 8,
    heightInches: 8,
    meshCount: 14 as 14 | 18,
    gridWidth: 112,
    gridHeight: 112,
    layers: [initialLayer] as Layer[],
    activeLayerIndex: 0,
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
    bufferPercent: 30,
    isDirty: false,
    lastSavedAt: null,
    autoSaveStatus: 'idle' as 'idle' | 'saving' | 'saved' | 'error',
  };
};

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
    const layer = createLayer("Layer 1", width, height, existingGrid);
    const layers = [layer];

    // Set current color to first used color in the design, if any
    let currentColor: DmcColor | null = get().currentColor;
    if (existingGrid) {
      const usedDmcNumbers = getUsedColors(existingGrid);
      if (usedDmcNumbers.length > 0) {
        const firstUsedColor = getDmcColorByNumber(usedDmcNumbers[0]);
        if (firstUsedColor) {
          currentColor = firstUsedColor;
        }
      }
    }

    set({
      gridWidth: width,
      gridHeight: height,
      layers,
      activeLayerIndex: 0,
      currentColor,
      history: [{
        layers: layers.map(l => ({ ...l, grid: l.grid.map(row => [...row]) })),
        activeLayerIndex: 0,
        timestamp: Date.now()
      }],
      historyIndex: 0,
      selection: null,
      isDirty: false,
    });
  },

  setTool: (tool) => set({ currentTool: tool }),

  setCurrentColor: (color) => set({ currentColor: color }),

  setPixel: (x, y, color) => {
    const { layers, activeLayerIndex, gridWidth, gridHeight } = get();
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    const newGrid = activeLayer.grid.map(row => [...row]);
    newGrid[y][x] = color;

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
  },

  setBrushPixels: (x, y, color, sizeOverride?) => {
    const { layers, activeLayerIndex, gridWidth, gridHeight, brushSize } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    const size = sizeOverride ?? brushSize;
    const newGrid = activeLayer.grid.map(row => [...row]);
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

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
  },

  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(10, size)) }),

  setEraserSize: (size) => set({ eraserSize: size }),

  fillArea: (x, y, color) => {
    const { layers, activeLayerIndex } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    const newGrid = floodFill(activeLayer.grid, x, y, color);
    get().saveToHistory();

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
  },

  replaceAllColor: (oldColor, newColor) => {
    const { layers, activeLayerIndex } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();
    const newGrid = replaceColor(activeLayer.grid, oldColor, newColor);

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
  },

  drawRectangle: (x1, y1, x2, y2, color, filled) => {
    const { layers, activeLayerIndex, gridWidth, gridHeight } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();

    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(gridWidth - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(gridHeight - 1, Math.max(y1, y2));

    const newGrid = activeLayer.grid.map(row => [...row]);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (filled || x === minX || x === maxX || y === minY || y === maxY) {
          newGrid[y][x] = color;
        }
      }
    }

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
  },

  drawLine: (x1, y1, x2, y2, color) => {
    const { layers, activeLayerIndex, gridWidth, gridHeight } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();

    const newGrid = activeLayer.grid.map(row => [...row]);

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

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
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

  centerSelection: () => {
    const { selection, layers, activeLayerIndex, gridWidth, gridHeight, saveToHistory } = get();
    if (!selection) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    // Find selection bounds
    const bounds = getSelectionBounds(selection);
    if (!bounds) return;

    const { minX, minY, maxX, maxY } = bounds;
    const selectionWidth = maxX - minX + 1;
    const selectionHeight = maxY - minY + 1;

    // Calculate center offset
    const targetX = Math.floor((gridWidth - selectionWidth) / 2);
    const targetY = Math.floor((gridHeight - selectionHeight) / 2);
    const offsetX = targetX - minX;
    const offsetY = targetY - minY;

    if (offsetX === 0 && offsetY === 0) return; // Already centered

    saveToHistory();

    // Move pixels
    const newGrid = movePixelsByOffset(activeLayer.grid, selection, offsetX, offsetY);

    // Move selection
    const newSelection = moveSelectionByOffset(selection, offsetX, offsetY, gridWidth, gridHeight);

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, selection: newSelection, isDirty: true });
  },

  selectAll: () => {
    const { gridWidth, gridHeight } = get();
    const selection = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(true));
    set({ selection });
  },

  selectByColor: (x, y) => {
    const { layers, activeLayerIndex, gridWidth, gridHeight } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer) return;
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;

    const grid = activeLayer.grid;
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
    const { layers, activeLayerIndex, selection } = get();
    if (!selection) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer) return;

    const clipboard = copySelection(activeLayer.grid, selection);
    if (clipboard) {
      set({ clipboard });
    }
  },

  cutSelectionToClipboard: () => {
    const { layers, activeLayerIndex, selection } = get();
    if (!selection) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    const clipboard = copySelection(activeLayer.grid, selection);
    if (clipboard) {
      get().saveToHistory();

      const newGrid = activeLayer.grid.map((row, y) =>
        row.map((cell, x) => (selection[y][x] ? null : cell))
      );

      const newLayers = [...layers];
      newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

      set({ clipboard, layers: newLayers, isDirty: true });
    }
  },

  pasteFromClipboard: (x, y) => {
    const { layers, activeLayerIndex, clipboard } = get();
    if (!clipboard) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();
    const newGrid = pasteData(activeLayer.grid, clipboard, x, y);

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
  },

  flipClipboardHorizontal: () => {
    const { clipboard } = get();
    if (!clipboard) return;

    const flippedData = clipboard.data.map(row => [...row].reverse());
    set({
      clipboard: {
        ...clipboard,
        data: flippedData,
      },
    });
  },

  flipClipboardVertical: () => {
    const { clipboard } = get();
    if (!clipboard) return;

    const flippedData = [...clipboard.data].reverse();
    set({
      clipboard: {
        ...clipboard,
        data: flippedData,
      },
    });
  },

  applyPixelOverlay: (pixels, x, y) => {
    const { layers, activeLayerIndex, gridWidth, gridHeight } = get();
    if (pixels.length === 0) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();
    const newGrid = activeLayer.grid.map(row => [...row]);

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

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
  },

  deleteSelection: () => {
    const { layers, activeLayerIndex, selection } = get();
    if (!selection) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();

    const newGrid = activeLayer.grid.map((row, y) =>
      row.map((cell, x) => (selection[y][x] ? null : cell))
    );

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, selection: null, isDirty: true });
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
    const { layers, activeLayerIndex, selection, moveOffset, gridWidth, gridHeight } = get();
    if (!selection || !moveOffset) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) {
      set({ moveStart: null, moveOffset: null });
      return;
    }

    if (moveOffset.x === 0 && moveOffset.y === 0) {
      // No actual movement, just clear move state (keep selection)
      set({ moveStart: null, moveOffset: null });
      return;
    }

    get().saveToHistory();

    // Move the pixels
    const newGrid = movePixelsByOffset(activeLayer.grid, selection, moveOffset.x, moveOffset.y);

    // Move the selection bounds to match the new pixel positions
    const newSelection = moveSelectionByOffset(
      selection,
      moveOffset.x,
      moveOffset.y,
      gridWidth,
      gridHeight
    );

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    // Keep selection after move so user can continue adjusting
    set({
      layers: newLayers,
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
    const { layers, activeLayerIndex, selection } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();

    if (selection) {
      const bounds = getSelectionBounds(selection);
      if (bounds) {
        const newGrid = activeLayer.grid.map(row => [...row]);
        const { minX, maxX, minY, maxY } = bounds;

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const mirrorX = maxX - (x - minX);
            if (selection[y][x] && selection[y][mirrorX]) {
              const temp = newGrid[y][x];
              newGrid[y][x] = activeLayer.grid[y][mirrorX];
              newGrid[y][mirrorX] = temp;
            }
          }
        }

        const newLayers = [...layers];
        newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

        set({ layers: newLayers, isDirty: true });
        return;
      }
    }

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: mirrorHorizontal(activeLayer.grid) };

    set({ layers: newLayers, isDirty: true });
  },

  mirrorVertical: () => {
    const { layers, activeLayerIndex, selection } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();

    if (selection) {
      const bounds = getSelectionBounds(selection);
      if (bounds) {
        const newGrid = activeLayer.grid.map(row => [...row]);
        const { minX, maxX, minY, maxY } = bounds;

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const mirrorY = maxY - (y - minY);
            if (selection[y][x] && selection[mirrorY]?.[x]) {
              const temp = newGrid[y][x];
              newGrid[y][x] = activeLayer.grid[mirrorY][x];
              newGrid[mirrorY][x] = temp;
            }
          }
        }

        const newLayers = [...layers];
        newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

        set({ layers: newLayers, isDirty: true });
        return;
      }
    }

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: mirrorVertical(activeLayer.grid) };

    set({ layers: newLayers, isDirty: true });
  },

  rotate90: (clockwise) => {
    const { layers, activeLayerIndex, selection, gridWidth, gridHeight } = get();
    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    get().saveToHistory();

    // If there's a selection, rotate only the selected area
    if (selection) {
      const bounds = getSelectionBounds(selection);
      if (!bounds) return;

      const { minX, minY, maxX, maxY } = bounds;
      const selWidth = maxX - minX + 1;
      const selHeight = maxY - minY + 1;

      // Extract selected pixels into a mini-grid
      const extracted: PixelGrid = [];
      for (let y = minY; y <= maxY; y++) {
        const row: (string | null)[] = [];
        for (let x = minX; x <= maxX; x++) {
          row.push(selection[y]?.[x] ? activeLayer.grid[y]?.[x] : null);
        }
        extracted.push(row);
      }

      // Rotate the extracted grid
      const rotated = clockwise
        ? rotate90Clockwise(extracted)
        : rotate90Clockwise(rotate90Clockwise(rotate90Clockwise(extracted)));

      const newSelWidth = rotated[0]?.length || 0;
      const newSelHeight = rotated.length;

      // Calculate new position to keep centered on original center
      const centerX = minX + selWidth / 2;
      const centerY = minY + selHeight / 2;
      const newMinX = Math.round(centerX - newSelWidth / 2);
      const newMinY = Math.round(centerY - newSelHeight / 2);

      // Create new grid with selected area cleared and rotated content placed
      const newGrid = activeLayer.grid.map(row => [...row]);

      // Clear original selection area
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (selection[y]?.[x]) {
            newGrid[y][x] = null;
          }
        }
      }

      // Place rotated content
      const newSelection = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(false));
      for (let y = 0; y < newSelHeight; y++) {
        for (let x = 0; x < newSelWidth; x++) {
          const targetX = newMinX + x;
          const targetY = newMinY + y;
          if (targetX >= 0 && targetX < gridWidth && targetY >= 0 && targetY < gridHeight) {
            if (rotated[y][x] !== null) {
              newGrid[targetY][targetX] = rotated[y][x];
              newSelection[targetY][targetX] = true;
            }
          }
        }
      }

      const newLayers = [...layers];
      newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

      set({ layers: newLayers, selection: newSelection, isDirty: true });
    } else {
      // No selection - rotate entire canvas (all layers)
      const newLayers = layers.map(layer => {
        const newGrid = clockwise
          ? rotate90Clockwise(layer.grid)
          : rotate90Clockwise(rotate90Clockwise(rotate90Clockwise(layer.grid)));
        return { ...layer, grid: newGrid };
      });

      set({
        layers: newLayers,
        gridWidth: newLayers[0]?.grid[0]?.length || 0,
        gridHeight: newLayers[0]?.grid.length || 0,
        isDirty: true,
      });
    }
  },

  mirrorSelectionToOpposite: (direction) => {
    const { layers, activeLayerIndex, selection, gridWidth, gridHeight } = get();
    if (!selection) return;

    const activeLayer = layers[activeLayerIndex];
    if (!activeLayer || activeLayer.locked) return;

    const bounds = getSelectionBounds(selection);
    if (!bounds) return;

    const { minX, minY, maxX, maxY } = bounds;

    get().saveToHistory();

    const newGrid = activeLayer.grid.map(row => [...row]);

    if (direction === "horizontal") {
      // Mirror selection to the opposite horizontal side
      // Calculate the center line of the canvas
      const canvasCenterX = gridWidth / 2;

      // For each selected pixel, calculate its mirrored position
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (selection[y]?.[x] && activeLayer.grid[y]?.[x]) {
            // Calculate mirror position: reflect across the canvas center
            const mirrorX = gridWidth - 1 - x;
            if (mirrorX >= 0 && mirrorX < gridWidth) {
              // Also flip the content horizontally within the selection
              const sourceX = maxX - (x - minX);
              if (selection[y]?.[sourceX]) {
                newGrid[y][mirrorX] = activeLayer.grid[y][sourceX];
              } else {
                newGrid[y][mirrorX] = activeLayer.grid[y][x];
              }
            }
          }
        }
      }
    } else {
      // Mirror selection to the opposite vertical side
      // Calculate the center line of the canvas
      const canvasCenterY = gridHeight / 2;

      // For each selected pixel, calculate its mirrored position
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (selection[y]?.[x] && activeLayer.grid[y]?.[x]) {
            // Calculate mirror position: reflect across the canvas center
            const mirrorY = gridHeight - 1 - y;
            if (mirrorY >= 0 && mirrorY < gridHeight) {
              // Also flip the content vertically within the selection
              const sourceY = maxY - (y - minY);
              if (selection[sourceY]?.[x]) {
                newGrid[mirrorY][x] = activeLayer.grid[sourceY][x];
              } else {
                newGrid[mirrorY][x] = activeLayer.grid[y][x];
              }
            }
          }
        }
      }
    }

    const newLayers = [...layers];
    newLayers[activeLayerIndex] = { ...activeLayer, grid: newGrid };

    set({ layers: newLayers, isDirty: true });
  },

  saveToHistory: () => {
    const { layers, activeLayerIndex, history, historyIndex, maxHistorySize } = get();

    // Remove any redo entries
    const newHistory = history.slice(0, historyIndex + 1);

    // Add current state (deep copy all layers)
    newHistory.push({
      layers: layers.map(l => ({ ...l, grid: l.grid.map(row => [...row]) })),
      activeLayerIndex,
      timestamp: Date.now()
    });

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
      layers: entry.layers.map(l => ({ ...l, grid: l.grid.map(row => [...row]) })),
      activeLayerIndex: entry.activeLayerIndex,
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
      layers: entry.layers.map(l => ({ ...l, grid: l.grid.map(row => [...row]) })),
      activeLayerIndex: entry.activeLayerIndex,
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

  // Layer management actions
  addLayer: () => {
    const { layers, gridWidth, gridHeight } = get();
    if (layers.length >= 10) return; // Maximum 10 layers

    get().saveToHistory();

    const newLayer = createLayer(`Layer ${layers.length + 1}`, gridWidth, gridHeight);
    const newLayers = [...layers, newLayer];

    set({
      layers: newLayers,
      activeLayerIndex: newLayers.length - 1,
      isDirty: true,
    });
  },

  deleteLayer: (index) => {
    const { layers } = get();
    if (layers.length <= 1) return; // Must have at least one layer
    if (index < 0 || index >= layers.length) return;

    get().saveToHistory();

    const newLayers = layers.filter((_, i) => i !== index);
    const newActiveIndex = Math.min(get().activeLayerIndex, newLayers.length - 1);

    set({
      layers: newLayers,
      activeLayerIndex: newActiveIndex,
      isDirty: true,
    });
  },

  duplicateLayer: (index) => {
    const { layers, gridWidth, gridHeight } = get();
    if (layers.length >= 10) return; // Maximum 10 layers
    if (index < 0 || index >= layers.length) return;

    get().saveToHistory();

    const originalLayer = layers[index];
    const duplicatedLayer: Layer = {
      id: generateLayerId(),
      name: `${originalLayer.name} copy`,
      grid: originalLayer.grid.map(row => [...row]),
      visible: originalLayer.visible,
      opacity: originalLayer.opacity,
      locked: false,
    };

    const newLayers = [...layers];
    newLayers.splice(index + 1, 0, duplicatedLayer);

    set({
      layers: newLayers,
      activeLayerIndex: index + 1,
      isDirty: true,
    });
  },

  setActiveLayer: (index) => {
    const { layers } = get();
    if (index < 0 || index >= layers.length) return;
    set({ activeLayerIndex: index });
  },

  renameLayer: (index, name) => {
    const { layers } = get();
    if (index < 0 || index >= layers.length) return;

    const newLayers = [...layers];
    newLayers[index] = { ...newLayers[index], name };

    set({ layers: newLayers, isDirty: true });
  },

  toggleLayerVisibility: (index) => {
    const { layers } = get();
    if (index < 0 || index >= layers.length) return;

    const newLayers = [...layers];
    newLayers[index] = { ...newLayers[index], visible: !newLayers[index].visible };

    set({ layers: newLayers, isDirty: true });
  },

  setLayerOpacity: (index, opacity) => {
    const { layers } = get();
    if (index < 0 || index >= layers.length) return;

    const clampedOpacity = Math.max(0, Math.min(1, opacity));
    const newLayers = [...layers];
    newLayers[index] = { ...newLayers[index], opacity: clampedOpacity };

    set({ layers: newLayers, isDirty: true });
  },

  toggleLayerLock: (index) => {
    const { layers } = get();
    if (index < 0 || index >= layers.length) return;

    const newLayers = [...layers];
    newLayers[index] = { ...newLayers[index], locked: !newLayers[index].locked };

    set({ layers: newLayers });
  },

  moveLayerUp: (index) => {
    const { layers, activeLayerIndex } = get();
    if (index <= 0 || index >= layers.length) return;

    get().saveToHistory();

    const newLayers = [...layers];
    [newLayers[index - 1], newLayers[index]] = [newLayers[index], newLayers[index - 1]];

    // Adjust active layer index if needed
    let newActiveIndex = activeLayerIndex;
    if (activeLayerIndex === index) {
      newActiveIndex = index - 1;
    } else if (activeLayerIndex === index - 1) {
      newActiveIndex = index;
    }

    set({
      layers: newLayers,
      activeLayerIndex: newActiveIndex,
      isDirty: true,
    });
  },

  moveLayerDown: (index) => {
    const { layers, activeLayerIndex } = get();
    if (index < 0 || index >= layers.length - 1) return;

    get().saveToHistory();

    const newLayers = [...layers];
    [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];

    // Adjust active layer index if needed
    let newActiveIndex = activeLayerIndex;
    if (activeLayerIndex === index) {
      newActiveIndex = index + 1;
    } else if (activeLayerIndex === index + 1) {
      newActiveIndex = index;
    }

    set({
      layers: newLayers,
      activeLayerIndex: newActiveIndex,
      isDirty: true,
    });
  },

  reorderLayer: (fromIndex, toIndex) => {
    const { layers, activeLayerIndex } = get();
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= layers.length) return;
    if (toIndex < 0 || toIndex >= layers.length) return;

    get().saveToHistory();

    const newLayers = [...layers];
    const [movedLayer] = newLayers.splice(fromIndex, 1);
    newLayers.splice(toIndex, 0, movedLayer);

    // Adjust active layer index to follow the previously active layer
    let newActiveIndex = activeLayerIndex;
    if (activeLayerIndex === fromIndex) {
      // The active layer was moved
      newActiveIndex = toIndex;
    } else if (fromIndex < activeLayerIndex && toIndex >= activeLayerIndex) {
      // Layer moved from below to above active layer
      newActiveIndex = activeLayerIndex - 1;
    } else if (fromIndex > activeLayerIndex && toIndex <= activeLayerIndex) {
      // Layer moved from above to below active layer
      newActiveIndex = activeLayerIndex + 1;
    }

    set({
      layers: newLayers,
      activeLayerIndex: newActiveIndex,
      isDirty: true,
    });
  },

  mergeLayerDown: (index) => {
    const { layers, gridWidth, gridHeight } = get();
    if (index <= 0 || index >= layers.length) return;

    const topLayer = layers[index];
    const bottomLayer = layers[index - 1];

    if (bottomLayer.locked) return;

    get().saveToHistory();

    // Merge top layer onto bottom layer
    const mergedGrid = bottomLayer.grid.map(row => [...row]);
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const topPixel = topLayer.grid[y]?.[x];
        if (topPixel !== null && topLayer.visible) {
          mergedGrid[y][x] = topPixel;
        }
      }
    }

    const newLayers = layers.filter((_, i) => i !== index);
    newLayers[index - 1] = { ...bottomLayer, grid: mergedGrid };

    const newActiveIndex = Math.min(get().activeLayerIndex, newLayers.length - 1);

    set({
      layers: newLayers,
      activeLayerIndex: newActiveIndex,
      isDirty: true,
    });
  },

  flattenLayers: () => {
    const { layers, gridWidth, gridHeight } = get();
    return compositeLayers(layers, gridWidth, gridHeight);
  },

  getActiveLayerGrid: () => {
    const { layers, activeLayerIndex } = get();
    return layers[activeLayerIndex]?.grid || createEmptyGrid(get().gridWidth, get().gridHeight);
  },

  getCompositeGrid: () => {
    const { layers, gridWidth, gridHeight } = get();
    return compositeLayers(layers, gridWidth, gridHeight);
  },

  getUsedColors: () => {
    const grid = get().getCompositeGrid();
    const colorNumbers = getUsedColors(grid);
    return colorNumbers
      .map(num => getDmcColorByNumber(num))
      .filter((c): c is DmcColor => c !== undefined);
  },

  getStitchCounts: () => {
    const grid = get().getCompositeGrid();
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

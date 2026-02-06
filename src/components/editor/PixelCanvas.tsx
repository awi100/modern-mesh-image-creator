"use client";

import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useEditorStore } from "@/lib/store";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { SYMBOLS, hexLuminance } from "@/lib/symbols";
import { isPointInSelection, getSelectionBounds } from "@/lib/color-utils";

interface PixelCanvasProps {
  pendingText?: {
    pixels: (string | null)[][];
    width: number;
    height: number;
    isShape?: boolean;
    basePixels?: boolean[][];
    dmcNumber?: string;
    scale?: number;
    placedPosition?: { x: number; y: number };
    isText?: boolean;
    textOptions?: {
      text: string;
      fontFamily: string;
      heightInStitches: number;
      bold: boolean;
      italic: boolean;
      letterSpacing: number;
      borderEnabled: boolean;
      borderWidth: number;
      borderPadding: number;
    };
    isPaste?: boolean;
  } | null;
  onTextPlaced?: (x: number, y: number) => void;
  onCancelTextPlacement?: () => void;
  onResizePendingShape?: (delta: number) => void;
  onFlipPendingHorizontal?: () => void;
  onFlipPendingVertical?: () => void;
  onConfirmShape?: () => void;
}

export default function PixelCanvas({
  pendingText,
  onTextPlaced,
  onCancelTextPlacement,
  onResizePendingShape,
  onFlipPendingHorizontal,
  onFlipPendingVertical,
  onConfirmShape,
}: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Use refs for isDrawing and lastPos to avoid React state async update issues
  // This ensures touch/mouse move events see the updated values immediately
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [textPlacementPos, setTextPlacementPos] = useState<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{
    initialDistance: number;
    initialZoom: number;
    initialPanX: number;
    initialPanY: number;
    initialMidpoint: { x: number; y: number };
    // Grid coordinate under the initial midpoint (for zoom-to-point)
    gridPointX: number;
    gridPointY: number;
  } | null>(null);

  // Pan tool: threshold for detecting pan gesture
  const PAN_THRESHOLD = 6; // pixels of screen movement before switching to pan
  const SCROLL_THRESHOLD = 12; // pixels of movement to detect scroll vs draw on touch
  const SCROLL_TIME_THRESHOLD = 150; // ms - fast movement suggests scroll
  const dragRef = useRef<{
    startScreenX: number;
    startScreenY: number;
    startGridCoords: { x: number; y: number };
    startPanX: number;
    startPanY: number;
    isPanning: boolean;
    startTime: number; // timestamp when touch/click started
  } | null>(null);

  // Touch drawing state - delayed commit to distinguish scroll from draw
  const touchDrawRef = useRef<{
    startScreenX: number;
    startScreenY: number;
    startGridCoords: { x: number; y: number };
    startTime: number;
    committed: boolean; // true once we've decided this is a draw, not scroll
  } | null>(null);

  // Move selection ref
  const moveRef = useRef<{ startX: number; startY: number } | null>(null);

  const {
    layers,
    activeLayerIndex,
    gridWidth,
    gridHeight,
    currentTool,
    currentColor,
    selection,
    zoom,
    panX,
    panY,
    showGrid,
    showSymbols,
    eraserSize,
    referenceImageUrl,
    referenceImageOpacity,
    setPixel,
    setBrushPixels,
    fillArea,
    setCurrentColor,
    startSelection,
    updateSelection,
    selectByColor,
    saveToHistory,
    setZoom,
    setPan,
    moveOffset,
    startMove,
    updateMoveOffset,
    commitMove,
    cancelMove,
  } = useEditorStore();

  const activeLayer = layers[activeLayerIndex];

  const cellSize = 20 * zoom;

  // Build a stable color → symbol map using a hash of the DMC number
  // This ensures symbols stay consistent regardless of layer/iteration order
  const colorSymbolMap = useMemo(() => {
    const map = new Map<string, string>();

    // Simple hash function for DMC number string
    const hashDmcNumber = (dmcNumber: string): number => {
      let hash = 0;
      for (let i = 0; i < dmcNumber.length; i++) {
        const char = dmcNumber.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return Math.abs(hash);
    };

    for (const layer of layers) {
      for (const row of layer.grid) {
        for (const cell of row) {
          if (cell && !map.has(cell)) {
            const symbolIndex = hashDmcNumber(cell) % SYMBOLS.length;
            map.set(cell, SYMBOLS[symbolIndex]);
          }
        }
      }
    }
    return map;
  }, [layers]);

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const width = gridWidth * cellSize;
    const height = gridHeight * cellSize;

    canvas.width = width;
    canvas.height = height;

    // Clear
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    // Draw reference image if exists
    if (referenceImageUrl) {
      const img = new Image();
      img.src = referenceImageUrl;
      if (img.complete) {
        ctx.globalAlpha = referenceImageOpacity;
        ctx.drawImage(img, 0, 0, width, height);
        ctx.globalAlpha = 1;
      }
    }

    // Draw all layers from bottom (index 0) to top
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex];
      if (!layer.visible) continue;

      ctx.globalAlpha = layer.opacity;

      // Draw pixels for this layer
      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const dmcNumber = layer.grid[y]?.[x];
          if (dmcNumber) {
            const color = getDmcColorByNumber(dmcNumber);
            if (color) {
              ctx.fillStyle = color.hex;
              ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }
          }
        }
      }

      ctx.globalAlpha = 1;
    }

    // Draw symbols on colored cells (composite view)
    if (showSymbols && cellSize >= 10) {
      const fontSize = Math.max(6, Math.round(cellSize * 0.6));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Build composite grid for symbol display
      const compositeGrid: (string | null)[][] = Array.from({ length: gridHeight }, () =>
        Array(gridWidth).fill(null)
      );
      for (const layer of layers) {
        if (!layer.visible) continue;
        for (let y = 0; y < gridHeight; y++) {
          for (let x = 0; x < gridWidth; x++) {
            const dmcNumber = layer.grid[y]?.[x];
            if (dmcNumber) {
              compositeGrid[y][x] = dmcNumber;
            }
          }
        }
      }

      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const dmcNumber = compositeGrid[y][x];
          if (dmcNumber) {
            const symbol = colorSymbolMap.get(dmcNumber);
            if (symbol) {
              const color = getDmcColorByNumber(dmcNumber);
              const lum = color ? hexLuminance(color.hex) : 0.5;
              ctx.fillStyle = lum > 0.4 ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.85)";
              ctx.fillText(
                symbol,
                x * cellSize + cellSize / 2,
                y * cellSize + cellSize / 2
              );
            }
          }
        }
      }
    }

    // Draw grid
    if (showGrid && zoom >= 0.5) {
      ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
      ctx.lineWidth = 1;

      for (let x = 0; x <= gridWidth; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cellSize, 0);
        ctx.lineTo(x * cellSize, height);
        ctx.stroke();
      }

      for (let y = 0; y <= gridHeight; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cellSize);
        ctx.lineTo(width, y * cellSize);
        ctx.stroke();
      }

      // Draw heavier lines every 10 cells
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = 2;

      for (let x = 0; x <= gridWidth; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x * cellSize, 0);
        ctx.lineTo(x * cellSize, height);
        ctx.stroke();
      }

      for (let y = 0; y <= gridHeight; y += 10) {
        ctx.beginPath();
        ctx.moveTo(0, y * cellSize);
        ctx.lineTo(width, y * cellSize);
        ctx.stroke();
      }
    }

    // Draw selection
    if (selection) {
      ctx.fillStyle = "rgba(99, 102, 241, 0.3)";
      ctx.strokeStyle = "rgba(99, 102, 241, 0.8)";
      ctx.lineWidth = 2;

      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          if (selection[y]?.[x]) {
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }
      }

      // Draw move preview if moving selection
      if (moveOffset && (moveOffset.x !== 0 || moveOffset.y !== 0) && activeLayer) {
        ctx.globalAlpha = 0.6;
        for (let y = 0; y < gridHeight; y++) {
          for (let x = 0; x < gridWidth; x++) {
            if (selection[y]?.[x]) {
              const dmcNumber = activeLayer.grid[y]?.[x];
              if (dmcNumber) {
                const color = getDmcColorByNumber(dmcNumber);
                if (color) {
                  ctx.fillStyle = color.hex;
                  const newX = x + moveOffset.x;
                  const newY = y + moveOffset.y;
                  if (newX >= 0 && newX < gridWidth && newY >= 0 && newY < gridHeight) {
                    ctx.fillRect(newX * cellSize, newY * cellSize, cellSize, cellSize);
                  }
                }
              }
            }
          }
        }
        ctx.globalAlpha = 1;

        // Draw center snap lines when selection is centered
        const bounds = getSelectionBounds(selection);
        if (bounds) {
          const newMinX = bounds.minX + moveOffset.x;
          const newMinY = bounds.minY + moveOffset.y;
          const newMaxX = bounds.maxX + moveOffset.x;
          const newMaxY = bounds.maxY + moveOffset.y;
          const selWidth = newMaxX - newMinX + 1;
          const selHeight = newMaxY - newMinY + 1;

          // Check if horizontally centered
          const expectedCenterX = Math.floor((gridWidth - selWidth) / 2);
          const isCenteredH = newMinX === expectedCenterX;

          // Check if vertically centered
          const expectedCenterY = Math.floor((gridHeight - selHeight) / 2);
          const isCenteredV = newMinY === expectedCenterY;

          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);

          // Draw vertical center line (when horizontally centered)
          if (isCenteredH) {
            ctx.strokeStyle = "rgba(34, 197, 94, 0.9)"; // Green
            ctx.beginPath();
            ctx.moveTo((gridWidth / 2) * cellSize, 0);
            ctx.lineTo((gridWidth / 2) * cellSize, height);
            ctx.stroke();
          }

          // Draw horizontal center line (when vertically centered)
          if (isCenteredV) {
            ctx.strokeStyle = "rgba(34, 197, 94, 0.9)"; // Green
            ctx.beginPath();
            ctx.moveTo(0, (gridHeight / 2) * cellSize);
            ctx.lineTo(width, (gridHeight / 2) * cellSize);
            ctx.stroke();
          }

          ctx.setLineDash([]);
        }
      }
    }

    // Draw pending text overlay
    if (pendingText && textPlacementPos) {
      ctx.globalAlpha = 0.7;
      for (let py = 0; py < pendingText.height; py++) {
        for (let px = 0; px < pendingText.width; px++) {
          const dmcNum = pendingText.pixels[py]?.[px];
          if (dmcNum) {
            const color = getDmcColorByNumber(dmcNum);
            if (color) {
              ctx.fillStyle = color.hex;
              ctx.fillRect(
                (textPlacementPos.x + px) * cellSize,
                (textPlacementPos.y + py) * cellSize,
                cellSize,
                cellSize
              );
            }
          }
        }
      }
      ctx.globalAlpha = 1;

      // Draw bounding box
      ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        textPlacementPos.x * cellSize,
        textPlacementPos.y * cellSize,
        pendingText.width * cellSize,
        pendingText.height * cellSize
      );
      ctx.setLineDash([]);
    }
  }, [layers, activeLayer, gridWidth, gridHeight, cellSize, showGrid, showSymbols, colorSymbolMap, selection, referenceImageUrl, referenceImageOpacity, zoom, pendingText, textPlacementPos, moveOffset]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Handle escape key to cancel text placement or move operation
  // Handle enter key to confirm shape placement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Cancel move operation
        if (moveRef.current) {
          cancelMove();
          moveRef.current = null;
          return;
        }
        // Cancel text placement
        if (pendingText && onCancelTextPlacement) {
          onCancelTextPlacement();
          setTextPlacementPos(null);
        }
      } else if (e.key === "Enter") {
        // Confirm shape placement
        if (pendingText?.isShape && pendingText?.placedPosition && onConfirmShape) {
          onConfirmShape();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingText, onCancelTextPlacement, cancelMove, onConfirmShape]);

  // Get grid coordinates from mouse or touch event
  const getGridCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor(((clientX - rect.left) * scaleX) / cellSize);
    const y = Math.floor(((clientY - rect.top) * scaleY) / cellSize);

    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return null;

    return { x, y };
  }, [cellSize, gridWidth, gridHeight]);

  const getMouseCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    return getGridCoords(e.clientX, e.clientY);
  }, [getGridCoords]);

  const getTouchCoords = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) return null;
    const touch = e.touches[0];
    return getGridCoords(touch.clientX, touch.clientY);
  }, [getGridCoords]);

  // Shared drawing logic for mouse and touch
  const handleDrawStart = useCallback((coords: { x: number; y: number }, screenX?: number, screenY?: number) => {
    // Pan tool: always pan, never draw
    if (currentTool === "pan" && screenX !== undefined && screenY !== undefined) {
      dragRef.current = {
        startScreenX: screenX,
        startScreenY: screenY,
        startGridCoords: coords,
        startPanX: panX,
        startPanY: panY,
        isPanning: true, // Start panning immediately
        startTime: Date.now(),
      };
      return;
    }

    isDrawingRef.current = true;
    lastPosRef.current = coords;

    if (currentTool === "pencil") {
      saveToHistory();
      setPixel(coords.x, coords.y, currentColor?.dmcNumber || null);
    } else if (currentTool === "brush") {
      saveToHistory();
      setBrushPixels(coords.x, coords.y, currentColor?.dmcNumber || null);
    } else if (currentTool === "eraser") {
      saveToHistory();
      setBrushPixels(coords.x, coords.y, null, eraserSize);
    } else if (currentTool === "fill") {
      fillArea(coords.x, coords.y, currentColor?.dmcNumber || null);
    } else if (currentTool === "eyedropper") {
      // Sample from the composite of all visible layers
      let sampledColor: string | null = null;
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (layer.visible && layer.grid[coords.y]?.[coords.x]) {
          sampledColor = layer.grid[coords.y][coords.x];
          break;
        }
      }
      if (sampledColor) {
        const color = getDmcColorByNumber(sampledColor);
        if (color) {
          setCurrentColor(color);
          // Switch to pencil tool after picking a color
          useEditorStore.getState().setTool("pencil");
        }
      }
    } else if (currentTool === "select") {
      // Check if clicking inside existing selection to move it
      if (selection && isPointInSelection(coords.x, coords.y, selection)) {
        // Start move operation
        moveRef.current = { startX: coords.x, startY: coords.y };
        startMove(coords.x, coords.y);
      } else if (selection) {
        // Clicking outside existing selection - clear it
        clearSelection();
      } else {
        // No existing selection - create new selection
        startSelection(coords.x, coords.y);
      }
    } else if (currentTool === "magicWand") {
      selectByColor(coords.x, coords.y);
    }
  }, [currentTool, currentColor, eraserSize, layers, saveToHistory, setPixel, setBrushPixels, fillArea, setCurrentColor, startSelection, selectByColor, selection, startMove, clearSelection, panX, panY]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getMouseCoords(e);
    if (!coords) return;

    // Handle text placement mode
    if (pendingText && onTextPlaced) {
      onTextPlaced(coords.x, coords.y);
      setTextPlacementPos(null);
      return;
    }

    handleDrawStart(coords, e.clientX, e.clientY);
  }, [getMouseCoords, handleDrawStart, pendingText, onTextPlaced]);

  const getTouchDistance = useCallback((t0: React.Touch, t1: React.Touch) => {
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const getTouchMidpoint = useCallback((t0: React.Touch, t1: React.Touch) => ({
    x: (t0.clientX + t1.clientX) / 2,
    y: (t0.clientY + t1.clientY) / 2,
  }), []);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // Two-finger gesture: pinch-to-zoom and pan
    if (e.touches.length >= 2) {
      // Cancel any pending touch draw
      touchDrawRef.current = null;
      isDrawingRef.current = false;
      lastPosRef.current = null;

      const midpoint = getTouchMidpoint(e.touches[0], e.touches[1]);
      const canvas = canvasRef.current;

      // Calculate the grid coordinate under the pinch midpoint
      // This is what we want to keep fixed on screen as we zoom
      let gridPointX = gridWidth / 2;
      let gridPointY = gridHeight / 2;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        // Position relative to canvas in screen pixels
        const relX = midpoint.x - rect.left;
        const relY = midpoint.y - rect.top;
        // Convert to grid coordinates
        gridPointX = (relX / rect.width) * gridWidth;
        gridPointY = (relY / rect.height) * gridHeight;
      }

      pinchRef.current = {
        initialDistance: getTouchDistance(e.touches[0], e.touches[1]),
        initialZoom: zoom,
        initialPanX: panX,
        initialPanY: panY,
        initialMidpoint: midpoint,
        gridPointX,
        gridPointY,
      };
      return;
    }

    // Single touch: prepare for drawing but don't commit yet
    // Wait to see if this is a scroll gesture
    const coords = getTouchCoords(e);
    if (!coords) return;

    // Handle text placement mode - this is immediate
    if (pendingText && onTextPlaced) {
      onTextPlaced(coords.x, coords.y);
      setTextPlacementPos(null);
      return;
    }

    const touch = e.touches[0];

    // Pan tool: start panning immediately
    if (currentTool === "pan") {
      dragRef.current = {
        startScreenX: touch.clientX,
        startScreenY: touch.clientY,
        startGridCoords: coords,
        startPanX: panX,
        startPanY: panY,
        isPanning: true,
        startTime: Date.now(),
      };
      return;
    }

    // For drawing tools: store touch start but don't draw yet
    // Wait to distinguish scroll from draw intent
    touchDrawRef.current = {
      startScreenX: touch.clientX,
      startScreenY: touch.clientY,
      startGridCoords: coords,
      startTime: Date.now(),
      committed: false,
    };
  }, [getTouchCoords, getTouchDistance, getTouchMidpoint, pendingText, onTextPlaced, zoom, panX, panY, currentTool, gridWidth, gridHeight]);

  // Shared move logic for mouse and touch
  const handleDrawMove = useCallback((coords: { x: number; y: number }) => {
    if (!isDrawingRef.current) return;

    const lastPos = lastPosRef.current;

    if (currentTool === "pencil") {
      // Draw line from last pos to current
      if (lastPos) {
        const dx = Math.abs(coords.x - lastPos.x);
        const dy = Math.abs(coords.y - lastPos.y);
        const sx = lastPos.x < coords.x ? 1 : -1;
        const sy = lastPos.y < coords.y ? 1 : -1;
        let err = dx - dy;

        let x = lastPos.x;
        let y = lastPos.y;

        while (true) {
          setPixel(x, y, currentColor?.dmcNumber || null);

          if (x === coords.x && y === coords.y) break;

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
      }
      lastPosRef.current = coords;
    } else if (currentTool === "brush") {
      // Draw with brush (multiple pixels at once)
      if (lastPos) {
        const dx = Math.abs(coords.x - lastPos.x);
        const dy = Math.abs(coords.y - lastPos.y);
        const sx = lastPos.x < coords.x ? 1 : -1;
        const sy = lastPos.y < coords.y ? 1 : -1;
        let err = dx - dy;

        let x = lastPos.x;
        let y = lastPos.y;

        while (true) {
          setBrushPixels(x, y, currentColor?.dmcNumber || null);

          if (x === coords.x && y === coords.y) break;

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
      }
      lastPosRef.current = coords;
    } else if (currentTool === "eraser") {
      if (lastPos) {
        const dx = Math.abs(coords.x - lastPos.x);
        const dy = Math.abs(coords.y - lastPos.y);
        const sx = lastPos.x < coords.x ? 1 : -1;
        const sy = lastPos.y < coords.y ? 1 : -1;
        let err = dx - dy;

        let x = lastPos.x;
        let y = lastPos.y;

        while (true) {
          setBrushPixels(x, y, null, eraserSize);

          if (x === coords.x && y === coords.y) break;

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
      }
      lastPosRef.current = coords;
    } else if (currentTool === "select") {
      // If moving selection, update offset; otherwise update selection rectangle
      if (moveRef.current) {
        updateMoveOffset(coords.x, coords.y);
      } else {
        updateSelection(coords.x, coords.y);
      }
    }
  }, [currentTool, currentColor, eraserSize, setPixel, setBrushPixels, updateSelection, updateMoveOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getMouseCoords(e);

    // Handle text placement mode - update position even when not drawing
    if (pendingText && coords) {
      setTextPlacementPos(coords);
      return;
    }

    // Handle pan tool drag
    if (dragRef.current && dragRef.current.isPanning) {
      const dx = e.clientX - dragRef.current.startScreenX;
      const dy = e.clientY - dragRef.current.startScreenY;
      setPan(dragRef.current.startPanX + dx, dragRef.current.startPanY + dy);
      return;
    }

    // Handle move selection
    if (moveRef.current && coords) {
      updateMoveOffset(coords.x, coords.y);
      return;
    }

    if (!isDrawingRef.current) return;
    if (!coords) return;
    handleDrawMove(coords);
  }, [getMouseCoords, handleDrawMove, pendingText, setPan, updateMoveOffset]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // Handle pinch-to-zoom and two-finger pan
    if (e.touches.length >= 2 && pinchRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const newDistance = getTouchDistance(e.touches[0], e.touches[1]);
      const zoomScale = newDistance / pinchRef.current.initialDistance;
      const newZoom = Math.max(0.1, Math.min(10, pinchRef.current.initialZoom * zoomScale));
      const newCellSize = 20 * newZoom;

      // Current midpoint position on screen
      const newMidpoint = getTouchMidpoint(e.touches[0], e.touches[1]);

      // We want the grid point (gridPointX, gridPointY) to appear at newMidpoint
      // Canvas is centered in container, so we need to calculate where it would be
      // The container is translated by (panX, panY) and canvas is flex-centered inside

      // At the new zoom, the canvas size will be:
      const newCanvasWidth = gridWidth * newCellSize;
      const newCanvasHeight = gridHeight * newCellSize;

      // The grid point's position relative to canvas top-left:
      const gridPointCanvasX = pinchRef.current.gridPointX * newCellSize;
      const gridPointCanvasY = pinchRef.current.gridPointY * newCellSize;

      // We want: midpoint = containerCenter + newPan + (gridPointCanvas - canvasSize/2)
      // where containerCenter is the center of the container on screen

      // Using the initial state as reference:
      // At initial: midpoint was at initialPan with canvas centered
      // The container center relative to viewport depends on the layout

      // Simpler approach: calculate relative to initial state
      // At initial zoom, the grid point was at a certain screen position
      // At new zoom, we want it at newMidpoint

      // Finger movement
      const fingerDx = newMidpoint.x - pinchRef.current.initialMidpoint.x;
      const fingerDy = newMidpoint.y - pinchRef.current.initialMidpoint.y;

      // Position shift due to zoom change (grid point moves relative to canvas center)
      const initialCellSize = 20 * pinchRef.current.initialZoom;
      const gridPointInitialX = pinchRef.current.gridPointX * initialCellSize;
      const gridPointInitialY = pinchRef.current.gridPointY * initialCellSize;
      const initialCanvasWidth = gridWidth * initialCellSize;
      const initialCanvasHeight = gridHeight * initialCellSize;

      // Grid point offset from canvas center (initial)
      const offsetFromCenterInitialX = gridPointInitialX - initialCanvasWidth / 2;
      const offsetFromCenterInitialY = gridPointInitialY - initialCanvasHeight / 2;

      // Grid point offset from canvas center (new zoom)
      const offsetFromCenterNewX = gridPointCanvasX - newCanvasWidth / 2;
      const offsetFromCenterNewY = gridPointCanvasY - newCanvasHeight / 2;

      // The grid point moved by this much relative to canvas center
      const zoomShiftX = offsetFromCenterNewX - offsetFromCenterInitialX;
      const zoomShiftY = offsetFromCenterNewY - offsetFromCenterInitialY;

      // To keep the grid point at the finger midpoint:
      // newPan = initialPan + fingerMovement - zoomShift
      const newPanX = pinchRef.current.initialPanX + fingerDx - zoomShiftX;
      const newPanY = pinchRef.current.initialPanY + fingerDy - zoomShiftY;

      setZoom(newZoom);
      setPan(newPanX, newPanY);
      return;
    }

    // Handle pan tool drag (single finger)
    if (dragRef.current && dragRef.current.isPanning && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - dragRef.current.startScreenX;
      const dy = touch.clientY - dragRef.current.startScreenY;
      setPan(dragRef.current.startPanX + dx, dragRef.current.startPanY + dy);
      return;
    }

    // Handle pending touch draw - detect scroll vs draw intent
    if (touchDrawRef.current && !touchDrawRef.current.committed && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - touchDrawRef.current.startScreenX;
      const dy = touch.clientY - touchDrawRef.current.startScreenY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - touchDrawRef.current.startTime;

      // If moved quickly and far, it's a scroll gesture - pan instead
      if (distance > SCROLL_THRESHOLD && elapsed < SCROLL_TIME_THRESHOLD) {
        // Convert to pan mode
        dragRef.current = {
          startScreenX: touchDrawRef.current.startScreenX,
          startScreenY: touchDrawRef.current.startScreenY,
          startGridCoords: touchDrawRef.current.startGridCoords,
          startPanX: panX,
          startPanY: panY,
          isPanning: true,
          startTime: touchDrawRef.current.startTime,
        };
        touchDrawRef.current = null;

        // Apply the pan that's already happened
        setPan(panX + dx, panY + dy);
        return;
      }

      // If moved but slowly, or after initial delay - commit to drawing
      if (distance > 3 || elapsed > SCROLL_TIME_THRESHOLD) {
        touchDrawRef.current.committed = true;

        // Now actually start drawing from the original position
        handleDrawStart(touchDrawRef.current.startGridCoords);

        // And draw to current position
        const coords = getTouchCoords(e);
        if (coords) {
          handleDrawMove(coords);
        }
        return;
      }

      // Still waiting to determine intent
      return;
    }

    // Handle move selection
    if (moveRef.current) {
      const coords = getTouchCoords(e);
      if (coords) {
        updateMoveOffset(coords.x, coords.y);
      }
      return;
    }

    if (!isDrawingRef.current) return;
    const coords = getTouchCoords(e);
    if (!coords) return;
    handleDrawMove(coords);
  }, [getTouchCoords, getTouchDistance, getTouchMidpoint, handleDrawMove, handleDrawStart, setZoom, setPan, updateMoveOffset, panX, panY]);

  const handleDrawEnd = useCallback(() => {
    isDrawingRef.current = false;
    lastPosRef.current = null;
  }, []);

  const handleMouseUp = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle move selection end
    if (moveRef.current) {
      commitMove();
      moveRef.current = null;
      return;
    }

    // Handle pan tool drag end
    if (dragRef.current) {
      dragRef.current = null;
      return;
    }

    handleDrawEnd();
  }, [handleDrawEnd, commitMove]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // If we were in a pinch gesture, clean up when fingers lift
    if (pinchRef.current) {
      if (e.touches.length < 2) {
        pinchRef.current = null;
      }
      return;
    }

    // Handle pending touch draw that wasn't committed
    // This is a tap - draw a single pixel at the start position
    if (touchDrawRef.current && !touchDrawRef.current.committed) {
      const elapsed = Date.now() - touchDrawRef.current.startTime;
      // Only draw if it was a quick tap (not a held touch that we're still deciding on)
      if (elapsed < 300) {
        handleDrawStart(touchDrawRef.current.startGridCoords);
        handleDrawEnd();
      }
      touchDrawRef.current = null;
      return;
    }

    // Clean up committed touch draw
    if (touchDrawRef.current) {
      touchDrawRef.current = null;
    }

    // Handle move selection end
    if (moveRef.current) {
      commitMove();
      moveRef.current = null;
      return;
    }

    // Handle pan tool drag end
    if (dragRef.current) {
      dragRef.current = null;
      return;
    }

    isDrawingRef.current = false;
    lastPosRef.current = null;
  }, [commitMove, handleDrawStart, handleDrawEnd]);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null;
    isDrawingRef.current = false;
    lastPosRef.current = null;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, zoom * delta));
    const scale = newZoom / zoom;

    // Zoom toward cursor: keep the point under the cursor fixed on screen
    const rect = canvas.getBoundingClientRect();
    const cursorFromCenterX = e.clientX - rect.left - rect.width / 2;
    const cursorFromCenterY = e.clientY - rect.top - rect.height / 2;

    setZoom(newZoom);
    setPan(
      panX - (scale - 1) * cursorFromCenterX,
      panY - (scale - 1) * cursorFromCenterY
    );
  }, [zoom, panX, panY, setZoom, setPan]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden bg-slate-100 relative"
    >
      {/* Inner wrapper that handles pan/zoom transform */}
      <div
        className="w-full h-full flex items-center justify-center p-2 md:p-4"
        style={{ transform: `translate(${panX}px, ${panY}px)` }}
      >
        <canvas
          ref={canvasRef}
          className={`shadow-lg touch-none ${pendingText ? "cursor-cell" : currentTool === "pan" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </div>

      {/* Text/Shape/Paste placement mode indicator */}
      {pendingText && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 z-10">
          {/* Resize buttons for shapes and text */}
          {(pendingText.isShape || pendingText.isText) && onResizePendingShape && (
            <div className="flex items-center gap-1 mr-2 border-r border-blue-400 pr-3">
              <button
                onClick={() => onResizePendingShape(-0.25)}
                className="w-8 h-8 flex items-center justify-center bg-blue-500 hover:bg-blue-400 rounded-lg text-lg font-bold"
                title="Make smaller"
              >
                −
              </button>
              <span className="text-xs w-12 text-center">
                {pendingText.width}×{pendingText.height}
              </span>
              <button
                onClick={() => onResizePendingShape(0.25)}
                className="w-8 h-8 flex items-center justify-center bg-blue-500 hover:bg-blue-400 rounded-lg text-lg font-bold"
                title="Make larger"
              >
                +
              </button>
            </div>
          )}
          {/* Flip buttons for paste mode */}
          {pendingText.isPaste && (
            <div className="flex items-center gap-1 mr-2 border-r border-blue-400 pr-3">
              <button
                onClick={onFlipPendingHorizontal}
                className="w-8 h-8 flex items-center justify-center bg-blue-500 hover:bg-blue-400 rounded-lg text-sm"
                title="Flip Horizontal"
              >
                ↔️
              </button>
              <button
                onClick={onFlipPendingVertical}
                className="w-8 h-8 flex items-center justify-center bg-blue-500 hover:bg-blue-400 rounded-lg text-sm"
                title="Flip Vertical"
              >
                ↕️
              </button>
              <span className="text-xs ml-1">
                {pendingText.width}×{pendingText.height}
              </span>
            </div>
          )}
          {pendingText.isShape && pendingText.placedPosition ? (
            <>
              <span className="text-sm font-medium">
                Drag to move, +/- to resize
              </span>
              <button
                onClick={onConfirmShape}
                className="px-3 py-1 bg-green-500 hover:bg-green-400 rounded text-sm font-medium"
              >
                Confirm (Enter)
              </button>
              <button
                onClick={onCancelTextPlacement}
                className="text-blue-200 hover:text-white text-sm underline"
              >
                Cancel (Esc)
              </button>
            </>
          ) : (
            <>
              <span className="text-sm font-medium">
                Click to place {pendingText.isPaste ? "pasted content" : pendingText.isShape ? "shape" : "text"}
              </span>
              <button
                onClick={onCancelTextPlacement}
                className="text-blue-200 hover:text-white text-sm underline"
              >
                Cancel (Esc)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useEditorStore } from "@/lib/store";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { SYMBOLS, hexLuminance } from "@/lib/symbols";

interface PixelCanvasProps {
  pendingText?: {
    pixels: (string | null)[][];
    width: number;
    height: number;
  } | null;
  onTextPlaced?: (x: number, y: number) => void;
  onCancelTextPlacement?: () => void;
}

export default function PixelCanvas({
  pendingText,
  onTextPlaced,
  onCancelTextPlacement,
}: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null);
  const [textPlacementPos, setTextPlacementPos] = useState<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{
    initialDistance: number;
    initialZoom: number;
    initialPanX: number;
    initialPanY: number;
    initialMidpoint: { x: number; y: number };
  } | null>(null);

  // Pencil mode: click to place pixel, drag to pan
  const PAN_THRESHOLD = 6; // pixels of screen movement before switching to pan
  const dragRef = useRef<{
    startScreenX: number;
    startScreenY: number;
    startGridCoords: { x: number; y: number };
    startPanX: number;
    startPanY: number;
    isPanning: boolean;
  } | null>(null);

  const {
    grid,
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
    drawLine,
    setCurrentColor,
    startSelection,
    updateSelection,
    selectByColor,
    saveToHistory,
    setZoom,
    setPan,
  } = useEditorStore();

  const cellSize = 20 * zoom;

  // Build a stable color → symbol map based on the order colors appear in the grid
  const colorSymbolMap = useMemo(() => {
    const map = new Map<string, string>();
    let idx = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell && !map.has(cell)) {
          map.set(cell, SYMBOLS[idx % SYMBOLS.length]);
          idx++;
        }
      }
    }
    return map;
  }, [grid]);

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

    // Draw pixels
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        const dmcNumber = grid[y]?.[x];
        if (dmcNumber) {
          const color = getDmcColorByNumber(dmcNumber);
          if (color) {
            ctx.fillStyle = color.hex;
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }
      }
    }

    // Draw symbols on colored cells
    if (showSymbols && cellSize >= 10) {
      const fontSize = Math.max(6, Math.round(cellSize * 0.6));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          const dmcNumber = grid[y]?.[x];
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
  }, [grid, gridWidth, gridHeight, cellSize, showGrid, showSymbols, colorSymbolMap, selection, referenceImageUrl, referenceImageOpacity, zoom, pendingText, textPlacementPos]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Handle escape key to cancel text placement
  useEffect(() => {
    if (!pendingText) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCancelTextPlacement) {
        onCancelTextPlacement();
        setTextPlacementPos(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingText, onCancelTextPlacement]);

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

  // Start drag tracking for pencil pan detection
  const startDragTracking = useCallback((screenX: number, screenY: number, gridCoords: { x: number; y: number }) => {
    dragRef.current = {
      startScreenX: screenX,
      startScreenY: screenY,
      startGridCoords: gridCoords,
      startPanX: panX,
      startPanY: panY,
      isPanning: false,
    };
  }, [panX, panY]);

  // Shared drawing logic for mouse and touch
  const handleDrawStart = useCallback((coords: { x: number; y: number }, screenX?: number, screenY?: number) => {
    // Pencil mode: defer drawing, track for pan vs tap
    if (currentTool === "pencil" && screenX !== undefined && screenY !== undefined) {
      startDragTracking(screenX, screenY, coords);
      return;
    }

    setIsDrawing(true);
    setLastPos(coords);

    if (currentTool === "pencil") {
      // Fallback if no screen coords (shouldn't happen)
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
    } else if (currentTool === "line") {
      setLineStart(coords);
    } else if (currentTool === "eyedropper") {
      const dmcNumber = grid[coords.y]?.[coords.x];
      if (dmcNumber) {
        const color = getDmcColorByNumber(dmcNumber);
        if (color) {
          setCurrentColor(color);
          // Switch to pencil tool after picking a color
          useEditorStore.getState().setTool("pencil");
        }
      }
    } else if (currentTool === "select") {
      startSelection(coords.x, coords.y);
    } else if (currentTool === "magicWand") {
      selectByColor(coords.x, coords.y);
    }
  }, [currentTool, currentColor, eraserSize, grid, saveToHistory, setPixel, setBrushPixels, fillArea, setCurrentColor, startSelection, selectByColor]);

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
      pinchRef.current = {
        initialDistance: getTouchDistance(e.touches[0], e.touches[1]),
        initialZoom: zoom,
        initialPanX: panX,
        initialPanY: panY,
        initialMidpoint: getTouchMidpoint(e.touches[0], e.touches[1]),
      };
      setIsDrawing(false);
      setLastPos(null);
      return;
    }

    // Single touch: drawing
    const coords = getTouchCoords(e);
    if (!coords) return;

    // Handle text placement mode
    if (pendingText && onTextPlaced) {
      onTextPlaced(coords.x, coords.y);
      setTextPlacementPos(null);
      return;
    }

    const touch = e.touches[0];
    handleDrawStart(coords, touch.clientX, touch.clientY);
  }, [getTouchCoords, getTouchDistance, getTouchMidpoint, handleDrawStart, pendingText, onTextPlaced, zoom, panX, panY]);

  // Shared move logic for mouse and touch
  const handleDrawMove = useCallback((coords: { x: number; y: number }) => {
    if (!isDrawing) return;

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
      setLastPos(coords);
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
      setLastPos(coords);
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
      setLastPos(coords);
    } else if (currentTool === "select") {
      updateSelection(coords.x, coords.y);
    }
  }, [isDrawing, currentTool, currentColor, eraserSize, lastPos, setPixel, setBrushPixels, updateSelection]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getMouseCoords(e);

    // Handle text placement mode - update position even when not drawing
    if (pendingText && coords) {
      setTextPlacementPos(coords);
      return;
    }

    // Handle pencil drag-to-pan
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startScreenX;
      const dy = e.clientY - dragRef.current.startScreenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > PAN_THRESHOLD || dragRef.current.isPanning) {
        dragRef.current.isPanning = true;
        setPan(dragRef.current.startPanX + dx, dragRef.current.startPanY + dy);
      }
      return;
    }

    if (!isDrawing) return;
    if (!coords) return;
    handleDrawMove(coords);
  }, [isDrawing, getMouseCoords, handleDrawMove, pendingText, setPan]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // Handle pinch-to-zoom and two-finger pan
    if (e.touches.length >= 2 && pinchRef.current) {
      const newDistance = getTouchDistance(e.touches[0], e.touches[1]);
      const scale = newDistance / pinchRef.current.initialDistance;
      setZoom(pinchRef.current.initialZoom * scale);

      const newMidpoint = getTouchMidpoint(e.touches[0], e.touches[1]);
      const dx = newMidpoint.x - pinchRef.current.initialMidpoint.x;
      const dy = newMidpoint.y - pinchRef.current.initialMidpoint.y;
      setPan(pinchRef.current.initialPanX + dx, pinchRef.current.initialPanY + dy);
      return;
    }

    // Handle pencil drag-to-pan (single finger)
    if (dragRef.current && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - dragRef.current.startScreenX;
      const dy = touch.clientY - dragRef.current.startScreenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > PAN_THRESHOLD || dragRef.current.isPanning) {
        dragRef.current.isPanning = true;
        setPan(dragRef.current.startPanX + dx, dragRef.current.startPanY + dy);
      }
      return;
    }

    if (!isDrawing) return;
    const coords = getTouchCoords(e);
    if (!coords) return;
    handleDrawMove(coords);
  }, [isDrawing, getTouchCoords, getTouchDistance, getTouchMidpoint, handleDrawMove, setZoom, setPan]);

  const handleDrawEnd = useCallback((coords: { x: number; y: number } | null) => {
    // Handle line tool on end
    if (currentTool === "line" && lineStart && coords) {
      drawLine(lineStart.x, lineStart.y, coords.x, coords.y, currentColor?.dmcNumber || null);
      setLineStart(null);
    }

    setIsDrawing(false);
    setLastPos(null);
  }, [currentTool, lineStart, drawLine, currentColor]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle pencil drag-to-pan end: if didn't pan, treat as a click to place pixel
    if (dragRef.current) {
      if (!dragRef.current.isPanning) {
        const coords = dragRef.current.startGridCoords;
        saveToHistory();
        setPixel(coords.x, coords.y, currentColor?.dmcNumber || null);
      }
      dragRef.current = null;
      return;
    }

    const coords = getMouseCoords(e);
    handleDrawEnd(coords);
  }, [getMouseCoords, handleDrawEnd, saveToHistory, setPixel, currentColor]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // If we were in a pinch gesture, clean up when fingers lift
    if (pinchRef.current) {
      if (e.touches.length < 2) {
        pinchRef.current = null;
      }
      return;
    }

    // Handle pencil drag-to-pan end: if didn't pan, treat as a tap to place pixel
    if (dragRef.current) {
      if (!dragRef.current.isPanning) {
        const coords = dragRef.current.startGridCoords;
        saveToHistory();
        setPixel(coords.x, coords.y, currentColor?.dmcNumber || null);
      }
      dragRef.current = null;
      return;
    }

    // For touch end, we use the last known position since touches array is empty
    if (currentTool === "line" && lineStart && lastPos) {
      drawLine(lineStart.x, lineStart.y, lastPos.x, lastPos.y, currentColor?.dmcNumber || null);
      setLineStart(null);
    }
    setIsDrawing(false);
    setLastPos(null);
  }, [currentTool, lineStart, lastPos, drawLine, currentColor, saveToHistory, setPixel]);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null;
    setIsDrawing(false);
    setLastPos(null);
    setLineStart(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(zoom * delta);
  }, [zoom, setZoom]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center p-2 md:p-4 relative"
      style={{ transform: `translate(${panX}px, ${panY}px)` }}
    >
      <canvas
        ref={canvasRef}
        className={`shadow-lg touch-none ${pendingText ? "cursor-cell" : "cursor-crosshair"}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* Text placement mode indicator */}
      {pendingText && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 z-10">
          <span className="text-sm font-medium">Click to place text</span>
          <button
            onClick={onCancelTextPlacement}
            className="text-blue-200 hover:text-white text-sm underline"
          >
            Cancel (Esc)
          </button>
        </div>
      )}
    </div>
  );
}

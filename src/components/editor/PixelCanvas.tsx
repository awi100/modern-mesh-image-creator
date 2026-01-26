"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

export default function PixelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null);

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
    brushSize,
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
  }, [grid, gridWidth, gridHeight, cellSize, showGrid, selection, referenceImageUrl, referenceImageOpacity, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Get grid coordinates from mouse event
  const getGridCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor(((e.clientX - rect.left) * scaleX) / cellSize);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / cellSize);

    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return null;

    return { x, y };
  }, [cellSize, gridWidth, gridHeight]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getGridCoords(e);
    if (!coords) return;

    setIsDrawing(true);
    setLastPos(coords);

    if (currentTool === "pencil") {
      saveToHistory();
      setPixel(coords.x, coords.y, currentColor?.dmcNumber || null);
    } else if (currentTool === "brush") {
      saveToHistory();
      setBrushPixels(coords.x, coords.y, currentColor?.dmcNumber || null);
    } else if (currentTool === "eraser") {
      saveToHistory();
      setPixel(coords.x, coords.y, null);
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
        }
      }
    } else if (currentTool === "select") {
      startSelection(coords.x, coords.y);
    } else if (currentTool === "magicWand") {
      selectByColor(coords.x, coords.y);
    }
  }, [getGridCoords, currentTool, currentColor, grid, saveToHistory, setPixel, setBrushPixels, fillArea, setCurrentColor, startSelection, selectByColor]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const coords = getGridCoords(e);
    if (!coords) return;

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
      setPixel(coords.x, coords.y, null);
      setLastPos(coords);
    } else if (currentTool === "select") {
      updateSelection(coords.x, coords.y);
    }
  }, [isDrawing, getGridCoords, currentTool, currentColor, lastPos, setPixel, setBrushPixels, updateSelection]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle line tool on mouse up
    if (currentTool === "line" && lineStart) {
      const coords = getGridCoords(e);
      if (coords) {
        drawLine(lineStart.x, lineStart.y, coords.x, coords.y, currentColor?.dmcNumber || null);
      }
      setLineStart(null);
    }

    setIsDrawing(false);
    setLastPos(null);
  }, [currentTool, lineStart, getGridCoords, drawLine, currentColor]);

  const handleMouseLeave = useCallback(() => {
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
      className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center p-4"
      style={{ transform: `translate(${panX}px, ${panY}px)` }}
    >
      <canvas
        ref={canvasRef}
        className="shadow-lg cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />
    </div>
  );
}

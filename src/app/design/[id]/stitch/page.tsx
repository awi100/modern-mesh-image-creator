"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { SYMBOLS, hexLuminance } from "@/lib/symbols";

// ---- helpers ----
const textOn = (hex: string) => (hexLuminance(hex) > 0.55 ? "#111827" : "#ffffff");

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface DesignData {
  name: string;
  grid: (string | null)[][];
  meshCount: number;
}
interface ColorInfo {
  dmc: string;
  name: string;
  hex: string;
  symbol: string;
  total: number;
}

export default function StitchPage() {
  const { id: designId } = useParams<{ id: string }>();

  const [design, setDesign] = useState<DesignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [colors, setColors] = useState<ColorInfo[]>([]);
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [isolate, setIsolate] = useState(true);
  const [showSymbols, setShowSymbols] = useState(true);
  const [mode, setMode] = useState<"stitch" | "move">("stitch");
  const [statsVersion, setStatsVersion] = useState(0); // bump to refresh sidebar counts

  // Grid dimensions
  const dims = useRef({ w: 0, h: 0 });

  // Stitched state as a bitset (1 bit per cell), plus incremental done counts.
  const bitsRef = useRef<Uint8Array>(new Uint8Array(0));
  const doneByColorRef = useRef<Record<string, number>>({});
  const doneTotalRef = useRef(0);

  const totalStitches = useMemo(() => colors.reduce((s, c) => s + c.total, 0), [colors]);

  // Canvas / viewport
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ cell: 12, panX: 0, panY: 0 });
  const rafRef = useRef<number | null>(null);

  // Pointer interaction
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const paintingRef = useRef(false);
  const paintTargetRef = useRef(true);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ dist: number; cell: number; cx: number; cy: number; panX: number; panY: number } | null>(null);
  const activeColorRef = useRef<string | null>(null);
  const isolateRef = useRef(true);
  const showSymbolsRef = useRef(true);
  useEffect(() => { activeColorRef.current = activeColor; scheduleDraw(); }, [activeColor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { isolateRef.current = isolate; scheduleDraw(); }, [isolate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { showSymbolsRef.current = showSymbols; scheduleDraw(); }, [showSymbols]); // eslint-disable-line react-hooks/exhaustive-deps

  const storageKey = `stitch-progress:${designId}`;

  // ---- load design ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/designs/${designId}`);
        if (!res.ok) throw new Error("Failed to load design");
        const data = await res.json();
        if (cancelled) return;
        const grid: (string | null)[][] = data.grid || [];
        const h = grid.length;
        const w = grid[0]?.length || 0;
        dims.current = { w, h };

        // Tally colors
        const totals: Record<string, number> = {};
        for (const row of grid) for (const cell of row) if (cell) totals[cell] = (totals[cell] || 0) + 1;
        const list: ColorInfo[] = Object.entries(totals)
          .sort((a, b) => b[1] - a[1])
          .map(([dmc, total], i) => {
            const c = getDmcColorByNumber(dmc);
            return { dmc, name: c?.name ?? "Unknown", hex: c?.hex ?? "#888888", symbol: SYMBOLS[i % SYMBOLS.length], total };
          });

        // Init bitset (+ restore from localStorage if dims match)
        const bytes = new Uint8Array(Math.ceil((w * h) / 8));
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.w === w && parsed.h === h && typeof parsed.bits === "string") {
              const restored = b64ToBytes(parsed.bits);
              bytes.set(restored.subarray(0, bytes.length));
            }
          }
        } catch { /* ignore corrupt saves */ }
        bitsRef.current = bytes;

        setDesign({ name: data.name, grid, meshCount: data.meshCount });
        setColors(list);
        recomputeStats(grid, bytes);
        // Fit to viewport once mounted
        requestAnimationFrame(() => { fitToView(); scheduleDraw(); });
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [designId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute done counts from scratch (load / bulk / reset)
  const recomputeStats = (grid: (string | null)[][], bytes: Uint8Array) => {
    const done: Record<string, number> = {};
    let total = 0;
    const w = grid[0]?.length || 0;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < w; x++) {
        const dmc = grid[y][x];
        if (!dmc) continue;
        const idx = y * w + x;
        if ((bytes[idx >> 3] >> (idx & 7)) & 1) { done[dmc] = (done[dmc] || 0) + 1; total++; }
      }
    }
    doneByColorRef.current = done;
    doneTotalRef.current = total;
  };

  // ---- bit helpers ----
  const getBit = (idx: number) => (bitsRef.current[idx >> 3] >> (idx & 7)) & 1;
  const setBit = (idx: number, val: boolean) => {
    const byte = idx >> 3, mask = 1 << (idx & 7);
    if (val) bitsRef.current[byte] |= mask; else bitsRef.current[byte] &= ~mask;
  };

  // Toggle a single cell to a target state, keeping counts in sync. Returns true if changed.
  const applyCell = (x: number, y: number, target: boolean): boolean => {
    const { w, h } = dims.current;
    if (x < 0 || y < 0 || x >= w || y >= h || !design) return false;
    const dmc = design.grid[y][x];
    if (!dmc) return false;
    const ac = activeColorRef.current;
    if (ac && dmc !== ac) return false; // one-color-at-a-time filter
    const idx = y * w + x;
    if (((getBit(idx) === 1)) === target) return false;
    setBit(idx, target);
    doneByColorRef.current[dmc] = (doneByColorRef.current[dmc] || 0) + (target ? 1 : -1);
    doneTotalRef.current += target ? 1 : -1;
    return true;
  };

  // ---- persistence (debounced) ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { w, h } = dims.current;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ w, h, bits: bytesToB64(bitsRef.current), updatedAt: Date.now() }));
      } catch { /* storage full / unavailable */ }
    }, 400);
  }, [storageKey]);

  // ---- drawing ----
  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback(() => {
    const canvas = canvasRef.current, container = containerRef.current;
    if (!canvas || !container || !design) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth, ch = container.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr; canvas.height = ch * dpr;
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, cw, ch);

    const { cell, panX, panY } = viewRef.current;
    const { w, h } = dims.current;
    const grid = design.grid;
    const ac = activeColorRef.current, iso = isolateRef.current, sym = showSymbolsRef.current;

    // visible cell range
    const x0 = Math.max(0, Math.floor(-panX / cell));
    const y0 = Math.max(0, Math.floor(-panY / cell));
    const x1 = Math.min(w, Math.ceil((cw - panX) / cell));
    const y1 = Math.min(h, Math.ceil((ch - panY) / cell));

    const drawSym = sym && cell >= 12;
    if (drawSym) { ctx.font = `${Math.floor(cell * 0.7)}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; }
    const symbolByDmc: Record<string, string> = {};
    if (drawSym) for (const c of colors) symbolByDmc[c.dmc] = c.symbol;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dmc = grid[y][x];
        if (!dmc) continue;
        const sx = panX + x * cell, sy = panY + y * cell;
        const c = getDmcColorByNumber(dmc);
        const hex = c?.hex ?? "#888888";
        const faded = iso && ac && dmc !== ac;
        ctx.globalAlpha = faded ? 0.14 : 1;
        ctx.fillStyle = hex;
        ctx.fillRect(sx, sy, cell, cell);

        const idx = y * w + x;
        const stitched = ((bitsRef.current[idx >> 3] >> (idx & 7)) & 1) === 1;
        if (stitched && !faded) {
          // darken + checkmark
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = "#0b3d16";
          ctx.fillRect(sx, sy, cell, cell);
          ctx.globalAlpha = 1;
          if (cell >= 8) {
            ctx.strokeStyle = "#4ade80";
            ctx.lineWidth = Math.max(1, cell * 0.12);
            ctx.beginPath();
            ctx.moveTo(sx + cell * 0.22, sy + cell * 0.55);
            ctx.lineTo(sx + cell * 0.42, sy + cell * 0.75);
            ctx.lineTo(sx + cell * 0.8, sy + cell * 0.28);
            ctx.stroke();
          }
        } else if (drawSym && !faded) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = textOn(hex);
          ctx.fillText(symbolByDmc[dmc] || "", sx + cell / 2, sy + cell / 2 + 1);
        }
      }
    }
    ctx.globalAlpha = 1;

    // grid lines when zoomed in
    if (cell >= 7) {
      ctx.strokeStyle = "rgba(148,163,184,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) { const sx = Math.round(panX + x * cell) + 0.5; ctx.moveTo(sx, panY + y0 * cell); ctx.lineTo(sx, panY + y1 * cell); }
      for (let y = y0; y <= y1; y++) { const sy = Math.round(panY + y * cell) + 0.5; ctx.moveTo(panX + x0 * cell, sy); ctx.lineTo(panX + x1 * cell, sy); }
      ctx.stroke();
    }
  }, [design, colors]);

  useEffect(() => { scheduleDraw(); }, [scheduleDraw, design, colors, statsVersion]);
  useEffect(() => {
    const onResize = () => scheduleDraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [scheduleDraw]);

  const fitToView = () => {
    const container = containerRef.current;
    const { w, h } = dims.current;
    if (!container || !w || !h) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    const cell = Math.max(2, Math.floor(Math.min(cw / w, ch / h)));
    viewRef.current = { cell, panX: (cw - w * cell) / 2, panY: (ch - h * cell) / 2 };
  };

  // ---- pointer → cell ----
  const cellFromEvent = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { cell, panX, panY } = viewRef.current;
    return { x: Math.floor((e.clientX - rect.left - panX) / cell), y: Math.floor((e.clientY - rect.top - panY) / cell) };
  };

  const zoomAt = (screenX: number, screenY: number, factor: number) => {
    const v = viewRef.current;
    const newCell = Math.min(48, Math.max(2, v.cell * factor));
    const f = newCell / v.cell;
    viewRef.current = { cell: newCell, panX: screenX - (screenX - v.panX) * f, panY: screenY - (screenY - v.panY) * f };
    scheduleDraw();
  };

  const commitChange = () => { setStatsVersion((n) => n + 1); scheduleSave(); };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      // start pinch
      const pts = [...pointersRef.current.values()];
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      const v = viewRef.current;
      pinchRef.current = { dist: Math.hypot(dx, dy), cell: v.cell, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2, panX: v.panX, panY: v.panY };
      paintingRef.current = false;
      lastPanRef.current = null;
      return;
    }

    if (mode === "move") { lastPanRef.current = { x: e.clientX, y: e.clientY }; return; }

    // stitch mode: begin painting
    const { x, y } = cellFromEvent(e);
    const { w } = dims.current;
    if (x < 0 || y < 0 || !design || y >= design.grid.length || x >= w) return;
    const dmc = design.grid[y][x];
    if (!dmc) return;
    const idx = y * w + x;
    paintTargetRef.current = getBit(idx) === 0; // toggle based on first cell
    paintingRef.current = true;
    if (applyCell(x, y, paintTargetRef.current)) { scheduleDraw(); commitChange(); }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const p = pinchRef.current;
      const f = dist / (p.dist || 1);
      const newCell = Math.min(48, Math.max(2, p.cell * f));
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = p.cx - rect.left, cy = p.cy - rect.top;
      const ff = newCell / p.cell;
      viewRef.current = { cell: newCell, panX: cx - (cx - p.panX) * ff, panY: cy - (cy - p.panY) * ff };
      scheduleDraw();
      return;
    }

    if (mode === "move" && lastPanRef.current) {
      const v = viewRef.current;
      viewRef.current = { ...v, panX: v.panX + (e.clientX - lastPanRef.current.x), panY: v.panY + (e.clientY - lastPanRef.current.y) };
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      scheduleDraw();
      return;
    }

    if (paintingRef.current) {
      const { x, y } = cellFromEvent(e);
      if (applyCell(x, y, paintTargetRef.current)) { scheduleDraw(); setStatsVersion((n) => n + 1); scheduleSave(); }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) { paintingRef.current = false; lastPanRef.current = null; commitChange(); }
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };

  // ---- bulk actions ----
  const bulkColor = (dmc: string, target: boolean) => {
    if (!design) return;
    const { w } = dims.current;
    for (let y = 0; y < design.grid.length; y++) {
      for (let x = 0; x < w; x++) {
        if (design.grid[y][x] !== dmc) continue;
        const idx = y * w + x;
        if ((getBit(idx) === 1) !== target) setBit(idx, target);
      }
    }
    recomputeStats(design.grid, bitsRef.current);
    scheduleDraw(); commitChange();
  };
  const resetAll = () => {
    if (!design || !confirm("Reset all stitching progress for this design?")) return;
    bitsRef.current = new Uint8Array(bitsRef.current.length);
    recomputeStats(design.grid, bitsRef.current);
    scheduleDraw(); commitChange();
  };

  // ---- derived (recomputed on statsVersion) ----
  const doneTotal = doneTotalRef.current;
  const pct = totalStitches > 0 ? Math.round((doneTotal / totalStitches) * 100) : 0;
  void statsVersion; // ensure re-read of refs on bump

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-3 md:px-4 py-2 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <Link href={`/design/${designId}/info`} className="text-sm text-slate-400 hover:text-white">← Back</Link>
        <h1 className="font-semibold truncate">{design?.name ?? "Stitch"}<span className="text-slate-500 font-normal text-sm ml-2">Stitch-along</span></h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-32 h-2 rounded-full bg-slate-700 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular-nums text-slate-300">{pct}%</span>
            <span className="text-slate-500 tabular-nums">{doneTotal}/{totalStitches}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        <div className="relative flex-1 min-w-0">
          <div ref={containerRef} className="absolute inset-0">
            <canvas
              ref={canvasRef}
              className="touch-none block"
              style={{ cursor: mode === "move" ? "grab" : "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            />
          </div>
          {loading && <div className="absolute inset-0 grid place-items-center text-slate-400">Loading chart…</div>}

          {/* Floating controls */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-slate-800/95 border border-slate-700 rounded-full px-1.5 py-1 shadow-lg">
            <button onClick={() => setMode("stitch")} className={`px-3 py-1.5 rounded-full text-sm font-medium ${mode === "stitch" ? "bg-emerald-700 text-white" : "text-slate-300 hover:bg-slate-700"}`} title="Tap cells to mark stitched">✓ Stitch</button>
            <button onClick={() => setMode("move")} className={`px-3 py-1.5 rounded-full text-sm font-medium ${mode === "move" ? "bg-sky-700 text-white" : "text-slate-300 hover:bg-slate-700"}`} title="Drag to pan">✋ Move</button>
            <span className="w-px h-5 bg-slate-600 mx-1" />
            <button onClick={() => { const c = containerRef.current!; zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1 / 1.2); }} className="w-8 h-8 rounded-full text-slate-300 hover:bg-slate-700 text-lg">−</button>
            <button onClick={() => { const c = containerRef.current!; zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1.2); }} className="w-8 h-8 rounded-full text-slate-300 hover:bg-slate-700 text-lg">+</button>
            <button onClick={() => { fitToView(); scheduleDraw(); }} className="px-2.5 py-1.5 rounded-full text-xs text-slate-300 hover:bg-slate-700">Fit</button>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-64 md:w-72 flex-shrink-0 bg-slate-800 border-l border-slate-700 flex flex-col">
          <div className="p-3 border-b border-slate-700 space-y-2">
            <div className="sm:hidden flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
              <span className="tabular-nums text-sm">{pct}%</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={isolate} onChange={(e) => setIsolate(e.target.checked)} /> Isolate color</label>
              <label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={showSymbols} onChange={(e) => setShowSymbols(e.target.checked)} /> Symbols</label>
            </div>
            <button onClick={() => setActiveColor(null)} className={`w-full text-left px-2 py-1.5 rounded text-sm ${activeColor === null ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-700/60"}`}>
              All colors {activeColor === null && <span className="text-slate-400">(tap any cell)</span>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {colors.map((c) => {
              const done = doneByColorRef.current[c.dmc] || 0;
              const complete = done >= c.total;
              const isActive = activeColor === c.dmc;
              return (
                <div key={c.dmc} className={`rounded-lg border ${isActive ? "border-emerald-600 bg-slate-700/60" : "border-transparent hover:bg-slate-700/40"}`}>
                  <button onClick={() => setActiveColor(isActive ? null : c.dmc)} className="w-full flex items-center gap-2 p-1.5 text-left">
                    <span className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: c.hex, color: textOn(c.hex) }}>{c.symbol}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-sm">
                        <span className="font-medium">{c.dmc}</span>
                        {complete && <span className="text-emerald-400 text-xs">✓</span>}
                      </span>
                      <span className="block text-[11px] text-slate-400 truncate">{c.name}</span>
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-400 flex-shrink-0">{done}/{c.total}</span>
                  </button>
                  <div className="flex items-center gap-1 px-1.5 pb-1.5">
                    <div className="flex-1 h-1 rounded-full bg-slate-600 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${c.total ? Math.round((done / c.total) * 100) : 0}%` }} /></div>
                    <button onClick={() => bulkColor(c.dmc, true)} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-800/70 hover:bg-emerald-700 text-emerald-200" title="Mark all done">all ✓</button>
                    <button onClick={() => bulkColor(c.dmc, false)} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-600 hover:bg-slate-500 text-slate-200" title="Clear this color">clear</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-2 border-t border-slate-700">
            <button onClick={resetAll} className="w-full text-xs py-1.5 rounded bg-red-900/50 hover:bg-red-900 text-red-300">Reset all progress</button>
            <p className="text-[10px] text-slate-500 mt-1.5 text-center">Progress saves on this device. In Stitch mode, drag to mark a row or area.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

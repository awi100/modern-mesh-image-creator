"use client";

import { useEffect, useState, useCallback } from "react";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";
import { mutApi } from "@/lib/mut-api";
import BufferPicker, { type Buffer } from "./BufferPicker";

/**
 * What still has to go in the tote — the shortfall only, nothing already at
 * target.
 *
 * One row per design, with its canvases and kits side by side. They are
 * different numbers for the same design (every sale needs a canvas, only a
 * "+ kit" sale needs a kit) and packing is done design by design, so splitting
 * them across two rows meant walking the list twice for one item. Supplies have
 * no such split and are a different job — restocking the tote's odds and ends
 * rather than its stock — so they sit in their own section, collapsed.
 */

type Kind = "kit" | "canvas" | "supply" | "other";

interface DesignStock { id: string; marketKits: number; marketCanvas: number; homeKits: number; homeCanvas: number; }
interface SupplyStock { id: string; market: number; home: number; }
interface PrepRow {
  name: string; kind: Kind; total: number; recommended: number; inTote: number | null;
  recommendedCanvas: number; recommendedKit: number;
  toteCanvas: number | null; toteKits: number | null;
  design: DesignStock | null; supply: SupplyStock | null;
}

/** One side of a design row. */
interface Side {
  what: "canvas" | "kit";
  need: number;
  have: number;
  gap: number;
  atHome: number;
}
interface DesignGap { row: PrepRow; canvas: Side; kit: Side; worst: number }
interface SupplyGap { row: PrepRow; need: number; have: number; gap: number; atHome: number }

export default function MarketToPack({
  buffer,
  onBufferChange,
  onMoved,
}: {
  buffer: Buffer;
  onBufferChange: (b: Buffer) => void;
  /** Stock moved home → tote; the host refreshes its own design list. */
  onMoved?: () => void;
}) {
  const [rows, setRows] = useState<PrepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSupplies, setShowSupplies] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/prep?buffer=${buffer}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setRows(data.rows ?? []);
      setError(null);
    } catch {
      setError("Couldn't load the market list.");
    } finally {
      setLoading(false);
    }
  }, [buffer]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useRefetchOnFocus(load);

  const designGaps: DesignGap[] = [];
  const supplyGaps: SupplyGap[] = [];
  for (const r of rows) {
    if (r.design) {
      const canvas: Side = {
        what: "canvas",
        need: r.recommendedCanvas,
        have: r.toteCanvas ?? 0,
        gap: Math.max(0, r.recommendedCanvas - (r.toteCanvas ?? 0)),
        atHome: r.design.homeCanvas,
      };
      const kit: Side = {
        what: "kit",
        need: r.recommendedKit,
        have: r.toteKits ?? 0,
        gap: Math.max(0, r.recommendedKit - (r.toteKits ?? 0)),
        atHome: r.design.homeKits,
      };
      // The row appears if EITHER side is short, and then shows both — being
      // told canvases are fine is part of knowing what to pack.
      if (canvas.gap > 0 || kit.gap > 0) {
        designGaps.push({ row: r, canvas, kit, worst: Math.max(canvas.gap, kit.gap) });
      }
    } else if (r.supply && r.inTote !== null && r.inTote < r.recommended) {
      supplyGaps.push({
        row: r, need: r.recommended, have: r.inTote,
        gap: r.recommended - r.inTote, atHome: r.supply.home,
      });
    }
  }
  designGaps.sort((a, b) => b.worst - a.worst || b.canvas.need - a.canvas.need);
  supplyGaps.sort((a, b) => b.gap - a.gap || b.need - a.need);

  const canvasGap = designGaps.reduce((s, g) => s + g.canvas.gap, 0);
  const kitGap = designGaps.reduce((s, g) => s + g.kit.gap, 0);
  const supplyGap = supplyGaps.reduce((s, g) => s + g.gap, 0);
  const nothingToPack = designGaps.length === 0 && supplyGaps.length === 0;

  // Home -> market. Both endpoints clamp to what's actually at home, so asking
  // for more than exists moves what there is instead of failing.
  const move = async (row: PrepRow, what: "kit" | "canvas" | "supply", qty: number) => {
    if (qty <= 0) return;
    const key = `${row.name}-${what}`;
    setBusy(key);
    try {
      const res = what === "supply"
        ? await mutApi(`/api/supplies/${row.supply!.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ marketTransferDelta: qty }),
          })
        : await mutApi(`/api/designs/${row.design!.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canvasMove: { kind: what, from: "home", to: "market", qty } }),
          });
      if (!res.ok) throw new Error("move failed");
      await load();
      onMoved?.();
    } catch {
      setError(`Couldn't move ${row.name}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="text-sm text-slate-400 mb-4">
        How many <span className="text-sky-300">canvases</span> and <span className="text-rose-300">kits</span> to pack,
        from current tote stock against the recommended count. Every sale needs a canvas; only a
        &ldquo;+ kit&rdquo; sale needs a kit, so the two are counted separately and never summed.
        Anything already at target is hidden. Sip-and-stitch days are excluded.
      </p>

      <BufferPicker value={buffer} onChange={onBufferChange} />

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/60 text-red-200 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-600 border-t-rose-500" />
        </div>
      ) : nothingToPack ? (
        <div className="bg-slate-800 rounded-xl border border-emerald-800/60 p-10 text-center">
          <p className="text-2xl font-bold text-emerald-400 mb-1">Tote is fully stocked</p>
          <p className="text-slate-400 text-sm">Every design and supply is at or above its target for the next market.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Canvases to pack</p>
              <p className="text-2xl font-bold text-sky-400">{canvasGap}</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Kits to pack</p>
              <p className="text-2xl font-bold text-rose-400">{kitGap}</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Supplies</p>
              <p className="text-2xl font-bold text-purple-400">{supplyGap}</p>
            </div>
          </div>

          {designGaps.length > 0 && (
            <div className="space-y-2 mb-6">
              {designGaps.map((g) => (
                <div key={g.row.name} className="bg-slate-800 rounded-xl border border-slate-700 p-3 md:p-4">
                  <p className="text-white font-medium mb-2 break-words">{g.row.name}</p>
                  <div className="grid grid-cols-2 gap-2 md:gap-3">
                    {[g.canvas, g.kit].map((side) => (
                      <SideCell
                        key={side.what}
                        side={side}
                        busy={busy === `${g.row.name}-${side.what}`}
                        disabled={busy !== null}
                        onMove={() => move(g.row, side.what, Math.min(side.gap, side.atHome))}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {supplyGaps.length > 0 && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <button
                onClick={() => setShowSupplies((s) => !s)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-700/40 transition-colors"
              >
                <span className="text-sm text-slate-300">
                  Supplies: <span className="text-purple-300 font-medium">{supplyGap} to pack</span>
                  <span className="text-slate-500"> across {supplyGaps.length} item{supplyGaps.length === 1 ? "" : "s"}</span>
                </span>
                <svg
                  className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${showSupplies ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showSupplies && (
                <div className="border-t border-slate-700 divide-y divide-slate-700/60">
                  {supplyGaps.map((g) => {
                    const key = `${g.row.name}-supply`;
                    const canMove = Math.min(g.gap, g.atHome);
                    return (
                      <div key={key} className="p-3 md:p-4 flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <span className="text-white font-medium break-words">{g.row.name}</span>
                          <p className="text-xs text-slate-400 mt-0.5">
                            need {g.need} · in tote <span className="text-emerald-400">{g.have}</span> · at home {g.atHome}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-2xl font-bold text-amber-400 leading-none">{g.gap}</p>
                          <p className="text-[10px] uppercase tracking-wider text-slate-500">to pack</p>
                        </div>
                        <div className="flex-shrink-0">
                          {g.atHome === 0 ? (
                            <span className="text-xs text-red-400">none at home</span>
                          ) : (
                            <MoveButton
                              label={`Move ${canMove}`}
                              busy={busy === key}
                              disabled={busy !== null}
                              onClick={() => move(g.row, "supply", canMove)}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One half of a design row: canvases or kits, never the two added together. */
function SideCell({
  side, busy, disabled, onMove,
}: {
  side: Side; busy: boolean; disabled: boolean; onMove: () => void;
}) {
  const label = side.what === "canvas" ? "Canvas" : "Kits";
  const tone = side.what === "canvas"
    ? { text: "text-sky-300", border: "border-sky-900/60" }
    : { text: "text-rose-300", border: "border-rose-900/60" };
  const canMove = Math.min(side.gap, side.atHome);

  if (side.need === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
        <p className={`text-[10px] uppercase tracking-wider ${tone.text}`}>{label}</p>
        <p className="text-sm text-slate-500 mt-1">none needed</p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-2.5 ${side.gap > 0 ? `bg-slate-900/40 ${tone.border}` : "bg-slate-900/20 border-slate-700"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={`text-[10px] uppercase tracking-wider ${tone.text}`}>{label}</p>
        {side.gap > 0 ? (
          <p className="text-xl font-bold text-amber-400 leading-none">
            +{side.gap}
          </p>
        ) : (
          <p className="text-xs font-medium text-emerald-400">at target</p>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-1">
        <span className={side.have >= side.need ? "text-emerald-400" : "text-white"}>{side.have}</span>
        <span className="text-slate-500"> / {side.need} packed · {side.atHome} home</span>
      </p>
      {side.gap > 0 && (
        <div className="mt-2">
          {side.atHome === 0 ? (
            <span className="text-xs text-red-400">none at home</span>
          ) : (
            <MoveButton label={`Move ${canMove}`} busy={busy} disabled={disabled} onClick={onMove} />
          )}
        </div>
      )}
    </div>
  );
}

function MoveButton({ label, onClick, disabled, busy }: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled || busy}
      className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-35 disabled:cursor-not-allowed">
      {busy ? "Moving…" : label}
    </button>
  );
}

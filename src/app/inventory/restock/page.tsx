"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { meshBadgeClassLight } from "@/lib/mesh-badge";

// On-hand (Here + Market) below this = low, restock from Andover.
const LOW_ON_HAND = 20;
const RESTOCK_TARGET = 30;

interface Design {
  id: string;
  name: string;
  meshCount: number;
  previewImageUrl: string | null;
  isDraft: boolean;
  canvasPrinted: number;
  marketCanvasPrinted: number;
  canvasAndover: number;
}

export default function RestockPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [restocking, setRestocking] = useState<string | null>(null);

  const fetchDesigns = useCallback(async () => {
    try {
      const res = await fetch("/api/designs");
      if (res.ok) {
        const data = await res.json();
        setDesigns(data.filter((d: Design) => !d.isDraft));
      }
    } catch (e) {
      console.error("Failed to load designs:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDesigns(); }, [fetchDesigns]);

  // Refresh when returning to the tab so sales elsewhere are reflected.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchDesigns(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchDesigns]);

  const onHand = (d: Design) => d.canvasPrinted + (d.marketCanvasPrinted || 0);

  const lowDesigns = useMemo(
    () => designs.filter((d) => onHand(d) < LOW_ON_HAND).sort((a, b) => onHand(a) - onHand(b)),
    [designs]
  );

  const restock = async (d: Design, qty: number) => {
    if (qty <= 0) return;
    setRestocking(d.id);
    // Optimistic: move from Andover to home
    setDesigns((prev) => prev.map((x) => x.id === d.id
      ? { ...x, canvasAndover: x.canvasAndover - qty, canvasPrinted: x.canvasPrinted + qty }
      : x));
    try {
      const res = await fetch(`/api/designs/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ andoverTransferDelta: qty }),
      });
      if (!res.ok) await fetchDesigns();
    } catch (e) {
      console.error("Restock failed:", e);
      await fetchDesigns();
    }
    setRestocking(null);
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-4xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <h1 className="text-white font-semibold">Canvas Restock</h1>
          <Link href="/inventory" className="text-sm text-slate-400 hover:text-white">← Inventory</Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Restock" }]} className="mb-4" />

        <p className="text-sm text-slate-400 mb-5">
          Designs with fewer than <span className="text-white font-medium">{LOW_ON_HAND}</span> canvases on hand
          (Here + Market). Pull more from your <span className="text-sky-400">Andover</span> storage — the button tops
          you up toward {RESTOCK_TARGET}.
        </p>

        {loading ? (
          <div className="text-slate-400 py-12 text-center">Loading…</div>
        ) : lowDesigns.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-emerald-800/50 p-8 text-center">
            <p className="text-emerald-300 font-medium">All designs are stocked</p>
            <p className="text-slate-400 text-sm mt-1">Nothing is below {LOW_ON_HAND} on hand right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lowDesigns.map((d) => {
              const oh = onHand(d);
              const suggested = Math.min(d.canvasAndover, Math.max(0, RESTOCK_TARGET - oh));
              const moveQty = suggested > 0 ? suggested : d.canvasAndover;
              return (
                <div key={d.id} className="bg-slate-800 rounded-xl border border-slate-700 p-3 md:p-4 flex items-center gap-3 md:gap-4">
                  <Link href={`/design/${d.id}/info`} className="flex-shrink-0">
                    {d.previewImageUrl ? (
                      <img src={d.previewImageUrl} alt="" className="w-11 h-11 rounded-lg object-cover border border-slate-600" />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-slate-700 border border-slate-600" />
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/design/${d.id}/info`} className="text-white font-medium truncate hover:text-rose-400">{d.name}</Link>
                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${meshBadgeClassLight(d.meshCount)}`}>{d.meshCount}ct</span>
                    </div>
                    <p className="text-xs mt-0.5">
                      <span className="text-red-400 font-semibold">{oh}</span>
                      <span className="text-slate-500"> on hand ({d.canvasPrinted} here · {d.marketCanvasPrinted} market)</span>
                      <span className="text-sky-400"> · {d.canvasAndover} @ Andover</span>
                    </p>
                  </div>
                  {d.canvasAndover > 0 ? (
                    <button
                      onClick={() => restock(d, moveQty)}
                      disabled={restocking === d.id}
                      className="px-3 py-2 text-sm font-medium bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg whitespace-nowrap flex-shrink-0"
                      title={`Move ${moveQty} from Andover to home`}
                    >
                      {restocking === d.id ? "Moving…" : `Restock ${moveQty} → Home`}
                    </button>
                  ) : (
                    <span className="px-3 py-2 text-sm text-amber-400 whitespace-nowrap flex-shrink-0">Order more — none at Andover</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

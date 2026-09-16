"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import { meshBadgeClassLight } from "@/lib/mesh-badge";
import { invalidateInventory } from "@/lib/invalidate-inventory";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";

// On-hand (Home + Market tote) target. We suggest picking up enough from Andover
// to bring on-hand up to this; below LOW it's flagged urgent.
const TARGET = 30;
const LOW = 20;

interface Design {
  id: string;
  name: string;
  meshCount: number;
  previewImageUrl: string | null;
  isDraft: boolean;
  archivedAt: string | null;
  canvasPrinted: number;
  marketCanvasPrinted: number;
  canvasAndover: number;
  kitsReady: number;
  marketKitsReady: number;
  kitsAndover: number;
}

type Kind = "canvas" | "kit";

// On a successful move, invalidate every page's SWR cache so counts update
// everywhere immediately.
async function mutApi(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.ok) invalidateInventory();
  return res;
}

export default function AndoverPickupPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [pickupQty, setPickupQty] = useState<Record<string, string>>({});

  const fetchDesigns = useCallback(async () => {
    try {
      const res = await fetch("/api/designs");
      if (res.ok) {
        const data: Design[] = await res.json();
        setDesigns(data.filter((d) => !d.isDraft && !d.archivedAt));
      }
    } catch (e) {
      console.error("Failed to load designs:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDesigns();
  }, [fetchDesigns]);
  useRefetchOnFocus(fetchDesigns);

  const onHand = (d: Design, kind: Kind) =>
    kind === "canvas" ? d.canvasPrinted + (d.marketCanvasPrinted || 0) : d.kitsReady + (d.marketKitsReady || 0);
  const atAndover = (d: Design, kind: Kind) => (kind === "canvas" ? d.canvasAndover || 0 : d.kitsAndover || 0);
  const suggested = (d: Design, kind: Kind) => Math.min(atAndover(d, kind), Math.max(0, TARGET - onHand(d, kind)));

  const buildRows = useCallback(
    (kind: Kind) =>
      designs
        .filter((d) => atAndover(d, kind) > 0)
        .filter((d) => showAll || suggested(d, kind) > 0)
        .map((d) => ({ d, onHand: onHand(d, kind), andover: atAndover(d, kind), suggest: suggested(d, kind) }))
        .sort((a, b) => b.suggest - a.suggest || a.onHand - b.onHand),
    [designs, showAll],
  );

  const canvasRows = useMemo(() => buildRows("canvas"), [buildRows]);
  const kitRows = useMemo(() => buildRows("kit"), [buildRows]);

  const qtyFor = (id: string, kind: Kind, suggest: number, max: number) => {
    const raw = pickupQty[`${id}-${kind}`];
    if (raw === undefined || raw === "") return suggest;
    return Math.max(0, Math.min(max, parseInt(raw, 10) || 0));
  };

  const setQty = (id: string, kind: Kind, value: string) =>
    setPickupQty((p) => ({ ...p, [`${id}-${kind}`]: value }));

  const pickup = async (d: Design, kind: Kind, qty: number) => {
    if (qty <= 0) return;
    const key = `${d.id}-${kind}`;
    setMoving(key);
    // Optimistic: move Andover -> home
    setDesigns((prev) =>
      prev.map((x) =>
        x.id !== d.id
          ? x
          : kind === "canvas"
            ? { ...x, canvasAndover: x.canvasAndover - qty, canvasPrinted: x.canvasPrinted + qty }
            : { ...x, kitsAndover: x.kitsAndover - qty, kitsReady: x.kitsReady + qty },
      ),
    );
    setPickupQty((p) => {
      const n = { ...p };
      delete n[key];
      return n;
    });
    try {
      const res = await mutApi(`/api/designs/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasMove: { kind, from: "andover", to: "home", qty } }),
      });
      if (!res.ok) await fetchDesigns();
    } catch {
      await fetchDesigns();
    }
    setMoving(null);
  };

  const pickupAll = async (kind: Kind, rows: { d: Design; suggest: number; andover: number }[]) => {
    for (const r of rows) {
      const q = qtyFor(r.d.id, kind, r.suggest, r.andover);
      if (q > 0) await pickup(r.d, kind, q);
    }
  };

  const totalFor = (kind: Kind, rows: { d: Design; suggest: number; andover: number }[]) =>
    rows.reduce((s, r) => s + qtyFor(r.d.id, kind, r.suggest, r.andover), 0);

  const canvasTotal = totalFor("canvas", canvasRows);
  const kitTotal = totalFor("kit", kitRows);

  const renderSection = (
    kind: Kind,
    label: string,
    rows: { d: Design; onHand: number; andover: number; suggest: number }[],
    accent: string,
  ) => (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="p-4 border-b border-slate-700 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">{label}</h2>
          <span className="text-xs text-slate-400">
            {rows.length} design{rows.length !== 1 ? "s" : ""} · {totalFor(kind, rows)} to grab
          </span>
        </div>
        {rows.some((r) => qtyFor(r.d.id, kind, r.suggest, r.andover) > 0) && (
          <button
            onClick={() => pickupAll(kind, rows)}
            disabled={moving !== null}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg ${accent} disabled:opacity-50`}
          >
            Mark all picked up
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">
          {showAll ? `Nothing in Andover ${label.toLowerCase()}.` : `Nothing to pick up — on-hand ${label.toLowerCase()} are all topped up.`}
        </div>
      ) : (
        <div className="divide-y divide-slate-700/50">
          {rows.map(({ d, onHand: oh, andover, suggest }) => {
            const key = `${d.id}-${kind}`;
            const qty = qtyFor(d.id, kind, suggest, andover);
            const isMoving = moving === key;
            const urgent = oh < LOW;
            return (
              <div key={key} className="p-3 flex items-center gap-3">
                {d.previewImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.previewImageUrl} alt="" className="w-11 h-11 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded bg-slate-700 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/design/${d.id}/kit`} className="text-white text-sm font-medium truncate hover:text-rose-400">
                      {d.name}
                    </Link>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${meshBadgeClassLight(d.meshCount)}`}>
                      {d.meshCount}ct
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    <span className={urgent ? "text-red-400 font-medium" : ""}>{oh} on hand</span>
                    {" · "}
                    <span className="text-sky-400">{andover} at Andover</span>
                  </p>
                </div>
                <div className="text-center">
                  <input
                    type="number"
                    min={0}
                    max={andover}
                    value={pickupQty[key] ?? suggest}
                    onChange={(e) => setQty(d.id, kind, e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="w-14 px-1 py-1 bg-slate-900 border border-slate-600 rounded text-center text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <p className="text-[10px] text-slate-500">grab</p>
                </div>
                <button
                  onClick={() => pickup(d, kind, qty)}
                  disabled={isMoving || qty <= 0}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 flex-shrink-0"
                >
                  {isMoving ? "…" : "Picked up"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <SectionNav />
        </div>
      </header>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Andover Pickup" }]} />

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">Andover Pickup</h1>
            <p className="text-sm text-slate-400 mt-1">
              What to grab from Andover to restock your on-hand stock (Home + Market) toward {TARGET}.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-emerald-600" />
            Show everything at Andover
          </label>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Canvases to grab</p>
            <p className="text-2xl font-bold text-white">{canvasTotal}<span className="text-sm text-slate-500 font-normal"> across {canvasRows.length}</span></p>
          </div>
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Kits to grab</p>
            <p className="text-2xl font-bold text-white">{kitTotal}<span className="text-sm text-slate-500 font-normal"> across {kitRows.length}</span></p>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading…</div>
        ) : (
          <>
            {renderSection("canvas", "Canvases", canvasRows, "bg-sky-600 text-white hover:bg-sky-700")}
            {renderSection("kit", "Kits", kitRows, "bg-emerald-600 text-white hover:bg-emerald-700")}
            <p className="text-xs text-slate-500">
              Marking something &ldquo;picked up&rdquo; moves it from Andover into your Home stock. Supplies (project bags,
              scissors, needle minders) aren&rsquo;t location-tracked at Andover yet — ask to add that if you store bulk
              supplies there too.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import { meshBadgeClassLight } from "@/lib/mesh-badge";
import { invalidateInventory } from "@/lib/invalidate-inventory";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";

import { TARGET_FOR, suggestPickup, isLowOnHand, type StockKind } from "@/lib/stock-targets";

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

interface Supply {
  id: string;
  name: string;
  quantity: number;
  marketQuantity: number;
  andoverQuantity: number;
}

type Section = "canvas" | "kit" | "supply";

interface Row {
  key: string;
  id: string;
  section: Section;
  name: string;
  previewImageUrl: string | null;
  meshCount: number | null;
  onHand: number;
  andover: number;
  suggest: number;
}

async function mutApi(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.ok) invalidateInventory();
  return res;
}

// Per-kind: canvases/kits top up toward 30, supplies have no universal target
// (you might keep 3 project bags at home and 200 at Andover), so they list
// whenever there's Andover stock and you type the quantity.
const suggestQty = (kind: StockKind, andover: number, onHand: number) => suggestPickup(kind, andover, onHand);

export default function AndoverPickupPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [qtyOverride, setQtyOverride] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    try {
      const [dr, sr] = await Promise.all([fetch("/api/designs"), fetch("/api/supplies")]);
      if (dr.ok) {
        const d: Design[] = await dr.json();
        setDesigns(d.filter((x) => !x.isDraft && !x.archivedAt));
      }
      if (sr.ok) setSupplies(await sr.json());
    } catch (e) {
      console.error("Failed to load Andover data:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  useRefetchOnFocus(fetchData);

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = [];
    for (const d of designs) {
      const cOn = d.canvasPrinted + (d.marketCanvasPrinted || 0);
      if ((d.canvasAndover || 0) > 0)
        rows.push({ key: `${d.id}-canvas`, id: d.id, section: "canvas", name: d.name, previewImageUrl: d.previewImageUrl, meshCount: d.meshCount, onHand: cOn, andover: d.canvasAndover, suggest: suggestQty("canvas", d.canvasAndover, cOn) });
      const kOn = d.kitsReady + (d.marketKitsReady || 0);
      if ((d.kitsAndover || 0) > 0)
        rows.push({ key: `${d.id}-kit`, id: d.id, section: "kit", name: d.name, previewImageUrl: d.previewImageUrl, meshCount: d.meshCount, onHand: kOn, andover: d.kitsAndover, suggest: suggestQty("kit", d.kitsAndover, kOn) });
    }
    for (const s of supplies) {
      const on = s.quantity + (s.marketQuantity || 0);
      if ((s.andoverQuantity || 0) > 0)
        rows.push({ key: `${s.id}-supply`, id: s.id, section: "supply", name: s.name, previewImageUrl: null, meshCount: null, onHand: on, andover: s.andoverQuantity, suggest: suggestQty("supply", s.andoverQuantity, on) });
    }
    return rows;
  }, [designs, supplies]);

  const sectionRows = useCallback(
    (section: Section) =>
      allRows
        .filter((r) => r.section === section)
        // Supplies have no target, so they'd never pass a suggest>0 filter —
        // list them whenever there is stock at Andover and let the user type a qty.
        .filter((r) => showAll || r.suggest > 0 || r.section === "supply")
        .sort((a, b) => b.suggest - a.suggest || a.onHand - b.onHand),
    [allRows, showAll],
  );

  const canvasRows = useMemo(() => sectionRows("canvas"), [sectionRows]);
  const kitRows = useMemo(() => sectionRows("kit"), [sectionRows]);
  const supplyRows = useMemo(() => sectionRows("supply"), [sectionRows]);

  const qtyFor = (r: Row) => {
    const raw = qtyOverride[r.key];
    if (raw === undefined) return r.suggest;
    if (raw === "") return 0; // cleared box means 0, not "use the suggestion"
    return Math.max(0, Math.min(r.andover, parseInt(raw, 10) || 0));
  };

  const pickup = async (r: Row, qty: number) => {
    if (qty <= 0) return;
    setMoving(r.key);
    // Optimistic move Andover -> home
    if (r.section === "supply") {
      setSupplies((prev) => prev.map((s) => (s.id === r.id ? { ...s, andoverQuantity: s.andoverQuantity - qty, quantity: s.quantity + qty } : s)));
    } else {
      setDesigns((prev) =>
        prev.map((d) =>
          d.id !== r.id
            ? d
            : r.section === "canvas"
              ? { ...d, canvasAndover: d.canvasAndover - qty, canvasPrinted: d.canvasPrinted + qty }
              : { ...d, kitsAndover: d.kitsAndover - qty, kitsReady: d.kitsReady + qty },
        ),
      );
    }
    setQtyOverride((p) => {
      const n = { ...p };
      delete n[r.key];
      return n;
    });
    try {
      const res =
        r.section === "supply"
          ? await mutApi(`/api/supplies/${r.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ andoverTransferDelta: qty }),
            })
          : await mutApi(`/api/designs/${r.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ canvasMove: { kind: r.section, from: "andover", to: "home", qty } }),
            });
      if (!res.ok) await fetchData();
    } catch {
      await fetchData();
    }
    setMoving(null);
  };

  const pickupAll = async (rows: Row[], label: string) => {
    // Moving stock is irreversible from here (you'd have to move it back by
    // hand), so a bulk move gets a confirm — every other irreversible action in
    // the app does. Snapshot the quantities first so a mid-loop refetch can't
    // change what we're applying.
    const work = rows.map((r) => ({ r, q: qtyFor(r) })).filter((x) => x.q > 0);
    if (work.length === 0) return;
    const total = work.reduce((s, x) => s + x.q, 0);
    if (!confirm(`Move ${total} ${label.toLowerCase()} from Andover to Home, across ${work.length} item${work.length === 1 ? "" : "s"}?`)) return;
    for (const { r, q } of work) await pickup(r, q);
  };

  const totalFor = (rows: Row[]) => rows.reduce((s, r) => s + qtyFor(r), 0);

  const renderSection = (label: string, rows: Row[], accentBtn: string) => (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="p-4 border-b border-slate-700 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">{label}</h2>
          <span className="text-xs text-slate-400">
            {rows.length} item{rows.length !== 1 ? "s" : ""} · {totalFor(rows)} to grab
          </span>
        </div>
        {rows.some((r) => qtyFor(r) > 0) && (
          <button onClick={() => pickupAll(rows, label)} disabled={moving !== null} className={`text-xs font-medium px-3 py-1.5 rounded-lg ${accentBtn} disabled:opacity-50`}>
            Mark all picked up
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">
          {showAll ? `Nothing in Andover for ${label.toLowerCase()}.` : `Nothing to pick up — on-hand ${label.toLowerCase()} are all topped up.`}
        </div>
      ) : (
        <div className="divide-y divide-slate-700/50">
          {rows.map((r) => {
            const qty = qtyFor(r);
            const isMoving = moving === r.key;
            const urgent = isLowOnHand(r.section, r.onHand);
            return (
              <div key={r.key} className="p-3 flex items-center gap-3">
                {r.previewImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.previewImageUrl} alt="" className="w-11 h-11 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded bg-purple-900/30 border border-purple-700/40 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {r.section === "supply" ? (
                      <span className="text-white text-sm font-medium truncate">{r.name}</span>
                    ) : (
                      <Link href={`/design/${r.id}/kit`} className="text-white text-sm font-medium truncate hover:text-rose-400">
                        {r.name}
                      </Link>
                    )}
                    {r.meshCount != null && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${meshBadgeClassLight(r.meshCount)}`}>{r.meshCount}ct</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    <span className={urgent ? "text-red-400 font-medium" : ""}>{r.onHand} on hand</span>
                    {" · "}
                    <span className="text-sky-400">{r.andover} at Andover</span>
                  </p>
                </div>
                <div className="text-center">
                  <input
                    type="number"
                    min={0}
                    max={r.andover}
                    value={qtyOverride[r.key] ?? r.suggest}
                    onChange={(e) => setQtyOverride((p) => ({ ...p, [r.key]: e.target.value }))}
                    onFocus={(e) => e.target.select()}
                    className="w-14 px-1 py-1 bg-slate-900 border border-slate-600 rounded text-center text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <p className="text-[10px] text-slate-500">grab</p>
                </div>
                <button onClick={() => pickup(r, qty)} disabled={isMoving || qty <= 0} className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 flex-shrink-0">
                  {isMoving ? "…" : "Picked up"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const card = (title: string, rows: Row[]) => (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <p className="text-xs uppercase tracking-wider text-slate-400">{title}</p>
      <p className="text-2xl font-bold text-white">
        {totalFor(rows)}
        <span className="text-sm text-slate-500 font-normal"> across {rows.length}</span>
      </p>
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
              What to grab from Andover to restock your on-hand stock (Home + Market) toward {TARGET_FOR.canvas}.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-emerald-600" />
            Show everything at Andover
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {card("Canvases", canvasRows)}
          {card("Kits", kitRows)}
          {card("Supplies", supplyRows)}
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading…</div>
        ) : (
          <>
            {renderSection("Canvases", canvasRows, "bg-sky-600 text-white hover:bg-sky-700")}
            {renderSection("Kits", kitRows, "bg-emerald-600 text-white hover:bg-emerald-700")}
            {renderSection("Supplies", supplyRows, "bg-purple-600 text-white hover:bg-purple-700")}
            <p className="text-xs text-slate-500">
              &ldquo;Picked up&rdquo; moves stock from Andover into your Home count. Set how much of each supply is at Andover
              on the Inventory → Supplies tab (the sky &ldquo;Andover&rdquo; field).
            </p>
          </>
        )}
      </div>
    </div>
  );
}

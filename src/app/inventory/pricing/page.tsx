"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";

interface Settings {
  skeinCost: number; kitHardwareCost: number; canvasPackCost: number; orderPackCost: number;
  shippingLabelCost: number; shippingCollected: number; feePercent: number; feeFixed: number;
  cacPerOrder: number; targetNetMargin: number; kitAttachMargin: number;
  canvasCostXS: number; canvasCostSmall: number; canvasCostMedium: number; canvasCostLarge: number; canvasCostXL: number;
  xsMaxArea: number; smallMaxArea: number; mediumMaxArea: number; largeMaxArea: number; roundTo: number;
  introPrice: number;
  priceCanvasXS: number; priceKitXS: number; priceCanvasSmall: number; priceKitSmall: number;
  priceCanvasMedium: number; priceKitMedium: number; priceCanvasLarge: number; priceKitLarge: number;
  priceCanvasXL: number; priceKitXL: number;
}
interface Row {
  id: string; name: string; meshCount: number; width: number; height: number; area: number;
  tier: string; yards: number; threadCost: number; canvasCogs: number; kitVerCogs: number;
  recCanvas: number; recKit: number; netKitAfterCac: number; netKitMarginPct: number;
  setCanvas: number; setKit: number; netKitAtSet: number; netKitAtSetPct: number; computed: boolean;
}
interface TierRow {
  tier: string; count: number; canvasCogs: number; recCanvas: number; kitCogsMin: number; kitCogsMax: number;
  recKitMin: number; recKitMax: number; setCanvas: number; setKit: number; setMarginMin: number; setMarginMax: number;
}

// Our chosen selling prices, edited in the headline table (keys on Settings).
const PRICE_ROWS: { tier: string; single?: keyof Settings; canvas?: keyof Settings; kit?: keyof Settings }[] = [
  { tier: "Intro", single: "introPrice" },
  { tier: "XS", canvas: "priceCanvasXS", kit: "priceKitXS" },
  { tier: "Small", canvas: "priceCanvasSmall", kit: "priceKitSmall" },
  { tier: "Medium", canvas: "priceCanvasMedium", kit: "priceKitMedium" },
  { tier: "Large", canvas: "priceCanvasLarge", kit: "priceKitLarge" },
  { tier: "XL", canvas: "priceCanvasXL", kit: "priceKitXL" },
];
const PRICE_KEYS = PRICE_ROWS.flatMap((r) => [r.single, r.canvas, r.kit].filter(Boolean) as (keyof Settings)[]);

// field key, label, kind. percent fields are stored 0-1 but edited as 0-100.
const FIELDS: { key: keyof Settings; label: string; kind: "money" | "percent" | "int"; group: string }[] = [
  { key: "skeinCost", label: "Skein cost", kind: "money", group: "Thread & kit" },
  { key: "kitHardwareCost", label: "Kit hardware (needles, threader, bags)", kind: "money", group: "Thread & kit" },
  { key: "canvasPackCost", label: "Canvas bag + tape", kind: "money", group: "Canvas & packaging" },
  { key: "canvasCostXS", label: "Canvas cost — Extra Small", kind: "money", group: "Canvas & packaging" },
  { key: "canvasCostSmall", label: "Canvas cost — Small/Intro", kind: "money", group: "Canvas & packaging" },
  { key: "canvasCostMedium", label: "Canvas cost — Medium", kind: "money", group: "Canvas & packaging" },
  { key: "canvasCostLarge", label: "Canvas cost — Large", kind: "money", group: "Canvas & packaging" },
  { key: "canvasCostXL", label: "Canvas cost — XL", kind: "money", group: "Canvas & packaging" },
  { key: "orderPackCost", label: "Order packaging", kind: "money", group: "Per order" },
  { key: "shippingLabelCost", label: "Shipping label", kind: "money", group: "Per order" },
  { key: "shippingCollected", label: "Shipping collected", kind: "money", group: "Per order" },
  { key: "feePercent", label: "Payment fee %", kind: "percent", group: "Per order" },
  { key: "feeFixed", label: "Payment fee (flat)", kind: "money", group: "Per order" },
  { key: "cacPerOrder", label: "Ad cost per order (CAC)", kind: "money", group: "Per order" },
  { key: "targetNetMargin", label: "Target NET margin (after ads) %", kind: "percent", group: "Targets" },
  { key: "kitAttachMargin", label: "Kit upcharge margin %", kind: "percent", group: "Targets" },
  { key: "roundTo", label: "Round prices up to $", kind: "int", group: "Targets" },
  { key: "xsMaxArea", label: "Extra Small max area (in²)", kind: "int", group: "Size cutoffs" },
  { key: "smallMaxArea", label: "Small max area (in²)", kind: "int", group: "Size cutoffs" },
  { key: "mediumMaxArea", label: "Medium max area (in²)", kind: "int", group: "Size cutoffs" },
  { key: "largeMaxArea", label: "Large max area (in²)", kind: "int", group: "Size cutoffs" },
];
const GROUPS = ["Thread & kit", "Canvas & packaging", "Per order", "Targets", "Size cutoffs"];
const TIER_ORDER = ["Intro", "XS", "Small", "Medium", "Large", "XL"];

export default function PricingPage() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [tierSummary, setTierSummary] = useState<TierRow[]>([]);
  const [needsBackfill, setNeedsBackfill] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meshFilter, setMeshFilter] = useState<"all" | "18" | "13">("all");
  const [search, setSearch] = useState("");
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(new Set());

  const toggleTier = (t: string) => setExpandedTiers((prev) => {
    const next = new Set(prev);
    next.has(t) ? next.delete(t) : next.add(t);
    return next;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pricing");
      if (res.ok) {
        const d = await res.json();
        setSettings(d.settings);
        setRows(d.rows || []);
        setTierSummary(d.tierSummary || []);
        setNeedsBackfill(d.needsBackfill || []);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // seed draft when settings load
  useEffect(() => {
    if (!settings) return;
    const d: Record<string, string> = {};
    for (const f of FIELDS) d[f.key] = f.kind === "percent" ? String(Math.round((settings[f.key] as number) * 1000) / 10) : String(settings[f.key]);
    for (const k of PRICE_KEYS) d[k] = String(settings[k]);
    setDraft(d);
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, number> = {};
      for (const f of FIELDS) {
        const v = Number(draft[f.key]);
        payload[f.key] = f.kind === "percent" ? v / 100 : v;
      }
      for (const k of PRICE_KEYS) payload[k] = Number(draft[k]);
      const res = await fetch("/api/pricing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Save failed"); }
      showToast("Assumptions saved — prices recalculated", "success");
      await load();
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed to save", "error"); }
    setSaving(false);
  };

  const visible = useMemo(() => {
    let r = rows;
    if (meshFilter !== "all") r = r.filter((x) => String(x.meshCount) === meshFilter);
    if (search.trim()) r = r.filter((x) => x.name.toLowerCase().includes(search.toLowerCase()));
    return [...r].sort((a, b) => (TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)) || a.area - b.area);
  }, [rows, meshFilter, search]);

  const copyCsv = () => {
    const head = ["design", "mesh", "size", "area", "tier", "thread_cost", "canvas_cogs", "kit_cogs", "our_canvas_price", "our_kit_price", "net_at_kit", "net_at_kit_pct", "rec_canvas_price", "rec_kit_price"];
    const lines = rows.map((r) => [r.name, r.meshCount + "ct", `${r.width}x${r.height}`, r.area, r.tier, r.threadCost, r.canvasCogs, r.kitVerCogs, r.setCanvas, r.setKit, r.netKitAtSet, r.netKitAtSetPct, r.recCanvas, r.recKit]
      .map((v) => { const s = String(v); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","));
    navigator.clipboard.writeText([head.join(","), ...lines].join("\n"));
    showToast("Pricing CSV copied", "success");
  };

  const money = (n: number) => `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-6xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-6xl mx-auto px-3 md:px-4 py-3 md:py-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-white font-semibold text-lg">Pricing</h1>
          <div className="flex items-center gap-2">
            <button onClick={copyCsv} disabled={!rows.length} className="px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg">Copy CSV</button>
            <Link href="/inventory" className="text-sm text-slate-400 hover:text-white">← Inventory</Link>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Pricing" }]} className="mb-4" />
        <p className="text-sm text-slate-400 mb-4">
          Cost-up prices from each design&apos;s real thread usage + your cost assumptions. The{" "}
          <span className="text-white">canvas price</span> carries the full per-order ad cost and hits your target
          net margin; the <span className="text-white">+kit price</span> adds an attach upcharge on the extra thread
          (no extra ad cost). <span className="text-white">Net/order</span> is what&apos;s left on a single-item,
          ad-driven kit order after everything. All editable in Assumptions.
        </p>

        {/* Our prices — the decided, live selling prices */}
        {settings && (
          <div className="mb-6 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-700">
              <div>
                <h2 className="text-white font-semibold">Our prices</h2>
                <p className="text-xs text-slate-400">The prices we sell at. Edit and Save; the margin column recalcs from real per-design costs.</p>
              </div>
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium bg-rose-900 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg">{saving ? "Saving…" : "Save prices"}</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/60 text-slate-400">
                  <tr>
                    <th className="text-left p-3">Tier</th>
                    <th className="text-right p-3">Canvas</th>
                    <th className="text-right p-3">+ Kit</th>
                    <th className="text-right p-3"># Designs</th>
                    <th className="text-right p-3">Net/order @ kit</th>
                  </tr>
                </thead>
                <tbody>
                  {PRICE_ROWS.map((pr) => {
                    const ts = tierSummary.find((t) => t.tier === pr.tier);
                    const priceInput = (key: keyof Settings) => (
                      <div className="inline-flex items-center gap-1 justify-end">
                        <span className="text-slate-500">$</span>
                        <input type="number" step="any" value={draft[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                          className="w-20 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-white text-sm text-right" />
                      </div>
                    );
                    const mMin = ts?.setMarginMin, mMax = ts?.setMarginMax;
                    const marginColor = mMin === undefined ? "text-slate-500" : mMin < 20 ? "text-red-400" : mMin < 30 ? "text-amber-400" : "text-emerald-400";
                    return (
                      <tr key={pr.tier} className="border-t border-slate-700/60">
                        <td className="p-3 text-white font-medium">{pr.tier}{pr.single && <span className="text-slate-500 text-xs ml-1">(kit only)</span>}</td>
                        <td className="p-3 text-right">{pr.single ? <span className="text-slate-600">—</span> : priceInput(pr.canvas!)}</td>
                        <td className="p-3 text-right">{pr.single ? priceInput(pr.single) : priceInput(pr.kit!)}</td>
                        <td className="p-3 text-right text-slate-400">{ts ? ts.count : <span className="text-slate-600">0</span>}</td>
                        <td className={`p-3 text-right ${marginColor}`}>
                          {mMin === undefined ? "—" : `${mMin}${mMax !== mMin ? `–${mMax}` : ""}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-700/60">
              Net/order @ kit = what&apos;s left after COGS, payment fees, packaging, shipping shortfall, and the full ${settings.cacPerOrder} ad cost per order — for a single-item order at the kit price. Green ≥30%, amber ≥20%, red below.
            </p>
          </div>
        )}

        {/* Assumptions */}
        <div className="mb-5 bg-slate-800 rounded-xl border border-slate-700">
          <button onClick={() => setShowAssumptions((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
            <span className="text-white font-medium">Assumptions {settings && <span className="text-slate-400 text-sm font-normal">· target {Math.round(settings.targetNetMargin * 100)}% net · ${settings.skeinCost}/skein · ${settings.cacPerOrder} CAC</span>}</span>
            <span className="text-slate-400">{showAssumptions ? "▲" : "▼"}</span>
          </button>
          {showAssumptions && settings && (
            <div className="px-4 pb-4 space-y-4">
              {GROUPS.map((grp) => (
                <div key={grp}>
                  <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">{grp}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {FIELDS.filter((f) => f.group === grp).map((f) => (
                      <label key={f.key} className="block">
                        <span className="text-xs text-slate-400 block mb-1">{f.label}{f.kind === "percent" ? " (%)" : ""}</span>
                        <input type="number" step="any" value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                          className="w-full px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-white text-sm" />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium bg-rose-900 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg">{saving ? "Saving…" : "Save & recalc"}</button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-slate-400 py-12 text-center">Loading…</div>
        ) : (
          <>
            {/* Tier summary */}
            <h2 className="text-white font-semibold mb-2">Model recommendation by tier <span className="text-slate-500 text-sm font-normal">(advisory)</span></h2>
            <p className="text-xs text-slate-500 mb-2">What the cost model would charge to hit your margin targets — compare against Our prices above. Click a tier to see the designs in it.</p>
            <div className="overflow-x-auto mb-6 rounded-xl border border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="text-left p-3">Tier</th><th className="text-right p-3">Designs</th>
                    <th className="text-right p-3">Canvas COGS</th><th className="text-right p-3">Rec. canvas price</th>
                    <th className="text-right p-3">Kit COGS</th><th className="text-right p-3">Rec. kit price</th>
                  </tr>
                </thead>
                <tbody>
                  {tierSummary.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)).map((t) => {
                    const open = expandedTiers.has(t.tier);
                    const designs = rows.filter((r) => r.tier === t.tier).sort((a, b) => a.area - b.area);
                    return (
                      <React.Fragment key={t.tier}>
                        <tr onClick={() => toggleTier(t.tier)} className="border-t border-slate-700/60 cursor-pointer hover:bg-slate-800/50">
                          <td className="p-3 text-white font-medium"><span className="inline-block w-4 text-slate-400">{open ? "▾" : "▸"}</span>{t.tier}</td>
                          <td className="p-3 text-right text-slate-300">{t.count}</td>
                          <td className="p-3 text-right text-slate-400">{money(t.canvasCogs)}</td>
                          <td className="p-3 text-right text-white font-semibold">{money(t.recCanvas)}</td>
                          <td className="p-3 text-right text-slate-400">{money(t.kitCogsMin)}{t.kitCogsMax !== t.kitCogsMin ? `–${money(t.kitCogsMax)}` : ""}</td>
                          <td className="p-3 text-right text-white font-semibold">{money(t.recKitMin)}{t.recKitMax !== t.recKitMin ? `–${money(t.recKitMax)}` : ""}</td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-900/60">
                            <td colSpan={6} className="px-3 pb-3 pt-1">
                              <div className="rounded-lg border border-slate-700/60 overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead className="text-slate-500">
                                    <tr>
                                      <th className="text-left p-2 font-normal">Design</th><th className="text-right p-2 font-normal">Size</th>
                                      <th className="text-right p-2 font-normal">Thread</th><th className="text-right p-2 font-normal">Kit COGS</th>
                                      <th className="text-right p-2 font-normal">Rec. kit</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {designs.map((r) => (
                                      <tr key={r.id} className="border-t border-slate-800">
                                        <td className="p-2">
                                          <Link href={`/design/${r.id}/info`} className="text-slate-200 hover:text-rose-400" onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                                          <span className="text-slate-600 ml-1">{r.meshCount}ct</span>
                                          {!r.computed && <span className="ml-1 text-amber-400" title="No computed thread usage">⚠</span>}
                                        </td>
                                        <td className="p-2 text-right text-slate-500">{r.width}×{r.height}</td>
                                        <td className="p-2 text-right text-slate-500">{money(r.threadCost)}</td>
                                        <td className="p-2 text-right text-slate-500">{money(r.kitVerCogs)}</td>
                                        <td className="p-2 text-right text-slate-200 font-medium">{money(r.recKit)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="inline-flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
                {(["all", "18", "13"] as const).map((m) => (
                  <button key={m} onClick={() => setMeshFilter(m)} className={`px-3 py-1 rounded text-sm ${meshFilter === m ? "bg-rose-900 text-white" : "text-slate-300 hover:bg-slate-700"}`}>{m === "all" ? "All" : m + "ct"}</button>
                ))}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search designs…" className="flex-1 min-w-[160px] px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm" />
            </div>

            {/* Per-design table */}
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 text-slate-400">
                  <tr>
                    <th className="text-left p-3">Design</th><th className="text-left p-3">Tier</th>
                    <th className="text-right p-3">Size</th><th className="text-right p-3">Thread</th>
                    <th className="text-right p-3">Canvas COGS</th><th className="text-right p-3">Rec. canvas</th>
                    <th className="text-right p-3">Kit COGS</th><th className="text-right p-3">Rec. kit</th>
                    <th className="text-right p-3">Net/order</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} className="border-t border-slate-700/50 hover:bg-slate-800/40">
                      <td className="p-3">
                        <Link href={`/design/${r.id}/info`} className="text-white hover:text-rose-400">{r.name}</Link>
                        <span className="text-slate-500 ml-1 text-xs">{r.meshCount}ct</span>
                        {!r.computed && <span className="ml-1 text-[10px] text-amber-400" title="Thread not computed — needs stitch backfill">⚠ no thread data</span>}
                      </td>
                      <td className="p-3 text-slate-300">{r.tier}</td>
                      <td className="p-3 text-right text-slate-400">{r.width}×{r.height}</td>
                      <td className="p-3 text-right text-slate-400">{money(r.threadCost)}</td>
                      <td className="p-3 text-right text-slate-400">{money(r.canvasCogs)}</td>
                      <td className="p-3 text-right text-white font-semibold">{money(r.recCanvas)}</td>
                      <td className="p-3 text-right text-slate-400">{money(r.kitVerCogs)}</td>
                      <td className="p-3 text-right text-white font-semibold">{money(r.recKit)}</td>
                      <td className={`p-3 text-right ${r.netKitAfterCac < 8 ? "text-red-400" : r.netKitAfterCac < 15 ? "text-amber-400" : "text-emerald-400"}`}>
                        {money(r.netKitAfterCac)} <span className="text-slate-500">({r.netKitMarginPct}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {needsBackfill.length > 0 && (
              <p className="text-xs text-amber-400/80 mt-3">
                ⚠ {needsBackfill.length} design{needsBackfill.length > 1 ? "s" : ""} have no computed thread usage (kit cost shown as hardware only) — run the stitch/kit backfill for accurate kit COGS: {needsBackfill.slice(0, 10).join(", ")}{needsBackfill.length > 10 ? "…" : ""}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

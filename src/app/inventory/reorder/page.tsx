"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import MeshFilterChips, { MeshFilter } from "@/components/MeshFilterChips";
import { meshBadgeClassLight } from "@/lib/mesh-badge";

type ReorderStatus = "reorder_now" | "reorder_soon" | "ok" | "no_sales";

interface ReorderRow {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  onHand: number;
  here: number;
  market: number;
  andover: number;
  unitsInWindow: number;
  weeklyVelocity: number;
  weeksOfSupply: number | null;
  stockoutAt: string | null;
  status: ReorderStatus;
  suggestedQty: number;
  lowConfidence: boolean;
  totalSold: number;
}

interface ReorderSummary {
  total: number;
  reorderNow: number;
  reorderSoon: number;
  ok: number;
  noSales: number;
  leadWeeks: number;
  targetMonths: number;
  windowDays: number;
  totalUnitsToOrder: number;
}

const LEAD_OPTIONS = [4, 5, 6, 8];
const TARGET_MONTH_OPTIONS = [3, 6, 9, 12];

const STATUS_META: Record<ReorderStatus, { label: string; badge: string; border: string }> = {
  reorder_now: { label: "Reorder now", badge: "bg-red-900/60 text-red-300", border: "border-l-red-500" },
  reorder_soon: { label: "Reorder soon", badge: "bg-amber-900/50 text-amber-300", border: "border-l-amber-500" },
  ok: { label: "OK", badge: "bg-emerald-900/50 text-emerald-300", border: "border-l-emerald-600" },
  no_sales: { label: "No recent sales", badge: "bg-slate-700 text-slate-300", border: "border-l-slate-600" },
};

export default function ReorderPage() {
  const [rows, setRows] = useState<ReorderRow[]>([]);
  const [summary, setSummary] = useState<ReorderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [leadWeeks, setLeadWeeks] = useState(6);
  const [targetMonths, setTargetMonths] = useState(6);
  const [meshFilter, setMeshFilter] = useState<MeshFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const mesh = meshFilter !== "all" ? `&meshCount=${meshFilter}` : "";
      const res = await fetch(`/api/inventory/reorder?leadWeeks=${leadWeeks}&targetMonths=${targetMonths}${mesh}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
        setSummary(data.summary || null);
      }
    } catch (e) {
      console.error("Failed to load reorder analysis:", e);
    }
    setLoading(false);
  }, [leadWeeks, targetMonths, meshFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Refresh on return so sales made elsewhere are reflected.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchData(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchData]);

  const needsReorder = (r: ReorderRow) => r.status === "reorder_now" || r.status === "reorder_soon";
  const visibleRows = useMemo(
    () => (showAll ? rows : rows.filter(needsReorder)),
    [rows, showAll]
  );

  const copyList = () => {
    const list = rows.filter((r) => needsReorder(r) && r.suggestedQty > 0);
    if (list.length === 0) return;
    const text = list.map((r) => `${r.name}\t${r.suggestedQty}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-4xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-4xl mx-auto px-3 md:px-4 py-3 md:py-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-white font-semibold text-lg">Canvas Reorder</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={copyList}
              className="px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg disabled:opacity-40"
              disabled={!summary || (summary.reorderNow + summary.reorderSoon) === 0}
            >
              {copied ? "Copied!" : "Copy reorder list"}
            </button>
            <Link href="/inventory" className="text-sm text-slate-400 hover:text-white">← Inventory</Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Reorder" }]} className="mb-4" />

        <p className="text-sm text-slate-400 mb-4">
          Based on how fast each design is <span className="text-white">actually selling</span> (last {summary?.windowDays ?? 90} days),
          not just how many are left. A design is flagged when its canvases on hand would run out within the
          time it takes a new order to arrive (the lead time). The suggested <span className="text-white">order quantity</span> is
          sized to leave about <span className="text-white">{targetMonths} months</span> of stock once the order arrives, so you
          don&apos;t have to reorder again for a while.
        </p>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-5">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-slate-400">Lead time</span>
            <div className="inline-flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
              {LEAD_OPTIONS.map((w) => (
                <button
                  key={w}
                  onClick={() => setLeadWeeks(w)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    leadWeeks === w ? "bg-rose-900 text-white" : "text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {w}w
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-slate-400">Reorder every</span>
            <div className="inline-flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
              {TARGET_MONTH_OPTIONS.map((m) => (
                <button
                  key={m}
                  onClick={() => setTargetMonths(m)}
                  title={`Order enough to last ~${m} months`}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    targetMonths === m ? "bg-rose-900 text-white" : "text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {m}mo
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-rose-700" />
            Show all designs
          </label>
        </div>

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
            <div className="bg-red-900/30 rounded-lg p-3 border border-red-800/50">
              <p className="text-xs text-red-400 uppercase tracking-wider">Reorder now</p>
              <p className="text-2xl font-bold text-red-300">{summary.reorderNow}</p>
            </div>
            <div className="bg-amber-900/30 rounded-lg p-3 border border-amber-800/50">
              <p className="text-xs text-amber-400 uppercase tracking-wider">Reorder soon</p>
              <p className="text-2xl font-bold text-amber-300">{summary.reorderSoon}</p>
            </div>
            <div className="bg-emerald-900/20 rounded-lg p-3 border border-emerald-800/40">
              <p className="text-xs text-emerald-400 uppercase tracking-wider">OK</p>
              <p className="text-2xl font-bold text-emerald-300">{summary.ok}</p>
            </div>
            <div className="bg-sky-900/30 rounded-lg p-3 border border-sky-800/50">
              <p className="text-xs text-sky-400 uppercase tracking-wider">Canvases to order</p>
              <p className="text-2xl font-bold text-sky-200">{summary.totalUnitsToOrder}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">for ~{summary.targetMonths} mo of stock</p>
            </div>
          </div>
        )}

        <div className="mb-5">
          <MeshFilterChips value={meshFilter} onChange={setMeshFilter} />
        </div>

        {loading ? (
          <div className="text-slate-400 py-12 text-center">Loading…</div>
        ) : visibleRows.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-emerald-800/50 p-8 text-center">
            <p className="text-emerald-300 font-medium">Nothing needs reordering</p>
            <p className="text-slate-400 text-sm mt-1">
              No design is on track to run out within {leadWeeks} weeks. Turn on “Show all designs” to see everything.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRows.map((r) => {
              const meta = STATUS_META[r.status];
              const stockout = fmtDate(r.stockoutAt);
              return (
                <div
                  key={r.id}
                  className={`bg-slate-800 rounded-xl border border-slate-700 border-l-4 ${meta.border} p-3 md:p-4 flex flex-wrap items-center gap-3`}
                >
                  <Link href={`/design/${r.id}/info`} className="flex-shrink-0">
                    {r.previewImageUrl ? (
                      <img src={r.previewImageUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-slate-600" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-slate-700 border border-slate-600" />
                    )}
                  </Link>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/design/${r.id}/info`} className="text-white font-medium truncate hover:text-rose-400">{r.name}</Link>
                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${meshBadgeClassLight(r.meshCount)}`}>{r.meshCount}ct</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      <span className="text-white font-semibold">{r.weeklyVelocity}</span>/wk
                      {" · "}
                      <span className="text-white font-semibold">{r.onHand}</span> on hand
                      {r.weeksOfSupply !== null ? (
                        <>
                          {" · ~"}
                          <span className={r.status === "reorder_now" ? "text-red-300 font-semibold" : "text-slate-200"}>{r.weeksOfSupply}</span> wks left
                          {stockout && <> · out ~{stockout}</>}
                        </>
                      ) : (
                        <> · no recent sales</>
                      )}
                      {r.lowConfidence && r.status !== "no_sales" && (
                        <span className="text-slate-500"> · low data</span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs font-bold uppercase tracking-wide px-2 py-1 rounded ${meta.badge}`}>
                      {meta.label}
                    </span>
                    {r.suggestedQty > 0 && (
                      <div className="text-right leading-none w-14">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400">{needsReorder(r) ? "order" : "top up"}</span>
                        <div className={`text-xl font-bold ${needsReorder(r) ? "text-white" : "text-slate-400"}`}>{r.suggestedQty}</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

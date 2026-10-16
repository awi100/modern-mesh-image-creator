"use client";

import { useEffect, useState, useCallback } from "react";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";
import PosDayClassifier from "./PosDayClassifier";
import BufferPicker, { type Buffer } from "./BufferPicker";

/**
 * The full "bring this much" list, the markets it was derived from, and which
 * in-person days count as markets at all.
 *
 * This is the reference view — everything, including what's already packed.
 * The actionable shortfall lives in MarketToPack.
 */

type Kind = "kit" | "canvas" | "supply" | "other";

interface PrepRow {
  name: string;
  kind: Kind;
  perMarket: number[];
  total: number;
  max: number;
  marketsSold: number;
  avgPerMarket: number;
  recommended: number;
  /** Supplies only. A design's tote stock is the split pair below. */
  inTote: number | null;
  recommendedCanvas: number;
  recommendedKit: number;
  toteCanvas: number | null;
  toteKits: number | null;
}
interface PrepSummary {
  marketCount: number;
  itemCount: number;
  totalUnitsToBring: number;
  busiestDayUnits: number;
  buffer: Buffer;
}
interface MarketInfo { label: string; units: number; }

const KIND_BADGE: Record<Kind, string> = {
  kit: "bg-rose-900/50 text-rose-300",
  canvas: "bg-sky-900/50 text-sky-300",
  supply: "bg-emerald-900/50 text-emerald-300",
  other: "bg-slate-700 text-slate-300",
};

export default function MarketPlan({
  buffer,
  onBufferChange,
}: {
  buffer: Buffer;
  onBufferChange: (b: Buffer) => void;
}) {
  const [rows, setRows] = useState<PrepRow[]>([]);
  const [summary, setSummary] = useState<PrepSummary | null>(null);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market/prep?buffer=${buffer}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
        setSummary(data.summary || null);
        setMarkets(data.markets || []);
      }
    } catch (e) {
      console.error("Failed to load market prep:", e);
    }
    setLoading(false);
  }, [buffer]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefetchOnFocus(fetchData);

  const toggle = (name: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const copyList = () => {
    if (rows.length === 0) return;
    navigator.clipboard.writeText(rows.map((r) => `${r.name}\t${r.recommended}`).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const packedCount = rows.filter((r) => checked.has(r.name)).length;

  // Is the tote actually right? Judged per side — canvases against canvases,
  // kits against kits — never on a sum of the two.
  const isReady = (r: PrepRow) =>
    r.toteCanvas !== null
      ? (r.toteCanvas ?? 0) >= r.recommendedCanvas && (r.toteKits ?? 0) >= r.recommendedKit
      : r.inTote !== null
        ? r.inTote >= r.recommended
        : false;
  const readyRows = rows.filter(isReady).length;
  const shortRows = rows.length - readyRows;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <p className="text-sm text-slate-400 flex-1 min-w-[260px]">
          How many of each item to bring to the next market, from your Shopify POS sales. Sized to your{" "}
          <span className="text-white">busiest market day</span> plus a safety buffer so you don&apos;t sell out.
          Check items off as you pack the tote.
        </p>
        <button
          onClick={copyList}
          disabled={rows.length === 0}
          className="px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg disabled:opacity-40"
        >
          {copied ? "Copied!" : "Copy list"}
        </button>
      </div>

      <BufferPicker value={buffer} onChange={onBufferChange} showHints />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Units to bring</p>
            <p className="text-2xl font-bold text-white">{summary.totalUnitsToBring}</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Distinct items</p>
            <p className="text-2xl font-bold text-white">{summary.itemCount}</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Markets analyzed</p>
            <p className="text-2xl font-bold text-white">{summary.marketCount}</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Packed</p>
            <p className="text-2xl font-bold text-emerald-300">{packedCount}/{rows.length}</p>
          </div>
        </div>
      )}

      {/* The one thing you want to know before leaving for a market. */}
      {!loading && rows.length > 0 && (
        <div
          className={`rounded-xl p-4 mb-4 border ${
            shortRows === 0 ? "bg-emerald-900/20 border-emerald-700" : "bg-amber-900/20 border-amber-700"
          }`}
        >
          {shortRows === 0 ? (
            <p className="text-emerald-300 font-semibold">
              Tote is ready — every item has its canvases and kits at target.
            </p>
          ) : (
            <p className="text-amber-200">
              <span className="font-semibold">{shortRows}</span> of {rows.length} items are short
              <span className="text-slate-400"> · {readyRows} ready</span>
            </p>
          )}
        </div>
      )}

      {markets.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 text-xs text-slate-400">
          <span className="uppercase tracking-wider">Past markets:</span>
          {markets.map((m) => (
            <span key={m.label} className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded">
              {m.label}: {m.units}u
            </span>
          ))}
        </div>
      )}

      {/* Which in-person days actually count as markets */}
      <PosDayClassifier onChange={fetchData} />

      {loading ? (
        <div className="text-slate-400 py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
          <p className="text-slate-300 font-medium">No POS sales yet</p>
          <p className="text-slate-400 text-sm mt-1">Once you&apos;ve sold at a market through Shopify POS, recommendations show here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const isChecked = checked.has(r.name);
            // A design needs canvases and kits in different amounts; a supply
            // is a single number. The API marks the difference by giving
            // designs a split (toteCanvas) and supplies a combined inTote.
            const isDesign = r.toteCanvas !== null;
            const ready = isReady(r);
            return (
              <div
                key={r.name}
                onClick={() => toggle(r.name)}
                className={`cursor-pointer rounded-xl border p-3 flex items-center gap-3 transition-colors ${
                  isChecked
                    ? "bg-slate-800/40 border-slate-700/60"
                    : ready
                      ? "bg-slate-800 border-emerald-800/70 hover:bg-slate-700/40"
                      : "bg-slate-800 border-amber-800/70 hover:bg-slate-700/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(r.name)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-5 h-5 accent-emerald-600 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-white font-medium truncate ${isChecked ? "line-through text-slate-400" : ""}`}>{r.name}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${KIND_BADGE[r.kind]}`}>{r.kind}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${
                        ready ? "bg-emerald-900/60 text-emerald-300" : "bg-amber-900/60 text-amber-300"
                      }`}
                      title={ready ? "Tote has enough of this already" : "Tote is short of this"}
                    >
                      {ready ? "✓ in tote" : "short"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    sold {r.perMarket.join(" · ")} · peak <span className="text-white font-semibold">{r.max}</span>
                    {/* Canvases against canvases, kits against kits. These were
                        once one summed figure, so 3 canvases + 3 kits read as
                        "6 in tote" beside a target that only counted canvases. */}
                    {isDesign ? (
                      <> · in tote <span className="text-sky-400">{r.toteCanvas ?? 0} canvas</span>
                        {r.recommendedKit > 0 && <> · <span className="text-rose-400">{r.toteKits ?? 0} kits</span></>}
                      </>
                    ) : r.inTote !== null ? (
                      <> · <span className="text-emerald-400">{r.inTote}</span> in tote now</>
                    ) : null}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-400">bring</p>
                  {isDesign ? (
                    <>
                      <p className="text-2xl font-bold text-sky-300 leading-none">{r.recommendedCanvas}</p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">canvas</p>
                      {r.recommendedKit > 0 && (
                        <p className="text-sm font-bold text-rose-300 leading-tight mt-1">
                          {r.recommendedKit} <span className="text-[10px] uppercase tracking-wider text-slate-500">kits</span>
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-2xl font-bold text-white leading-none">{r.recommended}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

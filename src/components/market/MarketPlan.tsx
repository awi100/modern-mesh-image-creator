"use client";

import { useEffect, useState, useCallback } from "react";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";
import PosDayClassifier from "./PosDayClassifier";
import BufferPicker, { type Buffer } from "./BufferPicker";
import MarketTotals, { type KindTotals } from "./MarketTotals";

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
  canvas: KindTotals;
  kit: KindTotals;
  supply: KindTotals;
}
interface MarketInfo { label: string; units: number; }

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

      {summary && <MarketTotals canvas={summary.canvas} kit={summary.kit} className="mb-3" />}

      {/* The one thing you want to know before leaving for a market. One line:
          the totals above already carry the detail, so this only has to say
          whether you're done. */}
      {!loading && rows.length > 0 && (
        <div
          className={`rounded-lg px-3 py-2 mb-3 border text-sm ${
            shortRows === 0
              ? "bg-emerald-900/20 border-emerald-800 text-emerald-300"
              : "bg-amber-900/20 border-amber-800 text-amber-200"
          }`}
        >
          {shortRows === 0 ? (
            <span className="font-semibold">Tote is ready — every item is at target.</span>
          ) : (
            <>
              <span className="font-semibold">{shortRows}</span> of {rows.length} items short
              <span className="opacity-70"> · {readyRows} ready · {packedCount} checked off</span>
            </>
          )}
        </div>
      )}

      {/* Context for the numbers, kept to one quiet line rather than three
          large cards for figures nobody acts on. */}
      {summary && (
        <p className="text-xs text-slate-500 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{summary.itemCount} items · {summary.marketCount} markets</span>
          {markets.length > 0 && (
            <>
              <span className="text-slate-700">|</span>
              {markets.map((m) => (
                <span key={m.label} className="text-slate-500" title={`${m.units} units sold`}>
                  {m.label.slice(5)}
                  <span className="text-slate-600">:{m.units}</span>
                </span>
              ))}
            </>
          )}
        </p>
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
        <div className="rounded-xl border border-slate-700 overflow-hidden divide-y divide-slate-700/60">
          {rows.map((r) => {
            const isChecked = checked.has(r.name);
            // A design needs canvases and kits in different amounts; a supply
            // is a single number. The API marks the difference by giving
            // designs a split (toteCanvas) and supplies a combined inTote.
            const isDesign = r.toteCanvas !== null;
            const tracked = isDesign || r.inTote !== null;
            const ready = isReady(r);
            return (
              <div
                key={r.name}
                onClick={() => toggle(r.name)}
                className={`cursor-pointer flex items-center gap-3 px-3 py-2.5 border-l-2 transition-colors ${
                  isChecked
                    ? "bg-slate-900/40 border-l-slate-700"
                    : ready
                      ? "bg-slate-800 border-l-emerald-600 hover:bg-slate-700/40"
                      : "bg-slate-800 border-l-amber-600 hover:bg-slate-700/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(r.name)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 accent-emerald-600 flex-shrink-0"
                />

                <div className="flex-1 min-w-0">
                  <p className={`font-medium truncate ${isChecked ? "line-through text-slate-500" : "text-white"}`}>
                    {r.name}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    peak <span className="text-slate-300 font-semibold">{r.max}</span> · sold {r.total} over{" "}
                    {r.marketsSold} of {r.perMarket.length} markets
                  </p>
                </div>

                {/* Ten per-market numbers were mostly zeros; the shape is the
                    only part worth reading at a glance, and the exact run is
                    still there on hover. */}
                <Spark values={r.perMarket} />

                {isDesign ? (
                  <>
                    <StatPair label="canvas" have={r.toteCanvas ?? 0} need={r.recommendedCanvas} />
                    <StatPair label="kits" have={r.toteKits ?? 0} need={r.recommendedKit} />
                  </>
                ) : tracked ? (
                  <StatPair label={r.kind === "supply" ? "supply" : "in tote"} have={r.inTote ?? 0} need={r.recommended} wide />
                ) : (
                  // Matched no design or supply, so there is no stock to count.
                  <div className="text-right flex-shrink-0 w-[140px]">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">bring</p>
                    <p className="text-sm font-semibold text-slate-300 tabular-nums">{r.recommended}</p>
                    <p className="text-[10px] text-slate-600 leading-tight">not tracked</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Held / needed for one kind, in one fixed-width column so the figures line up
 * down the list. Amber when short, green when covered — the row's left edge
 * carries the same signal, so no per-row "SHORT" badge is needed (nearly every
 * row was short, which made the badge pure noise).
 */
function StatPair({
  label, have, need, wide = false,
}: {
  label: string; have: number; need: number; wide?: boolean;
}) {
  const short = have < need;
  return (
    <div className={`text-right flex-shrink-0 ${wide ? "w-[140px]" : "w-[64px]"}`}>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums">
        <span className={short ? "text-amber-400" : "text-emerald-400"}>{have}</span>
        <span className="text-slate-600"> / </span>
        <span className="text-slate-300">{need}</span>
      </p>
    </div>
  );
}

/** Units per market, as bar heights. Hidden on narrow screens. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div
      className="hidden md:flex items-end gap-[2px] h-5 flex-shrink-0"
      title={`sold ${values.join(" · ")} (oldest market first)`}
      aria-hidden="true"
    >
      {values.map((v, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm ${v > 0 ? "bg-slate-400" : "bg-slate-700"}`}
          style={{ height: `${Math.max(2, Math.round((v / max) * 20))}px` }}
        />
      ))}
    </div>
  );
}

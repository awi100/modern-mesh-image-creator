"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";

interface Row {
  productTitle: string;
  variantTitle: string | null;
  units: number;
  lines: number;
  firstSeen: string | null;
  lastSeen: string | null;
  orderNumbers: string[];
  matchesNow: { kind: "design" | "supply"; id: string; name: string } | null;
  suggestion: { kind: "design" | "supply"; name: string; score: number } | null;
}

interface Payload {
  rows: Row[];
  summary: { openTitles: number; openUnits: number; fixedTitles: number; fixedUnits: number };
}

export default function UnmatchedSalesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFixed, setShowFixed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/shopify/unmatched");
        if (res.ok) setData(await res.json());
      } catch (e) {
        console.error("Failed to load unmatched sales:", e);
      }
      setLoading(false);
    })();
  }, []);

  const open = useMemo(() => data?.rows.filter((r) => !r.matchesNow) ?? [], [data]);
  const fixed = useMemo(() => data?.rows.filter((r) => r.matchesNow) ?? [], [data]);

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

  const renderRow = (r: Row) => (
    <div
      key={`${r.productTitle}|${r.variantTitle ?? ""}`}
      className="bg-slate-800 border border-slate-700 rounded-xl p-3 md:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white font-medium break-words">
            {r.productTitle}
            {r.variantTitle && <span className="text-slate-400 font-normal"> · {r.variantTitle}</span>}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {r.lines} line{r.lines === 1 ? "" : "s"} · {fmt(r.firstSeen)} → {fmt(r.lastSeen)}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-xl font-bold ${r.matchesNow ? "text-slate-300" : "text-amber-300"}`}>{r.units}</p>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">units</p>
        </div>
      </div>

      {r.matchesNow ? (
        <p className="mt-2 text-sm text-emerald-400">
          Matches now → {r.matchesNow.kind === "design" ? "design" : "supply"}{" "}
          <span className="font-medium">{r.matchesNow.name}</span>
          <span className="text-slate-500"> · historical only, nothing to fix</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-amber-300">
          Still matches nothing — the next one sold will skip stock too.
          {r.suggestion && (
            <span className="text-slate-400">
              {" "}Closest {r.suggestion.kind} is{" "}
              <span className="text-slate-200 font-medium">{r.suggestion.name}</span>.
            </span>
          )}
        </p>
      )}

      {r.orderNumbers.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-500 break-words">Orders: {r.orderNumbers.join(", ")}</p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-5xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <h1 className="text-white font-semibold">Sales That Deducted Nothing</h1>
          <Link href="/inventory" className="text-sm text-slate-400 hover:text-white">← Inventory</Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Unmatched Sales" }]} className="mb-4" />

        <p className="text-sm text-slate-400 mb-5">
          Line items are matched to a design or supply <strong className="text-slate-300">by name</strong> when you
          fulfil an order. When nothing matches, the sale still goes through but no stock moves — so your counts drift
          high. The warning on the Orders page only covers orders you haven&apos;t fulfilled yet; this covers the whole
          history. Fix one by renaming the design or supply to match the Shopify title exactly (or renaming it in
          Shopify), or by creating the missing supply.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
            <div className="w-4 h-4 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
            Checking every order…
          </div>
        ) : !data ? (
          <p className="text-slate-400 text-sm">Couldn&apos;t load the report.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className={`rounded-xl p-4 border ${data.summary.openTitles > 0 ? "bg-amber-900/20 border-amber-700" : "bg-emerald-900/20 border-emerald-700"}`}>
                <p className={`text-3xl font-bold ${data.summary.openTitles > 0 ? "text-amber-300" : "text-emerald-400"}`}>
                  {data.summary.openUnits}
                </p>
                <p className="text-sm text-slate-400">
                  units still unmatched{" "}
                  <span className="text-slate-500">({data.summary.openTitles} titles)</span>
                </p>
              </div>
              <div className="rounded-xl p-4 border bg-slate-800 border-slate-700">
                <p className="text-3xl font-bold text-slate-300">{data.summary.fixedUnits}</p>
                <p className="text-sm text-slate-400">
                  units matched since{" "}
                  <span className="text-slate-500">({data.summary.fixedTitles} titles)</span>
                </p>
              </div>
            </div>

            {open.length === 0 ? (
              <p className="text-emerald-400 text-sm mb-6">
                Nothing selling today misses inventory. Every past gap now matches.
              </p>
            ) : (
              <div className="grid gap-2 mb-6">{open.map(renderRow)}</div>
            )}

            {fixed.length > 0 && (
              <>
                <button
                  onClick={() => setShowFixed(!showFixed)}
                  className="text-sm text-slate-400 hover:text-white flex items-center gap-1.5"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${showFixed ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  {showFixed ? "Hide" : "Show"} {fixed.length} title{fixed.length === 1 ? "" : "s"} that match now
                </button>
                {showFixed && <div className="grid gap-2 mt-3">{fixed.map(renderRow)}</div>}
              </>
            )}

            <p className="text-xs text-slate-500 mt-8">
              Mystery-bag and bundle lines are left out — those carry no design or supply of their own by design.
              Nothing on this page changes stock: fixing a name only affects future orders, because the stock these
              sales should have moved was never recorded.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

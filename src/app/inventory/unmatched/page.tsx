"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";

type Status = "open" | "resolved" | "stale";

interface Row {
  productTitle: string;
  variantTitle: string | null;
  units: number;
  lines: number;
  firstSeen: string | null;
  lastSeen: string | null;
  orderNumbers: string[];
  status: Status;
  target: { kind: "design" | "supply"; id: string; name: string; confident: boolean } | null;
  targetLastSold: string | null;
  reason: string;
}

interface Tally {
  titles: number;
  units: number;
}

interface Payload {
  rows: Row[];
  summary: Record<Status, Tally>;
}

const TONE: Record<Status, { card: string; count: string; text: string }> = {
  open: { card: "bg-amber-900/20 border-amber-700", count: "text-amber-300", text: "text-amber-300" },
  stale: { card: "bg-slate-800 border-slate-700", count: "text-slate-300", text: "text-slate-400" },
  resolved: { card: "bg-slate-800 border-slate-700", count: "text-slate-300", text: "text-emerald-400" },
};

export default function UnmatchedSalesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<Status, boolean>>({ open: true, stale: false, resolved: false });

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

  const bucket = useMemo(
    () => (s: Status) => data?.rows.filter((r) => r.status === s) ?? [],
    [data],
  );

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

  const renderRow = (r: Row) => {
    const tone = TONE[r.status];
    return (
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
              {r.lines} line{r.lines === 1 ? "" : "s"} · {fmt(r.firstSeen)}
              {r.firstSeen !== r.lastSeen && <> → {fmt(r.lastSeen)}</>}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className={`text-xl font-bold ${tone.count}`}>{r.units}</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">units</p>
          </div>
        </div>

        <p className={`mt-2 text-sm ${tone.text}`}>{r.reason}</p>

        {r.target && (
          <p className="mt-1 text-xs text-slate-500">
            {r.target.confident ? "Refers to" : "Best guess"}:{" "}
            {r.target.kind === "design" ? (
              <Link href={`/design/${r.target.id}/info`} className="text-slate-300 hover:text-rose-400">
                {r.target.name}
              </Link>
            ) : (
              <span className="text-slate-300">{r.target.name}</span>
            )}
            {r.targetLastSold && <> · last sold {fmt(r.targetLastSold)}</>}
          </p>
        )}

        {r.orderNumbers.length > 0 && (
          <p className="mt-1.5 text-xs text-slate-500 break-words">Orders: {r.orderNumbers.join(", ")}</p>
        )}
      </div>
    );
  };

  const section = (status: Status, title: string, blurb: string) => {
    const rows = bucket(status);
    if (rows.length === 0) return null;
    const isOpen = open[status];
    return (
      <div className="mb-6">
        <button
          onClick={() => setOpen({ ...open, [status]: !isOpen })}
          className="w-full flex items-center gap-2 text-left mb-2"
        >
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <span className="text-white font-semibold">{title}</span>
          <span className="text-slate-500 text-sm">
            ({rows.length} title{rows.length === 1 ? "" : "s"})
          </span>
        </button>
        <p className="text-xs text-slate-500 mb-3 pl-6">{blurb}</p>
        {isOpen && <div className="grid gap-2">{rows.map(renderRow)}</div>}
      </div>
    );
  };

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
          fulfil an order. When nothing matches, the sale goes through but no stock moves, so the count drifts high.
          The warning on the Orders page only covers orders you haven&apos;t fulfilled yet; this covers the whole
          history. Each title is stored as it was spelled <em>at the time</em>, so an old spelling you have since
          corrected in Shopify shows up here too — those are sorted out below rather than listed as problems.
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
            <div className="grid grid-cols-3 gap-2 md:gap-3 mb-6">
              {(["open", "stale", "resolved"] as Status[]).map((s) => (
                <div key={s} className={`rounded-xl p-3 md:p-4 border ${TONE[s].card}`}>
                  <p className={`text-2xl md:text-3xl font-bold ${TONE[s].count}`}>{data.summary[s].units}</p>
                  <p className="text-xs md:text-sm text-slate-400 capitalize">
                    {s === "open" ? "need a fix" : s === "stale" ? "one-offs" : "already sorted"}
                  </p>
                  <p className="text-[10px] text-slate-500">{data.summary[s].titles} titles</p>
                </div>
              ))}
            </div>

            {data.summary.open.titles === 0 && (
              <p className="text-emerald-400 text-sm mb-6">
                Nothing selling today misses inventory.
              </p>
            )}

            {section(
              "open",
              "Needs a fix",
              "Recent or repeated, and nothing newer has matched — the next one sold will skip stock too. Fix by renaming the design or supply to match the Shopify title exactly, or by creating the missing supply.",
            )}
            {section(
              "stale",
              "One-offs",
              "Sold once or twice, months ago, with nothing since. Custom or ad-hoc items rather than products that will sell again.",
            )}
            {section(
              "resolved",
              "Already sorted",
              "The design or supply these refer to has deducted normally since. The old rows just kept the old spelling.",
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

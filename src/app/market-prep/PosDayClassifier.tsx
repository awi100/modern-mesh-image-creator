"use client";

import { useCallback, useEffect, useState } from "react";

import { EVENT_LABEL as LABEL, type EventKind as Kind } from "@/lib/pos-events";

interface Day {
  day: string; weekday: string; kind: Kind; name: string | null; classified: boolean;
  orders: number; units: number; designUnits: number; supplyUnits: number;
}

const CHIP: Record<Kind, string> = {
  market: "bg-emerald-800 text-white",
  sip_and_stitch: "bg-purple-800 text-white",
  other: "bg-slate-600 text-white",
};

/**
 * Every day we sold in person, and whether it counts as a market.
 *
 * Shopify stamps POS sales from a craft market and from a sip-and-stitch at a
 * restaurant identically (source_name = "pos"), so the difference can only come
 * from us. Days default to Market, which means only the exceptions need
 * touching — and the packing targets above ignore anything not a Market.
 */
export default function PosDayClassifier({ onChange }: { onChange: () => void }) {
  const [days, setDays] = useState<Day[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market/events");
      if (res.ok) setDays((await res.json()).days ?? []);
    } catch { /* non-critical panel */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = async (day: string, kind: Kind) => {
    setBusy(day);
    try {
      const res = await fetch("/api/market/events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, kind, name: kind === "market" ? null : LABEL[kind] }),
      });
      if (res.ok) { await load(); onChange(); }
    } finally { setBusy(null); }
  };

  const excluded = days.filter((d) => d.kind !== "market").length;
  if (days.length === 0) return null;

  return (
    <div className="mb-5 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-slate-700/40 transition-colors">
        <span className="text-sm text-slate-300">
          In-person days: <span className="text-white font-medium">{days.length - excluded} markets</span>
          {excluded > 0 && <span className="text-purple-300"> · {excluded} not a market</span>}
        </span>
        <span className="text-xs text-slate-400">{open ? "Hide" : "Classify"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700 divide-y divide-slate-700/60">
          <p className="px-4 py-2 text-xs text-slate-400">
            Shopify can&apos;t tell a market apart from a sip-and-stitch — both come through POS.
            Only days marked <span className="text-emerald-300">Market</span> count toward packing targets.
            Sales still count everywhere else.
          </p>
          {days.map((d) => (
            <div key={d.day} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-white">
                  {d.day} <span className="text-slate-500">{d.weekday}</span>
                  {!d.classified && <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500">default</span>}
                </p>
                <p className="text-xs text-slate-400">{d.orders} orders · {d.units} units</p>
              </div>
              <div className="inline-flex gap-1 bg-slate-900/60 p-1 rounded-lg border border-slate-700">
                {(Object.keys(LABEL) as Kind[]).map((k) => (
                  <button key={k} onClick={() => set(d.day, k)} disabled={busy === d.day}
                    aria-pressed={d.kind === k}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                      d.kind === k ? CHIP[k] : "text-slate-300 hover:bg-slate-700"}`}>
                    {LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

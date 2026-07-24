"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";

type Buffer = "conservative" | "balanced" | "aggressive";
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
  inTote: number | null;
}
interface PrepSummary {
  marketCount: number;
  itemCount: number;
  totalUnitsToBring: number;
  busiestDayUnits: number;
  buffer: Buffer;
}
interface MarketInfo { label: string; units: number; }

const BUFFERS: { value: Buffer; label: string; hint: string }[] = [
  { value: "conservative", label: "Conservative", hint: "peak +25%" },
  { value: "balanced", label: "Balanced", hint: "peak +50%" },
  { value: "aggressive", label: "Aggressive", hint: "peak ×2" },
];

const KIND_BADGE: Record<Kind, string> = {
  kit: "bg-rose-900/50 text-rose-300",
  canvas: "bg-sky-900/50 text-sky-300",
  supply: "bg-emerald-900/50 text-emerald-300",
  other: "bg-slate-700 text-slate-300",
};

export default function MarketPrepPage() {
  const [rows, setRows] = useState<PrepRow[]>([]);
  const [summary, setSummary] = useState<PrepSummary | null>(null);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [buffer, setBuffer] = useState<Buffer>("balanced");
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

  const toggle = (name: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const copyList = () => {
    if (rows.length === 0) return;
    const text = rows.map((r) => `${r.name}\t${r.recommended}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const packedCount = rows.filter((r) => checked.has(r.name)).length;

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-4xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-4xl mx-auto px-3 md:px-4 py-3 md:py-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-white font-semibold text-lg">Market Prep</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={copyList}
              disabled={rows.length === 0}
              className="px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg disabled:opacity-40"
            >
              {copied ? "Copied!" : "Copy list"}
            </button>
            <Link href="/inventory" className="text-sm text-slate-400 hover:text-white">← Inventory</Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Market Prep" }]} className="mb-4" />

        <p className="text-sm text-slate-400 mb-4">
          How many of each item to bring to the next market, from your Shopify POS sales. Sized to your{" "}
          <span className="text-white">busiest market day</span> plus a safety buffer so you don&apos;t sell out.
          Check items off as you pack the tote.
        </p>

        {/* Buffer selector */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <span className="text-xs uppercase tracking-wider text-slate-400">Buffer</span>
          <div className="inline-flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
            {BUFFERS.map((b) => (
              <button
                key={b.value}
                onClick={() => setBuffer(b.value)}
                title={b.hint}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  buffer === b.value ? "bg-rose-900 text-white" : "text-slate-300 hover:bg-slate-700"
                }`}
              >
                {b.label}
                <span className="ml-1 text-xs opacity-70">{b.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
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

        {/* Markets analyzed context */}
        {markets.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5 text-xs text-slate-400">
            <span className="uppercase tracking-wider">Past markets:</span>
            {markets.map((m) => (
              <span key={m.label} className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded">
                {m.label}: {m.units}u
              </span>
            ))}
          </div>
        )}

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
              return (
                <div
                  key={r.name}
                  onClick={() => toggle(r.name)}
                  className={`cursor-pointer rounded-xl border p-3 flex items-center gap-3 transition-colors ${
                    isChecked ? "bg-slate-800/40 border-slate-700/60" : "bg-slate-800 border-slate-700 hover:bg-slate-700/40"
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
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      sold {r.perMarket.join(" · ")} · peak <span className="text-white font-semibold">{r.max}</span>
                      {r.inTote !== null && (
                        <> · <span className="text-emerald-400">{r.inTote}</span> in tote now</>
                      )}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-slate-400">bring</p>
                    <p className="text-2xl font-bold text-white leading-none">{r.recommended}</p>
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

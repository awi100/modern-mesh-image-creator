"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";

interface Deduction {
  id: string;
  createdAt: string;
  orderNumber: string;
  sourceName: string | null;
  bucket: "market" | "online" | string;
  via: string;
  designName: string | null;
  kitsRequested: number;
  kitsDeducted: number;
  canvasRequested: number;
  canvasDeducted: number;
}

export default function DeductionLogPage() {
  const [rows, setRows] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<"all" | "market" | "online">("all");

  const fetchRows = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (bucket !== "all") params.set("bucket", bucket);
      const res = await fetch(`/api/inventory/deductions?${params.toString()}`);
      if (res.ok) setRows(await res.json());
    } catch (e) {
      console.error("Failed to load deduction log:", e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRows(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bucket]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.designName || "").toLowerCase().includes(q) || r.orderNumber.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <h1 className="text-white font-semibold">Inventory Deduction Log</h1>
          <Link href="/inventory" className="text-sm text-slate-400 hover:text-white">← Inventory</Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Deduction Log" }]} className="mb-4" />

        <p className="text-sm text-slate-400 mb-4">
          Every Shopify order that touched inventory, newest first. <span className="text-emerald-400">Market</span> = POS / craft-market tote; <span className="text-slate-300">Online</span> = web/storage stock. A red count means the order needed more than was in stock (it ran out).
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search design or order #..."
            className="flex-1 min-w-[220px] max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          />
          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-800 border border-slate-700 p-1">
            {(["all", "market", "online"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={`px-3 py-1 text-xs font-medium rounded capitalize transition-colors ${bucket === b ? "bg-emerald-800 text-white" : "text-slate-300 hover:bg-slate-700"}`}
              >
                {b}
              </button>
            ))}
          </div>
          <button onClick={fetchRows} className="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg">Refresh</button>
        </div>

        {loading ? (
          <div className="text-slate-400 py-12 text-center">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-slate-400 py-12 text-center">No deductions recorded yet. New orders will appear here.</div>
        ) : (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="divide-y divide-slate-700/60">
              {filtered.map((r) => {
                const kitShort = r.kitsDeducted < r.kitsRequested;
                const canvasShort = r.canvasDeducted < r.canvasRequested;
                return (
                  <div key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="text-slate-500 w-28 flex-shrink-0">{fmt(r.createdAt)}</span>
                    <span className="text-slate-400 w-16 flex-shrink-0">{r.orderNumber}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${r.bucket === "market" ? "bg-emerald-900/50 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>
                      {r.bucket}
                    </span>
                    <span className="text-white basis-full sm:basis-auto sm:flex-1 min-w-0 truncate">{r.designName || "(unmatched)"}</span>
                    <span className={`flex-shrink-0 ${kitShort ? "text-red-400 font-semibold" : "text-slate-300"}`} title={kitShort ? `needed ${r.kitsRequested}, only ${r.kitsDeducted} in stock` : ""}>
                      −{r.kitsDeducted} kit{kitShort ? ` / ${r.kitsRequested}` : ""}
                    </span>
                    <span className={`flex-shrink-0 w-24 text-right ${canvasShort ? "text-red-400 font-semibold" : "text-slate-300"}`} title={canvasShort ? `needed ${r.canvasRequested}, only ${r.canvasDeducted} in stock` : ""}>
                      −{r.canvasDeducted} canvas{canvasShort ? ` / ${r.canvasRequested}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

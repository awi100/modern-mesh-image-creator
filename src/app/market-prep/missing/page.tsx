"use client";

import { useEffect, useState, useCallback } from "react";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import { mutApi } from "@/lib/mut-api";

type Buffer = "conservative" | "balanced" | "aggressive";
type Kind = "kit" | "canvas" | "supply" | "other";

interface DesignStock { id: string; marketKits: number; marketCanvas: number; homeKits: number; homeCanvas: number; }
interface SupplyStock { id: string; market: number; home: number; }
interface PrepRow {
  name: string; kind: Kind; total: number; recommended: number; inTote: number | null;
  recommendedCanvas: number; recommendedKit: number;
  toteCanvas: number | null; toteKits: number | null;
  design: DesignStock | null; supply: SupplyStock | null;
}
/** One shortfall line: a specific thing to put in the tote. */
interface Gap { row: PrepRow; what: "canvas" | "kit" | "supply"; need: number; have: number; gap: number; atHome: number; }

const BUFFERS: { value: Buffer; label: string; hint: string }[] = [
  { value: "conservative", label: "Conservative", hint: "peak +25%" },
  { value: "balanced", label: "Balanced", hint: "peak +50%" },
  { value: "aggressive", label: "Aggressive", hint: "peak ×2" },
];
const KIND_BADGE: Record<Kind, string> = {
  kit: "bg-rose-900/50 text-rose-300",
  canvas: "bg-sky-900/50 text-sky-300",
  supply: "bg-purple-900/50 text-purple-300",
  other: "bg-slate-700 text-slate-300",
};

export default function MissingFromMarketPage() {
  const [rows, setRows] = useState<PrepRow[]>([]);
  const [buffer, setBuffer] = useState<Buffer>("balanced");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/prep?buffer=${buffer}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setRows(data.rows ?? []);
      setError(null);
    } catch {
      setError("Couldn't load the market list.");
    } finally {
      setLoading(false);
    }
  }, [buffer]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useRefetchOnFocus(load);

  // One line per THING to pack. A design produces up to two: canvases (every
  // sale needs one) and kits (only "+ kit" sales do). They're genuinely
  // different numbers — a design can be fine on canvases and short on kits —
  // so they're never summed into a single figure.
  const gaps: Gap[] = [];
  for (const r of rows) {
    if (r.design) {
      const c = r.recommendedCanvas - (r.toteCanvas ?? 0);
      if (c > 0) gaps.push({ row: r, what: "canvas", need: r.recommendedCanvas, have: r.toteCanvas ?? 0, gap: c, atHome: r.design.homeCanvas });
      const k = r.recommendedKit - (r.toteKits ?? 0);
      if (k > 0) gaps.push({ row: r, what: "kit", need: r.recommendedKit, have: r.toteKits ?? 0, gap: k, atHome: r.design.homeKits });
    } else if (r.supply && r.inTote !== null && r.inTote < r.recommended) {
      gaps.push({ row: r, what: "supply", need: r.recommended, have: r.inTote, gap: r.recommended - r.inTote, atHome: r.supply.home });
    }
  }
  gaps.sort((a, b) => b.gap - a.gap || b.need - a.need);

  const canvasGap = gaps.filter((g) => g.what === "canvas").reduce((s, g) => s + g.gap, 0);
  const kitGap = gaps.filter((g) => g.what === "kit").reduce((s, g) => s + g.gap, 0);
  const supplyGap = gaps.filter((g) => g.what === "supply").reduce((s, g) => s + g.gap, 0);

  // Home -> market. Both endpoints clamp to what's actually at home, so asking
  // for more than exists moves what there is instead of failing.
  const move = async (row: PrepRow, what: "kit" | "canvas" | "supply", qty: number) => {
    if (qty <= 0) return;
    const key = `${row.name}-${what}`;
    setBusy(key);
    try {
      const res = what === "supply"
        ? await mutApi(`/api/supplies/${row.supply!.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ marketTransferDelta: qty }),
          })
        : await mutApi(`/api/designs/${row.design!.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canvasMove: { kind: what, from: "home", to: "market", qty } }),
          });
      if (!res.ok) throw new Error("move failed");
      await load();
    } catch {
      setError(`Couldn't move ${row.name}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-4xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-4xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-2">
          <h1 className="text-white font-semibold text-lg">Missing from Market</h1>
          <Link href="/market-prep" className="text-sm text-slate-400 hover:text-white">Full list →</Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Market Prep", href: "/market-prep" }, { label: "Missing" }]} className="mb-4" />

        <p className="text-sm text-slate-400 mb-4">
          How many <span className="text-white">canvases</span> and <span className="text-white">kits</span> to pack,
          from current tote stock against the recommended count. Every sale needs a canvas; only a
          &ldquo;+ kit&rdquo; sale needs a kit, so the two are counted separately. Anything already
          at target is hidden. Sip-and-stitch days are excluded.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <span className="text-xs uppercase tracking-wider text-slate-400">Buffer</span>
          <div className="inline-flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
            {BUFFERS.map((b) => (
              <button key={b.value} onClick={() => setBuffer(b.value)} title={b.hint}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  buffer === b.value ? "bg-rose-900 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/60 text-red-200 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-600 border-t-rose-500" />
          </div>
        ) : gaps.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-10 text-center">
            <p className="text-2xl font-bold text-emerald-400 mb-1">Tote is fully stocked</p>
            <p className="text-slate-400 text-sm">Every item is at or above its target for the next market.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Canvases to pack</p>
                <p className="text-2xl font-bold text-sky-400">{canvasGap}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Kits to pack</p>
                <p className="text-2xl font-bold text-rose-400">{kitGap}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Supplies</p>
                <p className="text-2xl font-bold text-purple-400">{supplyGap}</p>
              </div>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 divide-y divide-slate-700/60 overflow-hidden">
              {gaps.map((g) => {
                const key = `${g.row.name}-${g.what}`;
                const canMove = Math.min(g.gap, g.atHome);
                return (
                  <div key={key} className="p-3 md:p-4 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium">{g.row.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${KIND_BADGE[g.what === "supply" ? "supply" : g.what]}`}>
                          {g.what}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        need {g.need} · in tote <span className="text-emerald-400">{g.have}</span> · at home {g.atHome}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-2xl font-bold text-amber-400 leading-none">{g.gap}</p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">to pack</p>
                    </div>
                    <div className="flex-shrink-0">
                      {g.atHome === 0 ? (
                        <span className="text-xs text-red-400">none at home</span>
                      ) : (
                        <MoveButton
                          label={`Move ${canMove}`}
                          busy={busy === key}
                          disabled={busy !== null}
                          onClick={() => move(g.row, g.what, canMove)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MoveButton({ label, onClick, disabled, busy }: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled || busy}
      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-35 disabled:cursor-not-allowed">
      {busy ? "Moving…" : label}
    </button>
  );
}

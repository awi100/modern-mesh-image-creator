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
  design: DesignStock | null; supply: SupplyStock | null;
}

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

  // Only what the tote is SHORT of. Items with no stock record (inTote null)
  // can't be compared, so they're left out rather than guessed at.
  const short = rows
    .filter((r) => r.inTote !== null && r.inTote < r.recommended)
    .map((r) => ({ ...r, gap: r.recommended - (r.inTote ?? 0) }))
    .sort((a, b) => b.gap - a.gap || b.recommended - a.recommended);

  const totalGap = short.reduce((s, r) => s + r.gap, 0);

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
          Only what the tote is <span className="text-white">short of</span> — anything already stocked
          to target is hidden. Move stock from home straight from this list.
          Sip-and-stitch days are excluded from the targets.
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
        ) : short.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-10 text-center">
            <p className="text-2xl font-bold text-emerald-400 mb-1">Tote is fully stocked</p>
            <p className="text-slate-400 text-sm">Every item is at or above its target for the next market.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Items short</p>
                <p className="text-xl font-bold text-amber-400">{short.length}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Units to move</p>
                <p className="text-xl font-bold text-amber-400">{totalGap}</p>
              </div>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 divide-y divide-slate-700/60 overflow-hidden">
              {short.map((r) => {
                const d = r.design, s = r.supply;
                return (
                  <div key={r.name} className="p-3 md:p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-medium">{r.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${KIND_BADGE[r.kind]}`}>{r.kind}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          target {r.recommended} · in tote <span className="text-emerald-400">{r.inTote}</span>
                          {d && <> · at home {d.homeKits} kit{d.homeKits === 1 ? "" : "s"} / {d.homeCanvas} canvas</>}
                          {s && <> · at home {s.home}</>}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-2xl font-bold text-amber-400 leading-none">{r.gap}</p>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">short</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {d && (
                        <>
                          <MoveButton label={`Move ${Math.min(r.gap, d.homeKits)} kit`} disabled={d.homeKits === 0 || busy !== null}
                            busy={busy === `${r.name}-kit`} onClick={() => move(r, "kit", Math.min(r.gap, d.homeKits))} />
                          <MoveButton label={`Move ${Math.min(r.gap, d.homeCanvas)} canvas`} disabled={d.homeCanvas === 0 || busy !== null}
                            busy={busy === `${r.name}-canvas`} onClick={() => move(r, "canvas", Math.min(r.gap, d.homeCanvas))} />
                        </>
                      )}
                      {s && (
                        <MoveButton label={`Move ${Math.min(r.gap, s.home)}`} disabled={s.home === 0 || busy !== null}
                          busy={busy === `${r.name}-supply`} onClick={() => move(r, "supply", Math.min(r.gap, s.home))} />
                      )}
                      {!d && !s && <span className="text-xs text-slate-500">no stock record — move on the Inventory page</span>}
                      {d && d.homeKits === 0 && d.homeCanvas === 0 && (
                        <span className="text-xs text-red-400">nothing at home to move</span>
                      )}
                      {s && s.home === 0 && <span className="text-xs text-red-400">nothing at home to move</span>}
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

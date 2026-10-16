"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRefetchOnFocus } from "@/lib/use-refetch-on-focus";
import { mutApi } from "@/lib/mut-api";
import Link from "next/link";
import CountStepper from "@/components/inventory/CountStepper";
import PosDayClassifier from "./PosDayClassifier";
import BufferPicker, { type Buffer } from "./BufferPicker";

/**
 * Packing the market tote.
 *
 * This replaces two screens that were the same list twice: a "Plan" showing
 * every item with held/needed, and a "To pack" showing the short ones with
 * move buttons. That is a filter, not a second view — so it is a filter now,
 * and there is one list.
 *
 * Design notes, since the previous version got each of these wrong:
 *
 *  - The column labels are stated ONCE, in a header, not repeated on all 43
 *    rows. Repeating "CANVAS"/"KITS" per row is what made the list read as
 *    noise rather than a table.
 *  - The loud number on a row is what you GRAB ("+3"), not the ratio you'd
 *    have to subtract in your head. Held/needed is there, quietly, underneath.
 *  - Status is colour on the number plus one left edge. The old row carried an
 *    amber "SHORT" badge next to an amber border, on nearly every row, which
 *    is two alarms for the normal state before a market.
 *  - Sales history (peak, per-market run) is reference, not packing
 *    information, so it is one muted line and not a chart per row.
 *  - Buffer, past markets and day classification are configuration. They sit
 *    below the list in a panel you open, not stacked above the thing you came
 *    here to do.
 */

type Kind = "kit" | "canvas" | "supply" | "other";

interface DesignStock {
  id: string; marketKits: number; marketCanvas: number;
  homeKits: number; homeCanvas: number;
  andoverKits: number; andoverCanvas: number;
}
interface SupplyStock { id: string; market: number; home: number; }
interface PrepRow {
  name: string; kind: Kind; total: number; max: number; marketsSold: number;
  perMarket: number[]; recommended: number; inTote: number | null;
  recommendedCanvas: number; recommendedKit: number;
  toteCanvas: number | null; toteKits: number | null;
  design: DesignStock | null; supply: SupplyStock | null;
}
interface KindTotals { inTote: number; required: number; covered: number; toPack: number; offPlan: number }
interface Summary {
  marketCount: number; itemCount: number; buffer: Buffer;
  canvas: KindTotals; kit: KindTotals; supply: KindTotals;
}

/** One side of an item: canvases, or kits, or a supply's single count. */
interface Side { have: number; need: number; gap: number; atHome: number }

interface Item {
  row: PrepRow;
  name: string;
  isDesign: boolean;
  tracked: boolean;
  canvas: Side | null;
  kit: Side | null;
  single: Side | null;
  ready: boolean;
  gap: number;
}

const side = (have: number, need: number, atHome: number): Side => ({
  have, need, gap: Math.max(0, need - have), atHome,
});

type Filter = "todo" | "ready" | "all";

export default function MarketPack({
  buffer,
  onBufferChange,
  onMoved,
}: {
  buffer: Buffer;
  onBufferChange: (b: Buffer) => void;
  /** Stock moved home → tote; the host refreshes its own design list. */
  onMoved?: () => void;
}) {
  const [rows, setRows] = useState<PrepRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [markets, setMarkets] = useState<{ label: string; units: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todo");
  const [showSupplies, setShowSupplies] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/prep?buffer=${buffer}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setMarkets(data.markets ?? []);
      setError(null);
    } catch {
      setError("Couldn't load the market list.");
    } finally {
      setLoading(false);
    }
  }, [buffer]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useRefetchOnFocus(load);

  const { designs, supplies } = useMemo(() => {
    const toItem = (r: PrepRow): Item => {
      const isDesign = r.design !== null;
      if (isDesign) {
        const canvas = side(r.toteCanvas ?? 0, r.recommendedCanvas, r.design!.homeCanvas);
        const kit = side(r.toteKits ?? 0, r.recommendedKit, r.design!.homeKits);
        return {
          row: r, name: r.name, isDesign: true, tracked: true,
          canvas, kit, single: null,
          ready: canvas.gap === 0 && kit.gap === 0,
          gap: canvas.gap + kit.gap,
        };
      }
      const single = r.supply ? side(r.supply.market, r.recommended, r.supply.home) : null;
      return {
        row: r, name: r.name, isDesign: false, tracked: single !== null,
        canvas: null, kit: null, single,
        ready: single ? single.gap === 0 : false,
        gap: single?.gap ?? 0,
      };
    };
    const all = rows.map(toItem);
    return {
      designs: all.filter((i) => i.isDesign),
      supplies: all.filter((i) => !i.isDesign),
    };
  }, [rows]);

  const visible = designs.filter((i) =>
    filter === "all" ? true : filter === "ready" ? i.ready : !i.ready,
  );
  const todoCount = designs.filter((i) => !i.ready).length;
  const readyCount = designs.length - todoCount;
  const suppliesTodo = supplies.filter((i) => !i.ready);

  /** Move home → tote for one side of an item. */
  const move = async (item: Item, what: "canvas" | "kit" | "supply", qty: number) => {
    if (qty <= 0) return;
    const key = `${item.name}-${what}`;
    setBusy(key);
    try {
      const res = what === "supply"
        ? await mutApi(`/api/supplies/${item.row.supply!.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ marketTransferDelta: qty }),
          })
        : await mutApi(`/api/designs/${item.row.design!.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canvasMove: { kind: what, from: "home", to: "market", qty } }),
          });
      if (!res.ok) throw new Error("move failed");
      await load();
      onMoved?.();
    } catch {
      setError(`Couldn't move ${item.name}.`);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Change a design's tote count by hand.
   *
   * The two directions are NOT symmetric, and that's deliberate and
   * long-standing: raising the tote PULLS from home (a transfer, total
   * unchanged), lowering it REMOVES from the tote outright — stock taken back
   * out of the tote doesn't reappear at home, because in practice it was sold
   * or lost rather than carried back.
   *
   * Always sent as a delta, never as the absolute the client happens to be
   * showing: a POS sale landing between render and tap would otherwise be
   * partly rewound by the write.
   */
  const adjust = async (item: Item, what: "canvas" | "kit", delta: number) => {
    if (delta === 0) return;
    const key = `${item.name}-${what}`;
    setBusy(key);
    try {
      const body =
        delta > 0
          ? what === "canvas"
            ? { marketTransferCanvasDelta: delta }
            : { marketTransferKitsDelta: delta }
          : what === "canvas"
            ? { marketCanvasDelta: delta }
            : { marketKitsDelta: delta };
      const res = await mutApi(`/api/designs/${item.row.design!.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("adjust failed");
      await load();
      onMoved?.();
    } catch {
      setError(`Couldn't change ${item.name}.`);
    } finally {
      setBusy(null);
    }
  };

  /** Pack everything this design is short of, both sides, in one go. */
  const packRow = async (item: Item) => {
    const key = `${item.name}-row`;
    setBusy(key);
    try {
      for (const [what, s] of [["canvas", item.canvas], ["kit", item.kit]] as const) {
        if (!s) continue;
        const qty = Math.min(s.gap, s.atHome);
        if (qty <= 0) continue;
        const res = await mutApi(`/api/designs/${item.row.design!.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canvasMove: { kind: what, from: "home", to: "market", qty } }),
        });
        if (!res.ok) throw new Error("move failed");
      }
      await load();
      onMoved?.();
    } catch {
      setError(`Couldn't pack ${item.name}.`);
    } finally {
      setBusy(null);
    }
  };

  const copyList = () => {
    const text = designs
      .map((i) => `${i.name}\t${i.canvas?.need ?? 0} canvas\t${i.kit?.need ?? 0} kits`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {/* ---- How ready is the tote, in two bars ------------------------- */}
      {summary && !loading && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 mb-4">
          <ReadyBar label="Canvases" totals={summary.canvas} tone="sky" />
          <div className="h-3" />
          <ReadyBar label="Kits" totals={summary.kit} tone="rose" />
          {(summary.canvas.offPlan > 0 || summary.kit.offPlan > 0) && (
            <p className="text-[11px] text-slate-500 mt-3">
              Plus {summary.canvas.offPlan} canvases and {summary.kit.offPlan} kits in the tote for
              designs that have never sold at a market, so there is no target to size them against.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/60 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* ---- Filter ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="inline-flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
          {([
            ["todo", "To pack", todoCount],
            ["ready", "Ready", readyCount],
            ["all", "All", designs.length],
          ] as const).map(([v, label, n]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              aria-pressed={filter === v}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === v ? "bg-emerald-700 text-white" : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              {label} <span className="opacity-70 tabular-nums">{n}</span>
            </button>
          ))}
        </div>
        <button
          onClick={copyList}
          disabled={designs.length === 0}
          className="px-3 py-2 text-sm font-medium text-slate-300 hover:text-white rounded-lg disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy list"}
        </button>
      </div>

      {/* ---- The list ---------------------------------------------------- */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-slate-600 border-t-rose-500" />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-10 text-center">
          <p className="text-lg font-semibold text-emerald-400">
            {filter === "todo" ? "Nothing left to pack" : "Nothing here"}
          </p>
          <p className="text-slate-400 text-sm mt-1">
            {filter === "todo"
              ? "Every design is at or above its target for the next market."
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          {/* Column labels, said once. */}
          <div className="hidden md:flex items-center gap-3 px-3 py-2 bg-slate-900/60 border-b border-slate-700 text-[10px] uppercase tracking-wider text-slate-500">
            <span className="flex-1">Design</span>
            <span className="w-[92px] text-right">Canvases</span>
            <span className="w-[92px] text-right">Kits</span>
            <span className="w-[84px]" />
          </div>

          <div className="divide-y divide-slate-700/60">
            {visible.map((item) => (
              <ItemRow
                key={item.name}
                item={item}
                busy={busy}
                open={expanded === item.name}
                onToggle={() => setExpanded(expanded === item.name ? null : item.name)}
                onPack={() => packRow(item)}
                onAdjust={(what, delta) => adjust(item, what, delta)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ---- Supplies, separate and closed ------------------------------- */}
      {supplies.length > 0 && (
        <div className="mt-4 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <button
            onClick={() => setShowSupplies((s) => !s)}
            className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-700/40 transition-colors"
          >
            <span className="text-sm text-slate-300">
              Supplies
              {suppliesTodo.length > 0 ? (
                <span className="text-purple-300 font-medium"> · {summary?.supply.toPack ?? 0} to pack</span>
              ) : (
                <span className="text-emerald-400"> · all at target</span>
              )}
            </span>
            <Chevron open={showSupplies} />
          </button>
          {showSupplies && (
            <div className="border-t border-slate-700 divide-y divide-slate-700/60">
              {supplies.map((item) => (
                <SupplyRow
                  key={item.name}
                  item={item}
                  busy={busy}
                  onMove={(qty) => move(item, "supply", qty)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Configuration, below the work ------------------------------- */}
      <div className="mt-4 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <button
          onClick={() => setShowSettings((s) => !s)}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-700/40 transition-colors"
        >
          <span className="text-sm text-slate-300">
            How these targets are worked out
            {summary && (
              <span className="text-slate-500"> · {summary.marketCount} markets · {summary.buffer} buffer</span>
            )}
          </span>
          <Chevron open={showSettings} />
        </button>
        {showSettings && (
          <div className="border-t border-slate-700 p-4">
            <p className="text-sm text-slate-400 mb-4">
              Each target is your <span className="text-slate-200">busiest single market</span> for that
              item plus a safety buffer, so a good day doesn&apos;t sell you out. Every sale needs a
              canvas; only a &ldquo;+ kit&rdquo; sale needs a kit, which is why the two numbers differ.
              Sip-and-stitch days are left out.
            </p>
            <BufferPicker value={buffer} onChange={onBufferChange} showHints />
            {markets.length > 0 && (
              <p className="text-xs text-slate-500 mb-4 flex flex-wrap gap-x-2 gap-y-1">
                <span className="uppercase tracking-wider">Markets:</span>
                {markets.map((m) => (
                  <span key={m.label} title={`${m.units} units sold`}>
                    {m.label.slice(5)}<span className="text-slate-600">:{m.units}</span>
                  </span>
                ))}
              </p>
            )}
            <PosDayClassifier onChange={load} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Progress against target for one kind.
 *
 * The bar measures `covered`, not `inTote`: surplus on a design that's already
 * over target doesn't help you, and counting it would show a fuller bar than
 * the "to pack" figure beside it. covered + toPack === required exactly.
 */
function ReadyBar({
  label, totals, tone,
}: {
  label: string; totals: KindTotals; tone: "sky" | "rose";
}) {
  const pct = totals.required > 0 ? Math.round((totals.covered / totals.required) * 100) : 100;
  const done = totals.toPack === 0;
  const bar = tone === "sky" ? "bg-sky-500" : "bg-rose-500";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className="text-sm tabular-nums">
          {done ? (
            <span className="text-emerald-400 font-medium">all packed</span>
          ) : (
            <>
              <span className="text-amber-400 font-semibold">{totals.toPack}</span>
              <span className="text-slate-500"> still to pack</span>
            </>
          )}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-900 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${done ? "bg-emerald-500" : bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
        {totals.covered} of {totals.required} needed
        {totals.inTote > totals.covered && <> · {totals.inTote - totals.covered} spare</>}
      </p>
    </div>
  );
}

/** One design: what to grab, with held/needed underneath. Opens for detail. */
function ItemRow({
  item, busy, open, onToggle, onPack, onAdjust,
}: {
  item: Item;
  busy: string | null;
  open: boolean;
  onToggle: () => void;
  onPack: () => void;
  onAdjust: (what: "canvas" | "kit", delta: number) => void;
}) {
  const rowBusy = busy === `${item.name}-row`;
  const canPack =
    (item.canvas ? Math.min(item.canvas.gap, item.canvas.atHome) : 0) +
    (item.kit ? Math.min(item.kit.gap, item.kit.atHome) : 0);
  const stock = item.row.design;

  return (
    <div className={`border-l-2 ${item.ready ? "border-l-emerald-600" : "border-l-amber-500"} bg-slate-800`}>
      {/* The whole summary is the disclosure control; the Pack button inside it
          stops the click so one tap can't both pack and open the detail. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
        }}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 cursor-pointer hover:bg-slate-700/40 transition-colors"
      >
        <div className="w-full md:flex-1 min-w-0 flex items-center gap-2">
          <Chevron open={open} />
          <div className="min-w-0">
            <p className="text-white font-medium truncate">{item.name}</p>
            <p className="text-[11px] text-slate-500 truncate">
              peak {item.row.max} at one market · sold {item.row.total} over {item.row.marketsSold} of{" "}
              {item.row.perMarket.length}
            </p>
          </div>
        </div>

        <Cell side={item.canvas} />
        <Cell side={item.kit} />

        <div className="w-[84px] flex-shrink-0 ml-auto md:ml-0" onClick={(e) => e.stopPropagation()}>
          {item.ready ? (
            <span className="flex items-center justify-end md:justify-center gap-1 text-xs text-emerald-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              packed
            </span>
          ) : canPack === 0 ? (
            <span className="block text-xs text-slate-500 text-right md:text-center">none at home</span>
          ) : (
            <button
              onClick={onPack}
              disabled={busy !== null}
              className="w-full px-2 py-2 rounded-lg text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-35 disabled:cursor-not-allowed"
              title={`Move ${canPack} from home into the tote`}
            >
              {rowBusy ? "…" : `Pack ${canPack}`}
            </button>
          )}
        </div>
      </div>

      {open && stock && (
        <div className="border-t border-slate-700/60 bg-slate-900/40 px-3 py-4">
          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <ToteControl
              label="Canvases in the tote"
              side={item.canvas}
              busy={busy === `${item.name}-canvas`}
              disabled={busy !== null}
              onAdjust={(d) => onAdjust("canvas", d)}
              atHome={stock.homeCanvas}
              atAndover={stock.andoverCanvas}
              ariaLabel={`Canvases in the market tote for ${item.name}`}
            />
            <ToteControl
              label="Kits in the tote"
              side={item.kit}
              busy={busy === `${item.name}-kit`}
              disabled={busy !== null}
              onAdjust={(d) => onAdjust("kit", d)}
              atHome={stock.homeKits}
              atAndover={stock.andoverKits}
              ariaLabel={`Kits in the market tote for ${item.name}`}
            />
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
            <Stat label="Target canvases" value={item.canvas?.need ?? 0} hint={`peak ${item.row.max} + buffer`} />
            <Stat label="Target kits" value={item.kit?.need ?? 0} hint="only “+ kit” sales" />
            <Stat label="At home" value={`${stock.homeCanvas}c · ${stock.homeKits}k`} />
            <Stat label="At Andover" value={`${stock.andoverCanvas}c · ${stock.andoverKits}k`} />
          </dl>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Sold per market, oldest first
              </p>
              <p className="text-xs text-slate-400 tabular-nums break-words">
                {item.row.perMarket.join(" · ")}
              </p>
            </div>
            <Link
              href={`/design/${stock.id}/info`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-slate-400 hover:text-white whitespace-nowrap"
            >
              Open design →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Set the tote count by hand: +/- or type a number.
 *
 * Raising pulls from home; lowering removes from the tote outright and does
 * NOT return stock home. That asymmetry is the app's long-standing market
 * semantics, so it's spelled out here rather than left to be discovered.
 */
function ToteControl({
  label, side, busy, disabled, onAdjust, atHome, atAndover, ariaLabel,
}: {
  label: string;
  side: Side | null;
  busy: boolean;
  disabled: boolean;
  onAdjust: (delta: number) => void;
  atHome: number;
  atAndover: number;
  ariaLabel: string;
}) {
  if (!side) return null;
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
      <p className="text-xs text-slate-400 mb-2">{label}</p>
      <div className="flex items-center gap-3">
        <CountStepper
          value={side.have}
          // Converted to a delta against the value just rendered, so a typed
          // number composes with the server instead of overwriting it.
          onCommit={(next) => onAdjust(next - side.have)}
          onDelta={(d) => onAdjust(d)}
          size="md"
          tone="market"
          ariaLabel={ariaLabel}
          busy={busy}
          disabled={disabled && !busy}
          disableIncrement={atHome <= 0}
          incrementTitle={atHome > 0 ? "Move one from home into the tote" : "Nothing at home to move"}
          decrementTitle="Take one out of the tote (it does not go back home)"
        />
        <div className="text-xs leading-tight">
          <p className={side.gap > 0 ? "text-amber-400" : "text-emerald-400"}>
            {side.gap > 0 ? `${side.gap} short of ${side.need}` : `at target (${side.need})`}
          </p>
          <p className="text-slate-500">
            {atHome} at home
            {atAndover > 0 && <span className="text-sky-400"> · {atAndover} at Andover</span>}
          </p>
        </div>
      </div>
      {side.gap > 0 && atHome === 0 && (
        <p className="text-[11px] text-red-400 mt-2">
          {atAndover > 0
            ? `None at home — ${atAndover} are at Andover, so pick them up before the market.`
            : "None at home and none at Andover — these have to be made."}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-slate-200 font-medium tabular-nums">{value}</dd>
      {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
    </div>
  );
}

/**
 * One number cell. The gap is the loud figure because that's what you carry;
 * held/needed sits underneath for when you want to check the reasoning.
 */
function Cell({ side }: { side: Side | null }) {
  if (!side || side.need === 0) {
    return (
      <div className="w-[92px] flex-shrink-0 text-right">
        <p className="text-sm text-slate-600">—</p>
      </div>
    );
  }
  const short = side.gap > 0;
  const stuck = short && side.atHome === 0;
  return (
    <div className="w-[92px] flex-shrink-0 text-right">
      <p className={`text-lg font-semibold leading-none tabular-nums ${
        stuck ? "text-red-400" : short ? "text-amber-400" : "text-emerald-400"
      }`}>
        {short ? `+${side.gap}` : "✓"}
      </p>
      <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
        {side.have}/{side.need}
        <span className="text-slate-600"> · {side.atHome} home</span>
      </p>
    </div>
  );
}

function SupplyRow({
  item, busy, onMove,
}: {
  item: Item; busy: string | null; onMove: (qty: number) => void;
}) {
  const s = item.single;
  const key = `${item.name}-supply`;
  if (!s) {
    return (
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        <span className="text-slate-300 text-sm truncate">{item.name}</span>
        <span className="text-xs text-slate-500">not tracked</span>
      </div>
    );
  }
  const canMove = Math.min(s.gap, s.atHome);
  return (
    <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex-1 min-w-0 text-slate-200 text-sm truncate">{item.name}</span>
      <Cell side={s} />
      <div className="w-[84px] flex-shrink-0">
        {s.gap === 0 ? (
          <span className="block text-xs text-emerald-400 text-center">packed</span>
        ) : canMove === 0 ? (
          <span className="block text-xs text-slate-500 text-center">none at home</span>
        ) : (
          <button
            onClick={() => onMove(canMove)}
            disabled={busy !== null}
            className="w-full px-2 py-2 rounded-lg text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-35"
          >
            {busy === key ? "…" : `Pack ${canMove}`}
          </button>
        )}
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

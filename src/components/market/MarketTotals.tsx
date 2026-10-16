"use client";

/**
 * Canvases and kits on one line, side by side — each with what's in the tote,
 * what the market needs, and what's still to carry.
 *
 * They are kept apart deliberately. A canvas and a kit are different objects:
 * every sale needs a canvas, only a "+ kit" sale needs a kit, so the tote holds
 * different numbers of each and the market needs different numbers of each.
 * Adding them was what made 3 canvases + 3 kits read as "6 in tote".
 */

export interface KindTotals {
  inTote: number;
  required: number;
  toPack: number;
  offPlan: number;
}

const TONE = {
  canvas: { label: "Canvases", accent: "text-sky-300", big: "text-sky-400" },
  kit: { label: "Kits", accent: "text-rose-300", big: "text-rose-400" },
} as const;

function Half({ kind, totals }: { kind: "canvas" | "kit"; totals: KindTotals }) {
  const t = TONE[kind];
  const done = totals.toPack === 0;
  return (
    <div className="flex-1 min-w-[150px] p-3">
      <p className={`text-xs uppercase tracking-wider ${t.accent}`}>{t.label}</p>
      <p className="mt-1 flex items-baseline gap-1.5 flex-wrap">
        <span className="text-2xl font-bold text-white leading-none">{totals.inTote}</span>
        <span className="text-slate-500 text-sm">in tote</span>
        <span className="text-slate-600">/</span>
        <span className={`text-lg font-semibold leading-none ${t.big}`}>{totals.required}</span>
        <span className="text-slate-500 text-sm">needed</span>
      </p>
      <p className={`text-sm mt-1 font-medium ${done ? "text-emerald-400" : "text-amber-400"}`}>
        {done ? "nothing to pack" : `${totals.toPack} still to pack`}
      </p>
    </div>
  );
}

export default function MarketTotals({
  canvas,
  kit,
  className = "",
}: {
  canvas: KindTotals;
  kit: KindTotals;
  className?: string;
}) {
  const offPlan = canvas.offPlan + kit.offPlan;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-stretch bg-slate-800 rounded-xl border border-slate-700 divide-x divide-slate-700/60 overflow-hidden">
        <Half kind="canvas" totals={canvas} />
        <Half kind="kit" totals={kit} />
      </div>
      {offPlan > 0 && (
        <p className="text-[11px] text-slate-500 mt-1.5">
          Plus {canvas.offPlan} canvases and {kit.offPlan} kits in the tote for designs with no market
          sales to plan from — they&apos;re in the Market tab&apos;s tote totals but can&apos;t be given a target.
          &ldquo;Still to pack&rdquo; adds up each design&apos;s own shortfall, so a surplus of one design
          never covers another.
        </p>
      )}
    </div>
  );
}

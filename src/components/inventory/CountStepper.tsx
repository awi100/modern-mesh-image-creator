"use client";

import React, { useState } from "react";

/**
 * The one count stepper for every inventory surface (threads, kits, canvases,
 * market tote, Andover, supplies, bobbins, misprints).
 *
 * Before this existed the same control was re-implemented ~21 times across four
 * pages and drifted into several different commit paths — some committed on
 * every keystroke, some committed on BOTH Enter and the blur it triggered
 * (applying the delta twice), and most turned a cleared box into `Number("")`
 * = 0, silently zeroing real stock. Every behaviour below is deliberate:
 *
 *  - Commit happens on BLUR only. Enter just blurs, so there is exactly one
 *    commit path and Enter can never double-apply.
 *  - A cleared/!isFinite box is DISCARDED (reverts to the real value), never
 *    committed as 0. Zeroing stock has to be typed deliberately as "0".
 *  - Values are floored and clamped to [min, max] before committing, and we
 *    only call onCommit when the value actually changed.
 *  - The wheel is ignored: scrolling the page with the pointer over a focused
 *    number input used to silently edit stock.
 *  - `busy` disables both buttons so a double-tap can't fire two mutations.
 */

export type StepperTone = "neutral" | "home" | "market" | "andover" | "supply";
export type StepperSize = "sm" | "md";

// `text` is kept separate from `input` so a caller-supplied valueClassName
// (e.g. red when out of stock) can replace it outright — two conflicting
// Tailwind text-colour utilities on one element resolve by CSS order, not by
// the order they appear in the class string, so they must never both be set.
const TONE: Record<StepperTone, { input: string; text: string; ring: string; label: string }> = {
  // Home is deliberately neutral so it can't be confused with Market (emerald)
  // or Andover (sky) — those two colours mean "location" everywhere in the app.
  neutral: { input: "bg-slate-700 border-slate-600", text: "text-white", ring: "focus:ring-slate-400", label: "text-slate-500" },
  home: { input: "bg-slate-700 border-slate-600", text: "text-white", ring: "focus:ring-slate-400", label: "text-slate-500" },
  market: { input: "bg-slate-700 border-emerald-700/60", text: "text-emerald-200", ring: "focus:ring-emerald-700", label: "text-emerald-500" },
  andover: { input: "bg-slate-700 border-sky-700/60", text: "text-sky-200", ring: "focus:ring-sky-700", label: "text-sky-500" },
  supply: { input: "bg-slate-700 border-purple-700/60", text: "text-purple-200", ring: "focus:ring-purple-700", label: "text-purple-400" },
};

const SIZE: Record<StepperSize, { btn: string; icon: string; input: string; text: string }> = {
  // sm for dense tables; md meets the 44px touch target for phone use.
  sm: { btn: "h-8 w-8", icon: "w-4 h-4", input: "w-14 h-8", text: "text-sm" },
  md: { btn: "h-11 w-11", icon: "w-5 h-5", input: "w-16 h-11", text: "text-base" },
};

export interface CountStepperProps {
  value: number;
  /** Commit an absolute, already-clamped value. */
  onCommit: (next: number) => void | Promise<unknown>;
  /** If given, the −/+ buttons send a delta instead of an absolute value. */
  onDelta?: (delta: number) => void | Promise<unknown>;
  min?: number;
  max?: number;
  step?: number;
  tone?: StepperTone;
  size?: StepperSize;
  /** Required. Describes the count, e.g. "Home kits for Anchor". */
  ariaLabel: string;
  /** Optional uppercase caption above the control. */
  label?: string;
  /** Tooltip for the caption (e.g. explaining market semantics). */
  labelTitle?: string;
  /** Disables both buttons while a mutation is in flight. */
  busy?: boolean;
  disabled?: boolean;
  /**
   * Disable one direction independently of the value — e.g. a Market "+" pulls
   * stock from Home, so it must be disabled when Home is empty even though the
   * market count itself is nowhere near its max.
   */
  disableIncrement?: boolean;
  disableDecrement?: boolean;
  /** Extra classes for the input text (e.g. red when out of stock). */
  valueClassName?: string;
  decrementTitle?: string;
  incrementTitle?: string;
}

export default function CountStepper({
  value,
  onCommit,
  onDelta,
  min = 0,
  max,
  step = 1,
  tone = "neutral",
  size = "sm",
  ariaLabel,
  label,
  labelTitle,
  busy = false,
  disabled = false,
  disableIncrement = false,
  disableDecrement = false,
  valueClassName = "",
  decrementTitle,
  incrementTitle,
}: CountStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const t = TONE[tone];
  const s = SIZE[size];

  const clamp = (n: number) => {
    let v = Math.floor(n);
    if (v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
  };

  const commitDraft = () => {
    const raw = draft;
    setDraft(null); // always drop the draft; the real value re-renders
    if (raw === null || raw.trim() === "") return; // cleared → discard, never 0
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = clamp(parsed);
    if (next !== value) onCommit(next);
  };

  const bump = (delta: number) => {
    if (busy || disabled) return;
    if (onDelta) {
      // Let the caller clamp against the authoritative value.
      const next = clamp(value + delta);
      if (next !== value) onDelta(next - value);
      return;
    }
    const next = clamp(value + delta);
    if (next !== value) onCommit(next);
  };

  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;

  const btnBase =
    "flex items-center justify-center flex-shrink-0 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400";

  return (
    <div className="flex flex-col items-center gap-1">
      {label && (
        <span className={`text-[10px] uppercase tracking-wider ${t.label}`} title={labelTitle}>
          {label}
        </span>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => bump(-step)}
          disabled={disabled || busy || atMin || disableDecrement}
          aria-label={`Remove one — ${ariaLabel}`}
          title={decrementTitle ?? "Remove 1"}
          className={`${btnBase} ${s.btn}`}
        >
          <svg className={s.icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>

        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          aria-label={ariaLabel}
          disabled={disabled}
          value={draft ?? value}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          // Scrolling the page with the pointer over a focused number input
          // would otherwise silently change stock.
          onWheel={(e) => e.currentTarget.blur()}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur(); // blur is the single commit path
            } else if (e.key === "Escape") {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          className={`${s.input} ${s.text} px-1 text-center font-medium border rounded focus:outline-none focus:ring-2 ${t.input} ${t.ring} ${valueClassName || t.text} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
        />

        <button
          type="button"
          onClick={() => bump(step)}
          disabled={disabled || busy || atMax || disableIncrement}
          aria-label={`Add one — ${ariaLabel}`}
          title={incrementTitle ?? "Add 1"}
          className={`${btnBase} ${s.btn}`}
        >
          <svg className={s.icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

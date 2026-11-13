"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  DMC_PEARL_COTTON,
  getDmcColorByNumber,
  rgbToLab,
  type DmcColor,
} from "@/lib/dmc-pearl-cotton";
import { deltaE2000, ladderViolations, readLadder } from "@/lib/dmc-palette-checks";
import { provenanceOf, type ColorSource } from "@/lib/dmc-provenance";
import { downloadFile } from "@/lib/shopping-list-export";
import EXTERNAL_VALUES from "./external-values.json";

// The instrument for judging palette hex values, so the next change to
// dmc-pearl-cotton.ts is argued from a recorded verdict instead of from memory.
//
// Two modes, in order of how much they cost to run:
//
// LADDER needs nothing but the screen. DMC names encode lightness, so a family
// whose L* does not fall as the names darken is wrong with no external truth
// required — which is the only kind of evidence a palette of eyeballed values
// gives up for free. How many hexes still carry the fingerprint of eyeballing
// (all three bytes on an 8-step grid) is counted in dmc-palette-checks.ts and
// quoted nowhere else: two files quoting the same figure is two files to
// correct, and the last correction left this one a batch behind. That file is
// also where the ladder check itself lives; this page only draws it.
//
// A/B needs a physical skein, which bounds it to the 77 colours we actually
// hold. It is deliberately blinded and side-randomised: an unblinded comparison
// is answered by whichever value you typed last, because a new value looks like
// an improvement simply for being new.
//
// Verdicts stay in localStorage. Writing them to Postgres needs the owner's
// approval and a backup first (CLAUDE.md), so the CSV export is the way out —
// the data must not be trapped in one browser profile.

type Mode = "ladder" | "ab";
type Side = "left" | "right";
type Slot = "current" | "candidate";

const STORAGE_KEY = "palette-review-verdicts-v1";

/** Same set the preview modal offers, plus the neutral default. A thread judged
 *  against mid-grey can still miss once it is printed on Natural canvas, which
 *  is the only surround that matches what we actually sell. */
const SURROUNDS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Mid grey", hex: "#777777" },
  { name: "Natural", hex: "#f5f0e6" },
  { name: "White", hex: "#ffffff" },
  { name: "Cream", hex: "#fffdd0" },
  { name: "Light Blue", hex: "#e6f0f5" },
  { name: "Light Pink", hex: "#f5e6e6" },
  { name: "Light Green", hex: "#e6f5e6" },
];

/** The slot is covered by the skein; this is only what shows through at the
 *  edges. Near-black reads as a shadow under the thread, where a mid tone would
 *  read as a third colour competing with the two being judged. */
const SLOT_BACKING = "#121212";

/** The two public tables, per DMC code.
 *
 *  `cameliaAlt` exists because camelia is keyed by NAME, not by code, and lists
 *  BLANC twice — "Blanc, White, #eeeeee" and "White, White, #ffffff". Taking
 *  the first row and dropping the second (which is what generating this file
 *  did at first) presents a coin toss as the dataset's answer, so both are
 *  carried and `ambiguity` says so on the page. Judge them as two candidates. */
interface ExternalEntry {
  wolfram?: string;
  camelia?: string;
  cameliaAlt?: string;
  ambiguity?: string;
}

const EXTERNAL = EXTERNAL_VALUES as Record<string, ExternalEntry>;

const PROVENANCE_LABEL: Record<ColorSource, string> = {
  "legacy-eyeballed": "eyeballed",
  "hand-corrected": "hand-corrected",
  measured: "measured",
};

const PROVENANCE_CLASS: Record<ColorSource, string> = {
  "legacy-eyeballed": "bg-slate-700 text-slate-300",
  "hand-corrected": "bg-amber-900 text-amber-200",
  measured: "bg-emerald-900 text-emerald-200",
};

function normalizeHex(raw: string): string | null {
  const t = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(t)) {
    return "#" + t.split("").map((c) => c + c).join("").toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(t)) return "#" + t.toUpperCase();
  return null;
}

function hexToLab(hex: string): { l: number; a: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** White text on a dark swatch, black on a light one, so the L* figure under a
 *  band stays readable across the whole ladder. */
function readableOn(hex: string): string {
  return hexToLab(hex).l > 60 ? "#111111" : "#f8f8f8";
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

interface Verdict {
  recordedAt: string;
  dmcNumber: string;
  name: string;
  currentHex: string;
  candidateHex: string;
  candidateSource: string;
  /** Which slot was drawn on the left for this trial — the blinding record. */
  leftWas: Slot;
  chose: Side | "tie";
  winner: Slot | "tie";
  deltaE: number;
  surround: string;
  slotMm: number | null;
}

// ---------------------------------------------------------------------------

export default function PaletteReviewPage() {
  const [mode, setMode] = useState<Mode>("ladder");
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [loadedVerdicts, setLoadedVerdicts] = useState(false);
  /** DMC numbers with stock on hand — the ones a skein can actually be held
   *  against. Everything else can only be judged on the ladder. */
  const [inStock, setInStock] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setVerdicts(parsed as Verdict[]);
      }
    } catch {
      // private browsing / cleared storage — start empty rather than blow up
    }
    setLoadedVerdicts(true);
  }, []);

  useEffect(() => {
    if (!loadedVerdicts) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(verdicts));
    } catch {
      // storage full — the CSV button is still the real way the data leaves
    }
  }, [verdicts, loadedVerdicts]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/inventory");
        if (!res.ok) return;
        const items: { dmcNumber: string; skeins: number }[] = await res.json();
        if (cancelled) return;
        setInStock(new Set(items.filter((i) => i.skeins > 0).map((i) => i.dmcNumber)));
      } catch {
        // non-critical — the "on hand" marks just won't show
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const addVerdict = useCallback((v: Verdict) => {
    setVerdicts((prev) => [v, ...prev]);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-5xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-2">
          <h1 className="text-white font-semibold text-lg">Palette Review</h1>
          <div className="flex gap-1 bg-slate-900 rounded-lg p-1">
            <button
              onClick={() => setMode("ladder")}
              className={`px-3 py-1 rounded-md text-sm font-medium ${
                mode === "ladder" ? "bg-rose-900 text-white" : "text-slate-300 hover:text-white"
              }`}
            >
              Family ladder
            </button>
            <button
              onClick={() => setMode("ab")}
              className={`px-3 py-1 rounded-md text-sm font-medium ${
                mode === "ab" ? "bg-rose-900 text-white" : "text-slate-300 hover:text-white"
              }`}
            >
              A/B vs skein
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Tools", href: "/tools" }, { label: "Palette Review" }]} className="mb-4" />
        {mode === "ladder"
          ? <LadderMode inStock={inStock} />
          : <AbMode inStock={inStock} verdicts={verdicts} onVerdict={addVerdict} onClear={() => setVerdicts([])} />}
      </div>
    </div>
  );
}

// --- Mode 1: family ladder -------------------------------------------------

interface FamilyRow {
  key: string;
  label: string;
  members: DmcColor[];
  /** Violating pairs inside this family, by `${lighter}<${darker}`. */
  brokenKeys: Set<string>;
}

function LadderMode({ inStock }: { inStock: Set<string> }) {
  const { families, violations } = useMemo(() => {
    const byFamily = new Map<string, DmcColor[]>();
    for (const c of DMC_PEARL_COTTON) {
      const r = readLadder(c);
      const list = byFamily.get(r.family) ?? [];
      list.push(c);
      byFamily.set(r.family, list);
    }
    const vs = ladderViolations(DMC_PEARL_COTTON);
    const brokenByFamily = new Map<string, Set<string>>();
    for (const v of vs) {
      const set = brokenByFamily.get(v.family) ?? new Set<string>();
      set.add(v.key);
      brokenByFamily.set(v.family, set);
    }
    const rows: FamilyRow[] = [];
    for (const [key, members] of byFamily) {
      // A one-member family is kept. It has no pair, so the ladder can never
      // say anything about it — which is exactly why dropping it was wrong:
      // 535 is its own family ("Very Light Ash Gray", L* 31.0) and is the
      // largest correction in the batch at 31.3 dE2000, so it is the entry most
      // in need of a look and it was the one silently absent from the picker.
      rows.push({
        key,
        label: titleCase(key),
        // Name order, lightest first: this is the order DMC's own naming
        // claims, and the whole point is to see where L* disagrees with it.
        members: [...members].sort((a, b) => readLadder(a).rank - readLadder(b).rank || a.lab.l - b.lab.l),
        brokenKeys: brokenByFamily.get(key) ?? new Set<string>(),
      });
    }
    rows.sort((a, b) =>
      (b.brokenKeys.size > 0 ? 1 : 0) - (a.brokenKeys.size > 0 ? 1 : 0) || a.label.localeCompare(b.label));
    return { families: rows, violations: vs };
  }, []);

  const [familyKey, setFamilyKey] = useState(() => families[0]?.key ?? "");
  const family = families.find((f) => f.key === familyKey) ?? families[0];
  const brokenCount = families.filter((f) => f.brokenKeys.size > 0).length;
  const singletonCount = families.filter((f) => f.members.length === 1).length;

  return (
    <>
      <p className="text-sm text-slate-400 mb-5">
        DMC names are a lightness ladder — Ultra Very Light through Ultra Very Dark. Where L* does not
        fall as the names darken, the hex is <span className="text-white">provably wrong</span>, with no
        skein and no external dataset needed. Only pairs where both names carry an explicit modifier are
        asserted on; an unmodified name is not reliably the middle of its family.
      </p>

      <p className="text-sm text-slate-400 mb-5">
        {singletonCount} of the {families.length} families have a single member — no pair, so the ladder
        can say nothing about them either way. They are still in the picker: 535 is one of them, and at
        31.3 dE2000 it is the largest correction in this batch. Silence is not a pass.
      </p>

      {violations.length > 0 && (
        <div className="bg-slate-800 border border-red-900 rounded-xl p-4 mb-6">
          <h2 className="text-white font-semibold mb-1">
            {violations.length} inverted {violations.length === 1 ? "pair" : "pairs"} across {brokenCount}{" "}
            {brokenCount === 1 ? "family" : "families"}
          </h2>
          <p className="text-sm text-slate-400 mb-3">
            The lighter-named colour is the darker value on screen. Pick one to see it in its ladder.
          </p>
          <div className="space-y-1">
            {violations.map((v) => (
              <button
                key={v.key}
                onClick={() => setFamilyKey(v.family)}
                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-slate-700/60"
              >
                <Chip hex={v.lighter.hex} />
                <span className="text-sm text-slate-200 truncate">
                  {v.lighter.dmcNumber} {v.lighter.name}
                </span>
                <span className="text-xs text-slate-500 flex-shrink-0">L* {v.lighter.lab.l.toFixed(1)}</span>
                <span className="text-slate-500 flex-shrink-0">is darker than</span>
                <Chip hex={v.darker.hex} />
                <span className="text-sm text-slate-200 truncate">
                  {v.darker.dmcNumber} {v.darker.name}
                </span>
                <span className="text-xs text-slate-500 flex-shrink-0">L* {v.darker.lab.l.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <label htmlFor="family" className="text-sm text-slate-400">Family</label>
        <select
          id="family"
          value={family?.key ?? ""}
          onChange={(e) => setFamilyKey(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
        >
          {families.map((f) => (
            <option key={f.key} value={f.key}>
              {f.brokenKeys.size > 0 ? "! " : ""}{f.label} ({f.members.length})
            </option>
          ))}
        </select>
      </div>

      {family && family.members.length === 1 && (
        <p className="text-xs text-amber-300 mb-2">
          Only member of its family. Nothing here is checked — the band below is the value as it stands.
        </p>
      )}

      {family && (
        <div className="rounded-xl overflow-hidden border border-slate-700">
          {family.members.map((c, i) => {
            const prev = family.members[i - 1];
            // Flag the band itself when it is the darker half of a violating
            // pair with anything above it, so the break is visible in place and
            // not only in the summary.
            const inverted = family.members.some((o, j) =>
              j < i && family.brokenKeys.has(`${o.dmcNumber}<${c.dmcNumber}`));
            const ink = readableOn(c.hex);
            return (
              <div key={c.dmcNumber} style={{ background: c.hex }} className="px-4 py-5 relative">
                <div className="flex items-baseline gap-3" style={{ color: ink }}>
                  <span className="font-semibold">{c.dmcNumber}</span>
                  <span className="text-sm truncate">{c.name}</span>
                  <span className="ml-auto text-sm tabular-nums font-semibold">
                    L* {c.lab.l.toFixed(1)}
                  </span>
                  {prev && (
                    <span className="text-xs tabular-nums opacity-70 w-14 text-right">
                      {c.lab.l - prev.lab.l >= 0 ? "+" : ""}{(c.lab.l - prev.lab.l).toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${PROVENANCE_CLASS[provenanceOf(c.dmcNumber)]}`}
                  >
                    {PROVENANCE_LABEL[provenanceOf(c.dmcNumber)]}
                  </span>
                  {inStock.has(c.dmcNumber) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900 text-sky-200">on hand</span>
                  )}
                  {inverted && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-700 text-white font-semibold">
                      inverted — lighter name, darker value
                    </span>
                  )}
                  <span className="text-[10px] font-mono opacity-60" style={{ color: ink }}>{c.hex}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** `masked` paints flat slate instead of the colour. Every chip that can sit on
 *  screen during a live A/B trial takes it: a 16px swatch of the candidate is
 *  enough to name the side in about a second, which is the whole experiment. */
function Chip({ hex, masked }: { hex: string; masked?: boolean }) {
  if (masked) {
    return (
      <span
        className="w-4 h-4 rounded flex-shrink-0 border border-slate-600 bg-slate-700"
        title="Hidden until you answer"
      />
    );
  }
  return <span className="w-4 h-4 rounded flex-shrink-0 border border-black/30" style={{ background: hex }} />;
}

// --- Mode 2: blinded A/B against a physical skein ---------------------------

function AbMode({
  inStock, verdicts, onVerdict, onClear,
}: {
  inStock: Set<string>;
  verdicts: Verdict[];
  onVerdict: (v: Verdict) => void;
  onClear: () => void;
}) {
  const [dmcNumber, setDmcNumber] = useState("310");
  const [candidateRaw, setCandidateRaw] = useState("");
  const [candidateSource, setCandidateSource] = useState("typed");
  const [surround, setSurround] = useState(SURROUNDS[0].hex);
  const [slotOn, setSlotOn] = useState(false);
  const [slotMm, setSlotMm] = useState(10);
  const [leftWas, setLeftWas] = useState<Slot>("current");
  const [revealed, setRevealed] = useState<Verdict | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const color = getDmcColorByNumber(dmcNumber) ?? DMC_PEARL_COTTON[0];
  const candidate = normalizeHex(candidateRaw);
  const suggestions = EXTERNAL[color.dmcNumber];

  // A recorded verdict unblinds ONLY the trial it was recorded for. Derived
  // rather than cleared in the effect below because an effect runs after paint:
  // picking a second candidate while the first is revealed would otherwise
  // paint one frame of the new colour under the old trial's side labels.
  const answered =
    revealed && revealed.dmcNumber === color.dmcNumber && revealed.candidateHex === candidate
      ? revealed
      : null;

  /** A trial is on screen and not yet answered. While this holds, NOTHING
   *  outside the stage may carry either value — not the candidate and not the
   *  current one, since naming either half names the side. */
  const blinded = candidate !== null && answered === null;

  const randomise = useCallback(() => {
    setLeftWas(Math.random() < 0.5 ? "current" : "candidate");
    setRevealed(null);
  }, []);

  // A changed colour or candidate is a fresh trial, so the side has to be drawn
  // again — otherwise a run of trials all land the same way round and the
  // blinding is only nominal.
  useEffect(() => { randomise(); }, [dmcNumber, candidate, randomise]);

  const record = useCallback((chose: Side | "tie") => {
    if (!candidate || answered) return;
    const winner: Slot | "tie" =
      chose === "tie" ? "tie" : (chose === "left") === (leftWas === "current") ? "current" : "candidate";
    const v: Verdict = {
      recordedAt: new Date().toISOString(),
      dmcNumber: color.dmcNumber,
      name: color.name,
      currentHex: color.hex,
      candidateHex: candidate,
      candidateSource,
      leftWas,
      chose,
      winner,
      deltaE: deltaE2000(color.lab, hexToLab(candidate)),
      surround,
      slotMm: slotOn ? slotMm : null,
    };
    onVerdict(v);
    setRevealed(v);
  }, [candidate, answered, leftWas, color, candidateSource, surround, slotOn, slotMm, onVerdict]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === "ArrowLeft") record("left");
      else if (e.key === "ArrowRight") record("right");
      else if (e.key === "?" || e.key === "0") record("tie");
      else if (e.key === "n" && answered) randomise();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [record, randomise, answered]);

  const tally = useMemo(() => {
    if (!candidate) return null;
    const mine = verdicts.filter(
      (v) => v.dmcNumber === color.dmcNumber && v.candidateHex === candidate && v.currentHex === color.hex);
    return {
      n: mine.length,
      current: mine.filter((v) => v.winner === "current").length,
      candidate: mine.filter((v) => v.winner === "candidate").length,
      tie: mine.filter((v) => v.winner === "tie").length,
    };
  }, [verdicts, color, candidate]);

  const leftHex = leftWas === "current" ? color.hex : (candidate ?? color.hex);
  const rightHex = leftWas === "current" ? (candidate ?? color.hex) : color.hex;

  return (
    <>
      <p className="text-sm text-slate-400 mb-4">
        One colour at a time, two values butted edge to edge with no gap — a seam makes a mismatch jump
        out, where a gap lets simultaneous contrast hide it. Which side is which is drawn at random and
        hidden until you have answered — and so is every swatch on this page, because one 16px chip of
        the candidate sitting above the stage answers it for you.
      </p>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="dmc" className="text-sm text-slate-400">Colour</label>
          <select
            id="dmc"
            value={color.dmcNumber}
            onChange={(e) => setDmcNumber(e.target.value)}
            className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            {DMC_PEARL_COTTON.map((c) => (
              <option key={c.dmcNumber} value={c.dmcNumber}>
                {inStock.has(c.dmcNumber) ? "• " : ""}{c.dmcNumber} — {c.name}
              </option>
            ))}
          </select>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${PROVENANCE_CLASS[provenanceOf(color.dmcNumber)]}`}>
            {PROVENANCE_LABEL[provenanceOf(color.dmcNumber)]}
          </span>
        </div>
        {!inStock.has(color.dmcNumber) && (
          <p className="text-xs text-amber-300">
            No stock on hand for {color.dmcNumber} — nothing to hold against the screen. A verdict here is
            screen-vs-screen, which is not what this mode is for.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="cand" className="text-sm text-slate-400">Candidate</label>
          <input
            id="cand"
            value={candidateRaw}
            onChange={(e) => { setCandidateRaw(e.target.value); setCandidateSource("typed"); }}
            placeholder="#A1B2C3"
            spellCheck={false}
            className="w-32 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm font-mono"
          />
          {suggestions?.wolfram && (
            <SuggestionButton
              label="Wolfram"
              hex={suggestions.wolfram}
              blinded={blinded}
              onPick={() => { setCandidateRaw(suggestions.wolfram!); setCandidateSource("wolfram"); }}
            />
          )}
          {suggestions?.camelia && (
            <SuggestionButton
              label={suggestions.cameliaAlt ? "camelia 1" : "camelia"}
              hex={suggestions.camelia}
              blinded={blinded}
              onPick={() => { setCandidateRaw(suggestions.camelia!); setCandidateSource("camelia"); }}
            />
          )}
          {suggestions?.cameliaAlt && (
            <SuggestionButton
              label="camelia 2"
              hex={suggestions.cameliaAlt}
              blinded={blinded}
              onPick={() => { setCandidateRaw(suggestions.cameliaAlt!); setCandidateSource("camelia-alt"); }}
            />
          )}
          {candidate && (
            <span className="text-xs text-slate-400 tabular-nums">
              {deltaE2000(color.lab, hexToLab(candidate)).toFixed(2)} dE2000 from ours
            </span>
          )}
          {candidateRaw.trim() !== "" && !candidate && (
            <span className="text-xs text-red-300">not a hex</span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Wolfram and camelia are the two best public datasets, and they disagree with{" "}
          <em>each other</em> by a median 4.05 dE2000 — the same size as their disagreement with ours.
          They are starting points to judge, not answers.
          {suggestions?.ambiguity && <span className="text-amber-300"> {suggestions.ambiguity}</span>}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            {SURROUNDS.map((s) => (
              <button
                key={s.hex}
                onClick={() => setSurround(s.hex)}
                title={s.name}
                aria-label={`Surround: ${s.name}`}
                aria-pressed={surround === s.hex}
                className={`w-7 h-7 rounded-md border-2 ${
                  surround === s.hex ? "border-rose-400" : "border-slate-600"
                }`}
                style={{ background: s.hex }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={slotOn} onChange={(e) => setSlotOn(e.target.checked)} />
            Skein slot
          </label>
          {slotOn && (
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="range"
                min={4}
                max={24}
                step={1}
                value={slotMm}
                onChange={(e) => setSlotMm(Number(e.target.value))}
              />
              <span className="tabular-nums w-12">{slotMm} mm</span>
            </label>
          )}
          <button
            onClick={() => stageRef.current?.requestFullscreen?.()}
            className="ml-auto text-sm text-slate-300 hover:text-white underline"
          >
            Full screen
          </button>
        </div>
        {slotOn && (
          <p className="text-xs text-slate-500">
            Lay the skein in the slot so the candidate surrounds it — surround beats adjacency for judging
            a match. The millimetre figure is nominal: CSS assumes 96 dpi, so widen the slot until it fits
            the skein rather than trusting the number.
          </p>
        )}
      </div>

      {candidate ? (
        <>
          <div ref={stageRef} style={{ background: surround }} className="p-4 md:p-8 rounded-xl">
            <Stage leftHex={leftHex} rightHex={rightHex} slotMm={slotOn ? slotMm : null} />
          </div>

          <div className="grid grid-cols-2 gap-0 mt-2 text-center text-sm">
            <div className="text-slate-300">
              {answered ? <Revealed slot={leftWas} hex={leftHex} /> : "Left"}
            </div>
            <div className="text-slate-300">
              {answered ? <Revealed slot={leftWas === "current" ? "candidate" : "current"} hex={rightHex} /> : "Right"}
            </div>
          </div>

          {answered ? (
            <div className="mt-4 bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap items-center gap-3">
              <span className="text-white">
                {answered.winner === "tie"
                  ? "Recorded: can't tell."
                  : `Recorded: the ${answered.winner === "current" ? "current palette value" : "candidate"} matched better.`}
              </span>
              {tally && tally.n > 1 && (
                <span className="text-sm text-slate-400">
                  {tally.n} trials on this pair — current {tally.current}, candidate {tally.candidate}, tie {tally.tie}
                </span>
              )}
              <button
                onClick={randomise}
                className="ml-auto px-4 py-2 rounded-lg bg-rose-900 hover:bg-rose-800 text-white text-sm font-medium"
              >
                Run it again (n)
              </button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button
                onClick={() => record("left")}
                className="px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-500 text-white text-sm font-medium"
              >
                Left matches (←)
              </button>
              <button
                onClick={() => record("tie")}
                className="px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-300 text-sm font-medium"
              >
                Can&apos;t tell (0)
              </button>
              <button
                onClick={() => record("right")}
                className="px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-500 text-white text-sm font-medium"
              >
                Right matches (→)
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="bg-slate-800 border border-dashed border-slate-700 rounded-xl p-8 text-center text-slate-400 text-sm">
          Enter a candidate hex, or take one of the dataset values above, to start a trial.
        </div>
      )}

      <VerdictLog verdicts={verdicts} blinded={blinded} onClear={onClear} />
    </>
  );
}

/** The hex text stays readable while blinded — six characters are not a match
 *  you can make by eye — but the swatch goes flat until the trial is answered. */
function SuggestionButton(
  { label, hex, blinded, onPick }: { label: string; hex: string; blinded: boolean; onPick: () => void },
) {
  return (
    <button
      onClick={onPick}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-500 text-xs text-slate-300"
    >
      <Chip hex={hex} masked={blinded} />
      {label} <span className="font-mono opacity-70">{hex}</span>
    </button>
  );
}

function Revealed({ slot, hex }: { slot: Slot; hex: string }) {
  return (
    <span>
      {slot === "current" ? "current" : "candidate"} <span className="font-mono text-slate-400">{hex}</span>
    </span>
  );
}

/** Two swatches, butted, no border and no gap. With the slot on, the gap runs
 *  across both halves so one skein lies surrounded by both candidates at once. */
function Stage({ leftHex, rightHex, slotMm }: { leftHex: string; rightHex: string; slotMm: number | null }) {
  const band = (h: string) => (
    <div className="flex" style={{ height: h }}>
      <div className="w-1/2 h-full" style={{ background: leftHex }} />
      <div className="w-1/2 h-full" style={{ background: rightHex }} />
    </div>
  );
  if (slotMm === null) return band("min(58vh, 28rem)");
  return (
    <div>
      {band("min(26vh, 13rem)")}
      <div style={{ height: `${slotMm}mm`, background: SLOT_BACKING }} />
      {band("min(26vh, 13rem)")}
    </div>
  );
}

/** `blinded` masks EVERY chip in the log, not just the rows for the colour on
 *  trial: a row for the same DMC number with some other candidate still shows
 *  the current value, which names the side just as well, and picking through
 *  which rows are safe is how the blind leaks back in. The rows stay readable
 *  as text throughout. */
function VerdictLog(
  { verdicts, blinded, onClear }: { verdicts: Verdict[]; blinded: boolean; onClear: () => void },
) {
  const exportCsv = useCallback(() => {
    const head = [
      "recordedAt", "dmcNumber", "name", "currentHex", "candidateHex", "candidateSource",
      "leftWas", "chose", "winner", "deltaE2000", "surround", "slotMm",
    ];
    const rows = verdicts.map((v) => [
      v.recordedAt, v.dmcNumber, `"${v.name.replace(/"/g, '""')}"`, v.currentHex, v.candidateHex,
      v.candidateSource, v.leftWas, v.chose, v.winner, v.deltaE.toFixed(3), v.surround,
      v.slotMm === null ? "" : String(v.slotMm),
    ]);
    downloadFile(
      [head.join(","), ...rows.map((r) => r.join(","))].join("\n"),
      `palette-verdicts-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv",
    );
  }, [verdicts]);

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-white font-semibold">Verdicts ({verdicts.length})</h2>
        <button
          onClick={exportCsv}
          disabled={verdicts.length === 0}
          className="ml-auto px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-500 disabled:opacity-40 text-slate-200 text-sm"
        >
          Download CSV
        </button>
        <button
          onClick={() => { if (confirm(`Delete all ${verdicts.length} verdicts? Export first — they are not in the database.`)) onClear(); }}
          disabled={verdicts.length === 0}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-red-700 disabled:opacity-40 text-slate-400 text-sm"
        >
          Clear
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Held in this browser only — nothing is written to the database. Export before clearing storage or
        switching machine.
      </p>
      {verdicts.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl divide-y divide-slate-700 max-h-80 overflow-y-auto">
          {verdicts.map((v, i) => (
            <div key={`${v.recordedAt}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Chip hex={v.currentHex} masked={blinded} />
              <Chip hex={v.candidateHex} masked={blinded} />
              <span className="text-slate-200 truncate">{v.dmcNumber} {v.name}</span>
              <span className={`text-xs ${v.winner === "candidate" ? "text-emerald-300" : v.winner === "current" ? "text-slate-400" : "text-amber-300"}`}>
                {v.winner === "tie" ? "can't tell" : `${v.winner} wins`}
              </span>
              <span className="ml-auto text-xs text-slate-500 tabular-nums flex-shrink-0">
                {v.deltaE.toFixed(1)} dE · {new Date(v.recordedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

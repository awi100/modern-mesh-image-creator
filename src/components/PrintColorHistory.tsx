"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

interface Diff { dmcNumber: string; from: string | null; to: string | null }
interface Revision {
  id: string;
  overrides: Record<string, string>;
  source: string;
  note: string | null;
  createdAt: string;
  changed: Diff[];
}

const SOURCE_LABEL: Record<string, string> = {
  baseline: "Before tracking",
  print: "Sent to print",
  manual: "Saved",
  restore: "Restored",
};

const SOURCE_TONE: Record<string, string> = {
  baseline: "bg-slate-700 text-slate-300",
  print: "bg-emerald-900/60 text-emerald-300",
  manual: "bg-sky-900/60 text-sky-300",
  restore: "bg-amber-900/60 text-amber-300",
};

/** The DMC's own hex, which is what a colour reverts to when its override is
 *  cleared — so a swatch can show "back to stock" rather than an empty gap. */
const baseHex = (dmc: string) => getDmcColorByNumber(dmc)?.hex ?? "#888888";

function Swatch({ hex, title }: { hex: string; title: string }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded border border-slate-600 align-middle"
      style={{ backgroundColor: hex }}
      title={title}
    />
  );
}

export function PrintColorHistory({
  designId,
  currentOverrides,
  onRestore,
}: {
  designId: string;
  /** Passed in so the panel re-checks for unsaved changes as sliders move. */
  currentOverrides: Record<string, string>;
  onRestore: (overrides: Record<string, string>) => void;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [unsaved, setUnsaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/designs/${designId}/print-colors`);
      if (!res.ok) throw new Error(`Could not load history (${res.status})`);
      const data = await res.json();
      setRevisions(data.revisions ?? []);
      setUnsaved(!!data.unsavedChanges);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, [designId]);

  useEffect(() => { load(); }, [load]);

  // The colours auto-save on a debounce, so by the time a slider settles the
  // server already has the new values; re-asking is what keeps "unsaved"
  // honest without duplicating the comparison on the client.
  useEffect(() => {
    const t = setTimeout(load, 900);
    return () => clearTimeout(t);
  }, [currentOverrides, load]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/designs/${designId}/print-colors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note || null, source: "manual" }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json();
      if (data.unchanged) setError("These colours match the last saved run — nothing to record.");
      else { setError(null); setNote(""); }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (r: Revision) => {
    const when = new Date(r.createdAt).toLocaleDateString();
    if (!confirm(`Bring back the print colours from ${when}? The current ones stay in the history.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/designs/${designId}/print-colors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restoreId: r.id }),
      });
      if (!res.ok) throw new Error(`Restore failed (${res.status})`);
      const data = await res.json();
      onRestore(data.overrides ?? {});
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-white">Print Colour History</h2>
        <p className="text-sm text-slate-400 mt-1">
          What was sent to the printer each time, so this run can be compared with the last.
        </p>
      </div>

      <div className="p-4 border-b border-slate-700 flex flex-col sm:flex-row gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What changed? e.g. greens warmer for the Nov reorder"
          className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500"
        />
        <button
          onClick={save}
          disabled={busy}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? "Saving..." : "Save these colours"}
        </button>
      </div>

      {unsaved && (
        <p className="px-4 py-2 text-xs text-amber-400 border-b border-slate-700">
          The colours have moved since the last entry — save them to keep a record of this run.
        </p>
      )}
      {error && <p className="px-4 py-2 text-xs text-red-400 border-b border-slate-700">{error}</p>}

      {loading ? (
        <p className="p-4 text-sm text-slate-500">Loading…</p>
      ) : revisions.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">
          No history yet. The colours in use now are recorded automatically the first time you adjust one.
        </p>
      ) : (
        <ul className="divide-y divide-slate-700">
          {revisions.map((r, i) => {
            const count = Object.keys(r.overrides).length;
            const open = expanded === r.id;
            return (
              <li key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_TONE[r.source] ?? "bg-slate-700 text-slate-300"}`}>
                        {SOURCE_LABEL[r.source] ?? r.source}
                      </span>
                      <span className="text-sm text-white">
                        {new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      {i === 0 && <span className="text-xs text-emerald-400">current</span>}
                    </div>
                    {r.note && <p className="text-sm text-slate-400 mt-1">{r.note}</p>}
                    <p className="text-xs text-slate-500 mt-1">
                      {count === 0 ? "No adjustments — stock DMC colours" : `${count} colour${count === 1 ? "" : "s"} adjusted`}
                      {r.changed.length > 0 && ` · ${r.changed.length} changed from the entry before`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {count > 0 && (
                      <button onClick={() => setExpanded(open ? null : r.id)} className="text-xs text-slate-400 hover:text-white">
                        {open ? "Hide" : "Show"}
                      </button>
                    )}
                    {i !== 0 && (
                      <button
                        onClick={() => restore(r)}
                        disabled={busy}
                        className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-xs disabled:opacity-50"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>

                {r.changed.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.changed.map((c) => (
                      <span key={c.dmcNumber} className="inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-900 rounded px-2 py-1">
                        <span className="text-slate-300">{c.dmcNumber}</span>
                        <Swatch hex={c.from ?? baseHex(c.dmcNumber)} title={c.from ?? "stock colour"} />
                        <span className="text-slate-600">→</span>
                        <Swatch hex={c.to ?? baseHex(c.dmcNumber)} title={c.to ?? "stock colour"} />
                        {c.to === null && <span className="text-slate-600">reset</span>}
                      </span>
                    ))}
                  </div>
                )}

                {open && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(r.overrides).map(([dmc, hex]) => (
                      <span key={dmc} className="inline-flex items-center gap-1.5 text-xs text-slate-400 bg-slate-900 rounded px-2 py-1">
                        <Swatch hex={hex} title={hex} />
                        <span className="text-slate-300">{dmc}</span>
                        <span className="font-mono text-slate-500">{hex}</span>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

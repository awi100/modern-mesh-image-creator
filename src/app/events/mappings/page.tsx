"use client";

import { useCallback, useEffect, useState } from "react";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import { mutApi } from "@/lib/mut-api";
import DesignPicker from "@/components/events/DesignPicker";

interface Mapping {
  id: string; answerKey: string; answerText: string; designId: string | null;
  design: { id: string; name: string; meshCount: number; archivedAt: string | null } | null;
  needsKit: boolean; note: string | null; tickets: number;
}

/**
 * Every checkout answer and the design it means.
 *
 * This list exists because the option list cannot be read from Ticket Tailor —
 * /checkout_forms returns element IDs and there is no endpoint to expand them,
 * so an answer only becomes known once somebody picks it. New options will keep
 * appearing here for as long as events run.
 */
export default function MappingsPage() {
  const [rows, setRows] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ticket-tailor/mappings");
      if (!res.ok) throw new Error(`Could not load mappings (${res.status})`);
      setRows(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load mappings");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (answer: string, designId: string | null) => {
    setBusy(true); setError(null);
    try {
      const res = await mutApi("/api/ticket-tailor/mappings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, designId, needsKit: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setNote(`Updated “${answer}”. ${data.ticketsReresolved} tickets re-resolved.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const remove = async (m: Mapping) => {
    if (!confirm(`Remove the mapping for “${m.answerText}”? Its ${m.tickets} ticket(s) go back to unmapped.`)) return;
    setBusy(true);
    try {
      const res = await mutApi(`/api/ticket-tailor/mappings?id=${m.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-5xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-3 md:py-4">
          <Breadcrumb items={[{ label: "Events", href: "/events" }, { label: "Canvas mappings" }]} />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 md:px-4 py-6 space-y-4">
        <p className="text-sm text-slate-400">
          What each checkout answer means. Changing one re-resolves every ticket that ever gave
          that answer, past events included. “Not a canvas” is for answers that should be ignored
          rather than left undecided.
        </p>
        {note && <p className="text-sm text-emerald-400">{note}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {loading ? <p className="text-slate-500">Loading…</p> : (
          <div className="bg-slate-800 border border-slate-700 rounded-xl divide-y divide-slate-700">
            {rows.map((m) => (
              <div key={m.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm">{m.answerText}</p>
                  <p className="text-xs text-slate-500">
                    {m.tickets} ticket{m.tickets === 1 ? "" : "s"}
                    {m.note ? ` · ${m.note}` : ""}
                  </p>
                </div>
                <div className="text-sm shrink-0">
                  {m.design ? (
                    <span className="text-slate-200">
                      {m.design.name} <span className="text-slate-500 text-xs">{m.design.meshCount}ct</span>
                      {m.design.archivedAt && <span className="ml-1 text-xs text-red-400">archived</span>}
                    </span>
                  ) : (
                    <span className="text-slate-500">not a canvas</span>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <DesignPicker onPick={(designId) => save(m.answerText, designId)} disabled={busy} label="Change" />
                  <button onClick={() => save(m.answerText, null)} disabled={busy}
                    className="text-xs text-slate-500 hover:text-white disabled:opacity-50 whitespace-nowrap">
                    not a canvas
                  </button>
                  <button onClick={() => remove(m)} disabled={busy}
                    className="text-xs text-slate-600 hover:text-red-400 disabled:opacity-50">remove</button>
                </div>
              </div>
            ))}
            {rows.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">No mappings yet.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

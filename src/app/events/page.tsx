"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { EventListRow } from "@/app/api/ticket-tailor/events/route";

/**
 * Sip-and-stitch events from Ticket Tailor.
 *
 * Several can be selling at once, so this is a plain list rather than a "current
 * event" — soonest first, with the state badge doing the work of saying what,
 * if anything, needs doing.
 */
export default function EventsPage() {
  const [rows, setRows] = useState<EventListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ticket-tailor/events");
      if (!res.ok) throw new Error(`Could not load events (${res.status})`);
      setRows(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true); setNote(null); setError(null);
    try {
      const res = await fetch("/api/ticket-tailor/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Sync failed (${res.status})`);
      setNote(
        `Synced ${data.events} events, ${data.orders} orders, ${data.tickets} tickets.` +
        (data.masked ? ` ${data.masked} answers are hidden — the API key cannot read customer data.` : "") +
        (data.unmapped ? ` ${data.unmapped} picks are not mapped yet.` : ""),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    return {
      upcoming: rows.filter((r) => new Date(r.startsAt).getTime() >= now)
        .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)),
      past: rows.filter((r) => new Date(r.startsAt).getTime() < now),
    };
  }, [rows]);

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-5xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <Breadcrumb items={[{ label: "Events" }]} />
          <div className="flex items-center gap-2">
            <Link href="/events/mappings" className="px-3 py-2 text-sm text-slate-300 hover:text-white">
              Canvas mappings
            </Link>
            <button
              onClick={sync}
              disabled={syncing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync from Ticket Tailor"}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 md:px-4 py-6 space-y-6">
        <p className="text-sm text-slate-400">
          Signups come from Ticket Tailor. Syncing never changes stock — canvases and kits come
          off only when you open an event and press the deduct button, after you have pulled them.
        </p>

        {note && <p className="text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded-lg px-3 py-2">{note}</p>}
        {error && <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">{error}</p>}

        {loading ? (
          <p className="text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-slate-500">
            No events yet. Press “Sync from Ticket Tailor”.
          </p>
        ) : (
          <>
            <Section title="Upcoming" rows={upcoming} empty="Nothing upcoming." />
            <Section title="Past" rows={past} empty="No past events." />
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, rows, empty }: { title: string; rows: EventListRow[]; empty: string }) {
  return (
    <div>
      <h2 className="text-white font-semibold mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="space-y-2">{rows.map((r) => <Row key={r.id} r={r} />)}</div>
      )}
    </div>
  );
}

function Row({ r }: { r: EventListRow }) {
  const needsAttention = r.unmapped > 0 || r.noAnswer > 0 || r.masked > 0;
  return (
    <Link
      href={`/events/${r.ttEventId}`}
      className="block bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 hover:border-slate-600"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium">{r.name}</span>
            <StateBadge state={r.state} confirmedAt={r.confirmedAt} needsAttention={needsAttention} />
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            {new Date(r.startsAt).toLocaleDateString(undefined, {
              weekday: "short", day: "numeric", month: "short", year: "numeric",
            })}
            {r.venueName ? ` · ${r.venueName}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-4 text-sm shrink-0">
          <Stat label="tickets" value={r.liveTickets} />
          {r.voided > 0 && <Stat label="voided" value={r.voided} tone="text-slate-500" />}
          {r.masked > 0 && <Stat label="hidden" value={r.masked} tone="text-red-400" />}
          {r.unmapped > 0 && <Stat label="unmapped" value={r.unmapped} tone="text-amber-400" />}
          {r.noAnswer > 0 && <Stat label="no answer" value={r.noAnswer} tone="text-amber-400" />}
          {r.excluded > 0 && <Stat label="left out" value={r.excluded} tone="text-slate-500" />}
          {r.deducted > 0 && <Stat label="deducted" value={r.deducted} tone="text-emerald-400" />}
        </div>
      </div>
    </Link>
  );
}

function Stat({ label, value, tone = "text-white" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="text-center">
      <p className={`font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function StateBadge({ state, confirmedAt, needsAttention }: { state: string; confirmedAt: string | null; needsAttention: boolean }) {
  // "Deducted" wins over everything: once stock has moved, that is the single
  // most important thing to know about an event.
  if (state === "confirmed") {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-900/60 text-emerald-300">
        Deducted{confirmedAt ? ` ${new Date(confirmedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
      </span>
    );
  }
  if (needsAttention) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-900/60 text-amber-300">Needs attention</span>;
  }
  if (state === "historical") {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-300">Historical</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-900/60 text-sky-300">Not deducted</span>;
}

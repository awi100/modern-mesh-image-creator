"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import { mutApi } from "@/lib/mut-api";
import DesignPicker from "@/components/events/DesignPicker";

interface DesignRef { id: string; name: string; meshCount: number }
interface Attendee {
  ttTicketId: string; attendeeName: string | null; orderNumber: string | null;
  orderStatus: string | null; buyerName: string | null; canvasAnswer: string | null;
  resolveStatus: string; design: DesignRef | null; overrideDesignId: string | null;
  overrideNote: string | null; needsKit: boolean; voidedAt: string | null;
  orderCancelled: boolean; ticketTypeName: string | null; listedPriceCents: number | null;
}
interface Stock {
  canvasHome: number; canvasMarket: number; canvasAndover: number;
  kitsHome: number; kitsMarket: number; kitsAndover: number;
  kitPool: { name: string | null; members: number } | null;
}
interface ToBring { designId: string; designName: string | null; tickets: number; canvas: number; kits: number; stock: Stock | null }
interface Discrepancy { kind: string; message: string; count?: number; ttTicketIds?: string[] }
interface Deduction {
  id: string; ttTicketId: string; designName: string | null; location: string;
  canvasRequested: number; canvasDeducted: number; kitsRequested: number; kitsDeducted: number;
  canvasFromAndover: number; kitsFromAndover: number; skippedForPos: boolean; reversedAt: string | null;
}
interface Detail {
  event: {
    id: string; ttEventId: string; name: string; venueName: string | null; startsAt: string;
    state: string; allowHistoricalConfirm: boolean; confirmedAt: string | null;
    confirmLocation: string | null; confirmDeductKits: boolean; lastSyncedAt: string | null; posDay: string;
  };
  attendees: Attendee[];
  toBring: ToBring[];
  plan: { totalCanvas: number; totalKits: number; unmapped: number; noAnswer: number; ignored: number; excluded: number; masked: number };
  unmappedAnswers: { answer: string; tickets: number }[];
  posOverlap: { designId: string; designName: string | null; tickets: number; posUnits: number; posKits: number }[];
  discrepancies: Discrepancy[];
  deductions: Deduction[];
  revenueCents: number;
}
interface PlanLine extends ToBring {
  canvasDraw: { fromPrimary: number; fromAndover: number; total: number; short: number } | null;
  kitDraw: { fromPrimary: number; fromAndover: number; total: number; short: number } | null;
}
interface PlanResp {
  location: string; totalCanvas: number; totalKits: number; lines: PlanLine[];
  skipped: { designId: string; designName: string | null; canvas: number; kits: number }[];
  posOverlap: Detail["posOverlap"]; blockers: string[]; canConfirm: boolean;
}

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

export default function EventDetailPage() {
  const id = useParams().id as string;
  const [d, setD] = useState<Detail | null>(null);
  const [plan, setPlan] = useState<PlanResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Events always draw on home stock, falling back to Andover. There is no
  // choice to make, so there is no control for it.
  const location = "home" as const;
  const [deductKits, setDeductKits] = useState(true);
  const [skip, setSkip] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ticket-tailor/events/${id}`);
      if (!res.ok) throw new Error(`Could not load event (${res.status})`);
      const data: Detail = await res.json();
      setD(data);
      setDeductKits(data.event.confirmDeductKits);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load event");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadPlan = useCallback(async () => {
    const qs = new URLSearchParams({ location, deductKits: String(deductKits) });
    if (skip.size) qs.set("skip", [...skip].join(","));
    const res = await fetch(`/api/ticket-tailor/events/${id}/plan?${qs}`);
    if (res.ok) setPlan(await res.json());
  }, [id, location, deductKits, skip]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (d) loadPlan(); }, [d, loadPlan]);

  const confirmed = d?.event.state === "confirmed";

  const deduct = async () => {
    if (!plan || !d) return;
    const msg =
      `Deduct ${plan.totalCanvas} canvases` + (plan.totalKits ? ` and ${plan.totalKits} kits` : "") +
      ` from home stock?\n\n` +
      `Only do this once you have physically pulled them. You can undo it, but it changes real counts.`;
    if (!confirm(msg)) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await mutApi(`/api/ticket-tailor/events/${id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, deductKits, skipDesignIds: [...skip] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setNote(
        `Deducted ${data.canvasDeducted} canvases and ${data.kitsDeducted} kits from home.` +
        (data.shortLines ? ` ${data.shortLines} lines came up short — see below.` : "") +
        (data.skipped ? ` ${data.skipped} skipped as already sold through POS.` : ""),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const undo = async () => {
    if (!confirm("Put all of this event's canvases and kits back? Each unit returns to where it came from.")) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await mutApi(`/api/ticket-tailor/events/${id}/confirm`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setNote(`Put back ${data.restoredCanvas} canvases and ${data.restoredKits} kits.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const setOverride = async (ttTicketId: string, designId: string | null) => {
    setBusy(true);
    try {
      const res = await mutApi(`/api/ticket-tailor/tickets/${ttTicketId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideDesignId: designId, overrideNote: designId ? "Swapped at the event" : null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const mapAnswer = async (answer: string, designId: string | null) => {
    setBusy(true);
    try {
      const res = await mutApi("/api/ticket-tailor/mappings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, designId, needsKit: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setNote(`Mapped “${answer}”. ${data.ticketsReresolved} tickets updated.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  /**
   * Restore or deduct a single ticket.
   *
   * Both are per-ticket on purpose. A void after confirmation is NOT restored
   * automatically: the money came back but the canvas may have gone home with
   * the attendee, so putting stock back would invent it. Someone has to say.
   */
  const ticketStock = async (ttTicketId: string, action: "restore" | "deduct") => {
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await mutApi(`/api/ticket-tailor/tickets/${ttTicketId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setNote(action === "restore"
        ? `Put back ${data.canvas} canvas and ${data.kits} kit${data.kits === 1 ? "" : "s"} of ${data.designName ?? "that design"}.`
        : `Deducted ${data.canvas} canvas and ${data.kits} kit${data.kits === 1 ? "" : "s"} of ${data.designName ?? "that design"}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const unlock = async () => {
    setBusy(true);
    try {
      await mutApi(`/api/ticket-tailor/events/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowHistoricalConfirm: true }),
      });
      await load();
    } finally { setBusy(false); }
  };

  const live = useMemo(() => (d?.attendees ?? []).filter((a) => !a.voidedAt && !a.orderCancelled), [d]);

  if (loading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!d) return <Shell><p className="text-red-400">{error ?? "Not found"}</p></Shell>;

  return (
    <Shell
      crumb={d.event.name}
      right={
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          confirmed ? "bg-emerald-900/60 text-emerald-300"
          : d.event.state === "historical" ? "bg-slate-700 text-slate-300"
          : "bg-sky-900/60 text-sky-300"}`}>
          {confirmed
            ? `Stock deducted ${d.event.confirmedAt ? new Date(d.event.confirmedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""}`
            : d.event.state === "historical" ? "Historical" : "Stock not deducted"}
        </span>
      }
    >
      <div className="space-y-6">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <h1 className="text-white text-lg font-semibold">{d.event.name}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {new Date(d.event.startsAt).toLocaleString(undefined, {
              weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
            })}
            {d.event.venueName ? ` · ${d.event.venueName}` : ""}
          </p>
          <div className="flex gap-6 mt-3 text-sm flex-wrap">
            <Fact label="Tickets" value={String(live.length)} />
            <Fact label="Canvases needed" value={String(d.plan.totalCanvas)} />
            <Fact label="Kits needed" value={String(d.plan.totalKits)} />
            <Fact label="Ticket revenue" value={money(d.revenueCents)} />
            {d.plan.excluded > 0 && <Fact label="Voided / cancelled" value={String(d.plan.excluded)} />}
          </div>
        </div>

        {note && <p className="text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded-lg px-3 py-2">{note}</p>}
        {error && <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">{error}</p>}

        {d.discrepancies.length > 0 && (
          <Card title="Needs a look">
            <ul className="space-y-2">
              {d.discrepancies.map((x, i) => (
                <li key={i} className="text-sm text-amber-300 bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2">
                  {x.message}
                  {x.kind === "historical_unconfirmed" && !d.event.allowHistoricalConfirm && (
                    <button onClick={unlock} disabled={busy}
                      className="ml-2 underline text-amber-200 hover:text-white disabled:opacity-50">
                      Allow deduction anyway
                    </button>
                  )}
                  {(x.kind === "voided_after_confirm" || x.kind === "override_changed_after_confirm") && (x.ttTicketIds ?? []).map((tid) => (
                    <button key={tid} onClick={() => ticketStock(tid, "restore")} disabled={busy}
                      className="ml-2 px-2 py-0.5 rounded bg-amber-900/60 text-amber-100 hover:bg-amber-800 text-xs disabled:opacity-50">
                      Put this one back
                    </button>
                  ))}
                  {x.kind === "new_ticket_after_confirm" && (
                    <span className="ml-2 inline-flex flex-wrap gap-1">
                      {(x.ttTicketIds ?? []).map((tid) => (
                        <button key={tid} onClick={() => ticketStock(tid, "deduct")} disabled={busy}
                          className="px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-100 hover:bg-emerald-800 text-xs disabled:opacity-50">
                          Deduct {d.attendees.find((a) => a.ttTicketId === tid)?.attendeeName ?? tid}
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {d.unmappedAnswers.length > 0 && (
          <Card title={`Canvas picks we don't recognise (${d.unmappedAnswers.length})`}
                subtitle="Match each one to a design — every ticket that gave that answer updates at once.">
            <div className="space-y-3">
              {d.unmappedAnswers.map((u) => (
                <div key={u.answer} className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm">{u.answer}</p>
                    <p className="text-xs text-slate-500">{u.tickets} ticket{u.tickets === 1 ? "" : "s"}</p>
                  </div>
                  <DesignPicker onPick={(designId) => mapAnswer(u.answer, designId)} disabled={busy} />
                  <button onClick={() => mapAnswer(u.answer, null)} disabled={busy}
                    className="px-3 py-2 text-xs text-slate-400 hover:text-white disabled:opacity-50 whitespace-nowrap">
                    Not a canvas
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="What to bring"
              subtitle={`Per design, against stock at home / market tote / Andover. Kits shown are thread sets.`}>
          {d.toBring.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing resolved yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 text-left">
                    <th className="pb-2">Design</th>
                    <th className="pb-2 text-center">Tickets</th>
                    <th className="pb-2 text-center">Canvas</th>
                    <th className="pb-2 text-center">Kits</th>
                    <th className="pb-2">Canvas in stock</th>
                    <th className="pb-2">Kits in stock</th>
                  </tr>
                </thead>
                <tbody>
                  {d.toBring.map((t) => {
                    const s = t.stock;
                    const canvasTotal = s ? s.canvasHome + s.canvasMarket + s.canvasAndover : 0;
                    const kitTotal = s ? s.kitsHome + s.kitsMarket + s.kitsAndover : 0;
                    return (
                      <tr key={t.designId} className="border-t border-slate-700">
                        <td className="py-2 text-white">{t.designName ?? t.designId}</td>
                        <td className="py-2 text-center text-slate-300">{t.tickets}</td>
                        <td className={`py-2 text-center font-medium ${canvasTotal < t.canvas ? "text-red-400" : "text-white"}`}>{t.canvas}</td>
                        <td className={`py-2 text-center font-medium ${kitTotal < t.kits ? "text-red-400" : "text-white"}`}>{t.kits}</td>
                        <td className="py-2 text-slate-400">{s ? `${s.canvasHome} / ${s.canvasMarket} / ${s.canvasAndover}` : "—"}</td>
                        <td className="py-2 text-slate-400">
                          {s ? `${s.kitsHome} / ${s.kitsMarket} / ${s.kitsAndover}` : "—"}
                          {s?.kitPool && <span className="ml-1 text-xs text-sky-400">pool: {s.kitPool.name}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {confirmed ? (
          <Card title="Stock has been deducted"
                subtitle={`${d.event.confirmedAt ? new Date(d.event.confirmedAt).toLocaleString() : ""} · from ${d.event.confirmLocation ?? "home"} stock`}>
            <DeductionTable rows={d.deductions} />
            <button onClick={undo} disabled={busy}
              className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm disabled:opacity-50">
              {busy ? "Working…" : "Undo — put it all back"}
            </button>
          </Card>
        ) : (
          <ConfirmPanel
            plan={plan} location={location}
            deductKits={deductKits} setDeductKits={setDeductKits}
            skip={skip} setSkip={setSkip} onDeduct={deduct} busy={busy}
            posDay={d.event.posDay}
          />
        )}

        <Card title={`Attendees (${d.attendees.length})`}>
          <div className="space-y-1">
            {d.attendees.map((a) => (
              <div key={a.ttTicketId}
                   className={`flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-slate-700 last:border-0 ${
                     a.voidedAt || a.orderCancelled ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm">
                    {a.attendeeName ?? "(no name)"}
                    {(a.voidedAt || a.orderCancelled) && (
                      <span className="ml-2 text-xs text-slate-400">{a.voidedAt ? "voided" : "order cancelled"}</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.orderNumber ?? "—"}
                    {a.canvasAnswer ? ` · picked “${a.canvasAnswer}”` : " · no canvas picked"}
                    {a.overrideDesignId ? " · overridden" : ""}
                  </p>
                </div>
                <div className="text-sm shrink-0">
                  {a.design
                    ? <span className="text-slate-200">{a.design.name} <span className="text-slate-500">{a.design.meshCount}ct</span></span>
                    : <span className="text-amber-400">{a.resolveStatus === "no_answer" ? "no answer" : "unmapped"}</span>}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <DesignPicker onPick={(designId) => setOverride(a.ttTicketId, designId)} disabled={busy} label="Change" />
                  {a.overrideDesignId && (
                    <button onClick={() => setOverride(a.ttTicketId, null)} disabled={busy}
                      className="text-xs text-slate-500 hover:text-white disabled:opacity-50">reset</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

function ConfirmPanel({
  plan, location, deductKits, setDeductKits, skip, setSkip, onDeduct, busy, posDay,
}: {
  plan: PlanResp | null; location: "home" | "market";
  deductKits: boolean; setDeductKits: (b: boolean) => void;
  skip: Set<string>; setSkip: (s: Set<string>) => void;
  onDeduct: () => void; busy: boolean; posDay: string;
}) {
  if (!plan) return null;
  const short = plan.lines.filter((l) => (l.canvasDraw?.short ?? 0) > 0 || (l.kitDraw?.short ?? 0) > 0);

  return (
    <Card title="Pull the canvases, then deduct"
          subtitle="Nothing has come off stock yet. Press the button once the canvases and kits are physically pulled.">
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <p className="text-sm text-slate-400">
          Taking from <span className="text-slate-200 font-medium">home stock</span>, falling back to
          Andover. The market tote is left alone — it is for craft markets.
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={deductKits} onChange={(e) => setDeductKits(e.target.checked)} className="accent-sky-500" />
          Also deduct kits
        </label>
      </div>

      {short.length > 0 && (
        <div className="mb-4 text-sm text-red-300 bg-red-950/30 border border-red-900/60 rounded-lg px-3 py-2">
          <p className="font-medium">Not enough stock for everything:</p>
          <ul className="mt-1 space-y-0.5">
            {short.map((l) => (
              <li key={l.designId}>
                {l.designName}: {(l.canvasDraw?.short ?? 0) > 0 && `${l.canvasDraw!.short} canvas short`}
                {(l.canvasDraw?.short ?? 0) > 0 && (l.kitDraw?.short ?? 0) > 0 && ", "}
                {(l.kitDraw?.short ?? 0) > 0 && `${l.kitDraw!.short} kits short`}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-red-400">
            Deducting anyway takes what is there and records the shortfall — it will not go negative.
          </p>
        </div>
      )}

      {plan.posOverlap.length > 0 && (
        <div className="mb-4 text-sm bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2">
          <p className="text-amber-300 font-medium">
            These designs were also sold through Shopify POS on {posDay}
          </p>
          <p className="text-xs text-amber-400/90 mt-1">
            They may be the same canvases rung up at the table, or extra things people bought.
            Tick any that were already deducted by the POS sale, so they are not taken twice.
          </p>
          <div className="mt-2 space-y-1">
            {plan.posOverlap.map((o) => (
              <label key={o.designId} className="flex items-center gap-2 text-slate-300">
                <input type="checkbox" checked={skip.has(o.designId)} className="accent-amber-500"
                  onChange={(e) => {
                    const next = new Set(skip);
                    if (e.target.checked) next.add(o.designId); else next.delete(o.designId);
                    setSkip(next);
                  }} />
                <span>{o.designName}</span>
                <span className="text-xs text-slate-500">
                  {o.tickets} ticket{o.tickets === 1 ? "" : "s"} · POS sold {o.posUnits}{o.posKits ? ` (${o.posKits} as kits)` : ""}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {plan.blockers.length > 0 && (
        <ul className="mb-4 text-sm text-amber-300 space-y-1">
          {plan.blockers.map((b, i) => <li key={i}>• {b}</li>)}
        </ul>
      )}

      <button onClick={onDeduct} disabled={busy || !plan.canConfirm}
        className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed">
        {busy ? "Deducting…"
          : `Deduct ${plan.totalCanvas} canvas${plan.totalCanvas === 1 ? "" : "es"}` +
            (plan.totalKits ? ` and ${plan.totalKits} kit${plan.totalKits === 1 ? "" : "s"}` : "") +
            ` from home`}
      </button>
      {plan.skipped.length > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          Skipping {plan.skipped.map((s) => s.designName).join(", ")} — recorded as already sold through POS.
        </p>
      )}
    </Card>
  );
}

function DeductionTable({ rows }: { rows: Deduction[] }) {
  const live = rows.filter((r) => !r.reversedAt);
  const byDesign = new Map<string, { name: string; canvasReq: number; canvasGot: number; kitsReq: number; kitsGot: number; andover: number; skipped: number }>();
  for (const r of live) {
    const k = r.designName ?? "?";
    const e = byDesign.get(k) ?? { name: k, canvasReq: 0, canvasGot: 0, kitsReq: 0, kitsGot: 0, andover: 0, skipped: 0 };
    e.canvasReq += r.canvasRequested; e.canvasGot += r.canvasDeducted;
    e.kitsReq += r.kitsRequested; e.kitsGot += r.kitsDeducted;
    e.andover += r.canvasFromAndover + r.kitsFromAndover;
    if (r.skippedForPos) e.skipped++;
    byDesign.set(k, e);
  }
  const list = [...byDesign.values()].sort((a, b) => b.canvasGot - a.canvasGot);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 text-left">
            <th className="pb-2">Design</th>
            <th className="pb-2 text-center">Canvas</th>
            <th className="pb-2 text-center">Kits</th>
            <th className="pb-2">From Andover</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const shortC = r.canvasGot < r.canvasReq && !r.skipped;
            const shortK = r.kitsGot < r.kitsReq && !r.skipped;
            return (
              <tr key={r.name} className="border-t border-slate-700">
                <td className="py-2 text-white">
                  {r.name}
                  {r.skipped > 0 && <span className="ml-2 text-xs text-slate-500">skipped — POS</span>}
                </td>
                <td className={`py-2 text-center ${shortC ? "text-red-400 font-medium" : "text-slate-300"}`}>
                  {r.canvasGot}{shortC ? ` of ${r.canvasReq}` : ""}
                </td>
                <td className={`py-2 text-center ${shortK ? "text-red-400 font-medium" : "text-slate-300"}`}>
                  {r.kitsGot}{shortK ? ` of ${r.kitsReq}` : ""}
                </td>
                <td className="py-2 text-slate-500">{r.andover || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Shell({ children, crumb, right }: { children: React.ReactNode; crumb?: string; right?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-5xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <Breadcrumb items={[{ label: "Events", href: "/events" }, ...(crumb ? [{ label: crumb }] : [])]} />
          {right}
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-3 md:px-4 py-6">{children}</div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl">
      <div className="p-4 border-b border-slate-700">
        <h2 className="text-white font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-white font-bold">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

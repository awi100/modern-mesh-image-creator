/**
 * What confirming an event would do, and what does not add up.
 *
 * Pure: the route supplies tickets, mappings, POS sales and existing audit
 * rows, and gets back a plan it can either show or execute. Nothing here reads
 * or writes the database, which is what makes the arithmetic testable — the
 * Shopify deduction paths have no tests at all, and that is why their bugs were
 * found in production.
 */

import type { ResolveStatus } from "./resolve";

/* -------------------------------------------------------------------------- */
/* The plan                                                                   */
/* -------------------------------------------------------------------------- */

export interface PlanTicket {
  ttTicketId: string;
  attendeeName: string | null;
  canvasAnswer: string | null;
  designId: string | null;
  designName?: string | null;
  needsKit: boolean;
  status: ResolveStatus;
  masked?: boolean;
  /** Ticket Tailor's own signals. A void or a cancelled order means the ticket
   *  does not count — the per-ticket fields are the authority, because no
   *  cancelled ORDER has ever been observed and its status values are
   *  therefore unverified. */
  voided?: boolean;
  orderCancelled?: boolean;
}

export interface PlanLine {
  ttTicketId: string;
  designId: string;
  designName: string | null;
  canvas: number;
  kits: number;
}

export interface PlanDesignTotal {
  designId: string;
  designName: string | null;
  tickets: number;
  canvas: number;
  kits: number;
}

export interface DeductionPlan {
  lines: PlanLine[];
  totals: PlanDesignTotal[];
  totalCanvas: number;
  totalKits: number;
  /** Counted, never silently dropped: each of these is a ticket somebody paid
   *  for whose canvas we cannot identify. */
  unmapped: PlanTicket[];
  noAnswer: PlanTicket[];
  ignored: PlanTicket[];
  excluded: PlanTicket[]; // voided or on a cancelled order
  masked: PlanTicket[];
  /** Designs the owners ticked to skip because POS already took them. */
  skipped: PlanDesignTotal[];
}

export interface PlanOptions {
  /** Every sip-and-stitch canvas goes out kitted, so this is normally true. A
   *  mapping row can still say otherwise for a specific answer. */
  deductKits: boolean;
  /** Designs the owners decided were already rung up through Shopify POS. */
  skipDesignIds?: string[];
}

export function buildDeductionPlan(tickets: PlanTicket[], opts: PlanOptions): DeductionPlan {
  const skip = new Set(opts.skipDesignIds ?? []);

  const excluded: PlanTicket[] = [];
  const unmapped: PlanTicket[] = [];
  const noAnswer: PlanTicket[] = [];
  const ignored: PlanTicket[] = [];
  const masked: PlanTicket[] = [];
  const lines: PlanLine[] = [];
  const skippedLines: PlanLine[] = [];

  for (const t of tickets) {
    if (t.masked) masked.push(t);

    // A void or a cancelled order takes the ticket out before anything else:
    // a cancellation before confirmation should simply never have counted.
    if (t.voided || t.orderCancelled) { excluded.push(t); continue; }

    if (t.status === "no_answer") { noAnswer.push(t); continue; }
    if (t.status === "ignored") { ignored.push(t); continue; }
    if (!t.designId) { unmapped.push(t); continue; }

    const line: PlanLine = {
      ttTicketId: t.ttTicketId,
      designId: t.designId,
      designName: t.designName ?? null,
      canvas: 1,
      // One canvas and, when kitted, one kit — matching how a Shopify kit sale
      // deducts both. A kit here is the thread set, not the canvas.
      kits: opts.deductKits && t.needsKit ? 1 : 0,
    };
    if (skip.has(t.designId)) skippedLines.push(line);
    else lines.push(line);
  }

  return {
    lines,
    totals: totalsOf(lines),
    totalCanvas: lines.reduce((s, l) => s + l.canvas, 0),
    totalKits: lines.reduce((s, l) => s + l.kits, 0),
    unmapped, noAnswer, ignored, excluded, masked,
    skipped: totalsOf(skippedLines),
  };
}

function totalsOf(lines: PlanLine[]): PlanDesignTotal[] {
  const by = new Map<string, PlanDesignTotal>();
  for (const l of lines) {
    const e = by.get(l.designId) ?? {
      designId: l.designId, designName: l.designName, tickets: 0, canvas: 0, kits: 0,
    };
    e.tickets += 1; e.canvas += l.canvas; e.kits += l.kits;
    if (!e.designName && l.designName) e.designName = l.designName;
    by.set(l.designId, e);
  }
  return [...by.values()].sort(
    (a, b) => b.canvas - a.canvas || (a.designName ?? "").localeCompare(b.designName ?? ""),
  );
}

/* -------------------------------------------------------------------------- */
/* POS overlap                                                                */
/* -------------------------------------------------------------------------- */

export interface PosSale {
  designId: string;
  units: number;
  kits: number;
}

export interface OverlapRow {
  designId: string;
  designName: string | null;
  tickets: number;
  posUnits: number;
  posKits: number;
}

/**
 * Shopify POS sales of the same designs on the event's own day, beside the
 * ticket counts.
 *
 * This exists because canvases demonstrably ARE rung up through Shopify POS at
 * these events: across the three classified sip-and-stitch days there were 42
 * POS orders covering 33 design units, 15 of them kits. Whether those are the
 * ticket canvases or extra purchases differs case by case, so nothing is ever
 * skipped automatically — the owners tick what to skip and the preview shows
 * them both numbers.
 */
export function posOverlap(
  totals: PlanDesignTotal[],
  posByDesign: Map<string, PosSale>,
): OverlapRow[] {
  const rows: OverlapRow[] = [];
  for (const t of totals) {
    const pos = posByDesign.get(t.designId);
    if (!pos || (pos.units === 0 && pos.kits === 0)) continue;
    rows.push({
      designId: t.designId,
      designName: t.designName,
      tickets: t.tickets,
      posUnits: pos.units,
      posKits: pos.kits,
    });
  }
  return rows.sort((a, b) => b.posUnits - a.posUnits);
}

/* -------------------------------------------------------------------------- */
/* Discrepancies                                                              */
/* -------------------------------------------------------------------------- */

export type DiscrepancyKind =
  | "unmapped_answer"
  | "no_answer"
  | "masked_answer"
  | "voided_after_confirm"
  | "new_ticket_after_confirm"
  | "override_changed_after_confirm"
  | "clamped_deduction"
  | "pos_event_kind_conflict"
  | "historical_unconfirmed";

export interface Discrepancy {
  kind: DiscrepancyKind;
  /** Plain language, because this is read by the owners, not by a developer. */
  message: string;
  ttTicketIds?: string[];
  designId?: string | null;
  count?: number;
}

export interface EventLike {
  ttEventId: string;
  name: string;
  state: string; // "open" | "historical" | "confirmed"
  confirmedAt?: Date | null;
  allowHistoricalConfirm?: boolean;
}

export interface DeductionRowLike {
  ttTicketId: string;
  designId: string | null;
  designName: string | null;
  kitsRequested: number;
  kitsDeducted: number;
  canvasRequested: number;
  canvasDeducted: number;
  skippedForPos: boolean;
  reversedAt: Date | null;
}

export interface PosEventLike {
  day: string;
  kind: string;
  name: string | null;
}

export interface DiscrepancyInput {
  event: EventLike;
  tickets: (PlanTicket & { createdAt?: Date | null; overrideChangedAt?: Date | null })[];
  deductions: DeductionRowLike[];
  posEvent?: PosEventLike | null;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function eventDiscrepancies(input: DiscrepancyInput): Discrepancy[] {
  const { event, tickets, deductions, posEvent } = input;
  const out: Discrepancy[] = [];
  const confirmed = event.state === "confirmed";
  const deducted = new Map(deductions.filter((d) => !d.reversedAt).map((d) => [d.ttTicketId, d]));
  const live = tickets.filter((t) => !t.voided && !t.orderCancelled);

  const maskedT = tickets.filter((t) => t.masked);
  if (maskedT.length) {
    out.push({
      kind: "masked_answer",
      count: maskedT.length,
      ttTicketIds: maskedT.map((t) => t.ttTicketId),
      message:
        `${plural(maskedT.length, "ticket")} came back with the canvas answer hidden ("****"). ` +
        `The Ticket Tailor API key cannot read customer data — reissue it with that access, then sync again. ` +
        `Until then these cannot be mapped.`,
    });
  }

  const unmapped = live.filter((t) => t.status === "unmapped" && !t.masked);
  if (unmapped.length) {
    const answers = [...new Set(unmapped.map((t) => t.canvasAnswer).filter(Boolean))];
    out.push({
      kind: "unmapped_answer",
      count: unmapped.length,
      ttTicketIds: unmapped.map((t) => t.ttTicketId),
      message:
        `${plural(unmapped.length, "ticket")} picked a canvas we have not matched to a design yet` +
        (answers.length ? `: ${answers.join(", ")}` : "") +
        `. Map each one below, or override the ticket.`,
    });
  }

  const none = live.filter((t) => t.status === "no_answer");
  if (none.length) {
    out.push({
      kind: "no_answer",
      count: none.length,
      ttTicketIds: none.map((t) => t.ttTicketId),
      message:
        `${plural(none.length, "ticket")} has no canvas answer at all — the question may have been added ` +
        `after they bought. Set a canvas on each, or leave them out.`,
    });
  }

  if (confirmed) {
    const voidedAfter = tickets.filter((t) => (t.voided || t.orderCancelled) && deducted.has(t.ttTicketId));
    for (const t of voidedAfter) {
      const d = deducted.get(t.ttTicketId)!;
      out.push({
        kind: "voided_after_confirm",
        ttTicketIds: [t.ttTicketId],
        designId: d.designId,
        message:
          `${t.attendeeName ?? "A ticket"} was ${t.voided ? "voided" : "cancelled"} after this event was confirmed, ` +
          `but ${plural(d.canvasDeducted, "canvas", "canvases")}${d.kitsDeducted ? ` and ${plural(d.kitsDeducted, "kit")}` : ""} ` +
          `of ${d.designName ?? "that design"} had already been deducted. ` +
          `Restore it only if the canvas came back — it may have gone home with someone.`,
      });
    }

    const added = live.filter((t) => !deducted.has(t.ttTicketId) && t.designId);
    if (added.length) {
      out.push({
        kind: "new_ticket_after_confirm",
        count: added.length,
        ttTicketIds: added.map((t) => t.ttTicketId),
        message:
          `${plural(added.length, "ticket")} sold after this event was confirmed and ${added.length === 1 ? "has" : "have"} ` +
          `not been deducted. Deduct ${added.length === 1 ? "it" : "them"} individually.`,
      });
    }

    const moved = live.filter((t) => {
      const d = deducted.get(t.ttTicketId);
      return d && t.designId && d.designId && d.designId !== t.designId;
    });
    for (const t of moved) {
      const d = deducted.get(t.ttTicketId)!;
      out.push({
        kind: "override_changed_after_confirm",
        ttTicketIds: [t.ttTicketId],
        designId: t.designId,
        message:
          `${t.attendeeName ?? "A ticket"} now points at ${t.designName ?? "a different design"}, but ` +
          `${d.designName ?? "another design"} was deducted when this event was confirmed. ` +
          `Restore that one and deduct the new one if the swap was real.`,
      });
    }
  }

  const clamped = deductions.filter(
    (d) => !d.reversedAt && !d.skippedForPos &&
      (d.canvasDeducted < d.canvasRequested || d.kitsDeducted < d.kitsRequested),
  );
  for (const d of clamped) {
    const shortCanvas = d.canvasRequested - d.canvasDeducted;
    const shortKits = d.kitsRequested - d.kitsDeducted;
    out.push({
      kind: "clamped_deduction",
      ttTicketIds: [d.ttTicketId],
      designId: d.designId,
      message:
        `${d.designName ?? "A design"} ran out while deducting: wanted ` +
        [shortCanvas ? plural(shortCanvas, "more canvas", "more canvases") : null,
         shortKits ? plural(shortKits, "more kit") : null].filter(Boolean).join(" and ") +
        ` than any location had. The sale happened, so the count is now understated.`,
    });
  }

  if (posEvent && posEvent.kind !== "sip_and_stitch") {
    out.push({
      kind: "pos_event_kind_conflict",
      message:
        `${posEvent.day} is already recorded as a "${posEvent.kind}" day` +
        (posEvent.name ? ` ("${posEvent.name}")` : "") +
        `, so it was left alone. While it is not marked as a sip-and-stitch, that day's ` +
        `POS sales feed the craft-market packing list.`,
    });
  }

  if (event.state === "historical" && live.length > 0 && !event.allowHistoricalConfirm) {
    out.push({
      kind: "historical_unconfirmed",
      count: live.length,
      message:
        `This event started before automatic deduction was switched on, so its ` +
        `${plural(live.length, "ticket")} ${live.length === 1 ? "was" : "were"} already deducted by hand or ` +
        `through POS. Confirming would count them twice — unlock it only if you are sure.`,
    });
  }

  return out;
}

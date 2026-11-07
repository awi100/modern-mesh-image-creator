import { describe, it, expect } from "vitest";
import { buildDeductionPlan, posOverlap, eventDiscrepancies,
  type PlanTicket, type DeductionRowLike } from "./plan";

const t = (over: Partial<PlanTicket> & { ttTicketId: string }): PlanTicket => ({
  attendeeName: "Alex Doe", canvasAnswer: "Fenway Frank", designId: "d_fenway",
  designName: "Fenway Frank", needsKit: true, status: "mapped", ...over,
});

describe("building a deduction plan", () => {
  it("takes one canvas and one kit per ticket", () => {
    const p = buildDeductionPlan([t({ ttTicketId: "it_1" }), t({ ttTicketId: "it_2" })], { deductKits: true });
    expect(p.totalCanvas).toBe(2);
    expect(p.totalKits).toBe(2);
    expect(p.totals).toEqual([
      { designId: "d_fenway", designName: "Fenway Frank", tickets: 2, canvas: 2, kits: 2 },
    ]);
  });

  it("takes canvas only when kits are turned off", () => {
    const p = buildDeductionPlan([t({ ttTicketId: "it_1" })], { deductKits: false });
    expect(p.totalCanvas).toBe(1);
    expect(p.totalKits).toBe(0);
  });

  it("respects a mapping that says this answer needs no kit", () => {
    const p = buildDeductionPlan([t({ ttTicketId: "it_1", needsKit: false })], { deductKits: true });
    expect(p.totalCanvas).toBe(1);
    expect(p.totalKits).toBe(0);
  });

  it("handles a two-ticket order with two different picks", () => {
    const p = buildDeductionPlan([
      t({ ttTicketId: "it_1", designId: "d_fenway", designName: "Fenway Frank" }),
      t({ ttTicketId: "it_2", designId: "d_citgo", designName: "Citgo Sign", canvasAnswer: "Citgo Sign" }),
    ], { deductKits: true });
    expect(p.totals.map((x) => x.designId).sort()).toEqual(["d_citgo", "d_fenway"]);
    expect(p.totalCanvas).toBe(2);
  });

  it("leaves out a voided ticket and one on a cancelled order", () => {
    const p = buildDeductionPlan([
      t({ ttTicketId: "it_1" }),
      t({ ttTicketId: "it_2", voided: true }),
      t({ ttTicketId: "it_3", orderCancelled: true }),
    ], { deductKits: true });
    expect(p.totalCanvas).toBe(1);
    expect(p.excluded.map((x) => x.ttTicketId)).toEqual(["it_2", "it_3"]);
  });

  it("lists unmapped and no-answer tickets instead of dropping them", () => {
    const p = buildDeductionPlan([
      t({ ttTicketId: "it_1" }),
      t({ ttTicketId: "it_2", status: "unmapped", designId: null, canvasAnswer: "Mystery" }),
      t({ ttTicketId: "it_3", status: "no_answer", designId: null, canvasAnswer: null }),
      t({ ttTicketId: "it_4", status: "ignored", designId: null, canvasAnswer: "Gift Card" }),
    ], { deductKits: true });
    expect(p.totalCanvas).toBe(1);
    expect(p.unmapped.map((x) => x.ttTicketId)).toEqual(["it_2"]);
    expect(p.noAnswer.map((x) => x.ttTicketId)).toEqual(["it_3"]);
    expect(p.ignored.map((x) => x.ttTicketId)).toEqual(["it_4"]);
  });

  it("moves a skipped design out of the totals but keeps it on the record", () => {
    const p = buildDeductionPlan([
      t({ ttTicketId: "it_1", designId: "d_fenway", designName: "Fenway Frank" }),
      t({ ttTicketId: "it_2", designId: "d_citgo", designName: "Citgo Sign" }),
    ], { deductKits: true, skipDesignIds: ["d_citgo"] });
    expect(p.totalCanvas).toBe(1);
    expect(p.totals.map((x) => x.designId)).toEqual(["d_fenway"]);
    expect(p.skipped).toEqual([
      { designId: "d_citgo", designName: "Citgo Sign", tickets: 1, canvas: 1, kits: 1 },
    ]);
  });

  it("collects masked tickets separately, even though they are also unmapped", () => {
    const p = buildDeductionPlan([
      t({ ttTicketId: "it_1", status: "unmapped", designId: null, canvasAnswer: "****", masked: true }),
    ], { deductKits: true });
    expect(p.masked).toHaveLength(1);
    expect(p.unmapped).toHaveLength(1);
    expect(p.totalCanvas).toBe(0);
  });

  it("is empty for no tickets", () => {
    const p = buildDeductionPlan([], { deductKits: true });
    expect(p).toMatchObject({ totalCanvas: 0, totalKits: 0, lines: [], totals: [] });
  });

  it("sorts totals by canvas count, biggest first", () => {
    const p = buildDeductionPlan([
      t({ ttTicketId: "a", designId: "d_small", designName: "Small" }),
      t({ ttTicketId: "b", designId: "d_big", designName: "Big" }),
      t({ ttTicketId: "c", designId: "d_big", designName: "Big" }),
    ], { deductKits: true });
    expect(p.totals.map((x) => x.designId)).toEqual(["d_big", "d_small"]);
  });
});

describe("POS overlap", () => {
  const totals = [
    { designId: "d_fenway", designName: "Fenway Frank", tickets: 6, canvas: 6, kits: 6 },
    { designId: "d_citgo", designName: "Citgo Sign", tickets: 3, canvas: 3, kits: 3 },
    { designId: "d_crab", designName: "Crab", tickets: 1, canvas: 1, kits: 1 },
  ];

  it("reports only designs POS also sold that day", () => {
    const pos = new Map([
      ["d_fenway", { designId: "d_fenway", units: 6, kits: 3 }],
      ["d_crab", { designId: "d_crab", units: 0, kits: 0 }],
    ]);
    expect(posOverlap(totals, pos)).toEqual([
      { designId: "d_fenway", designName: "Fenway Frank", tickets: 6, posUnits: 6, posKits: 3 },
    ]);
  });

  it("is empty when POS sold none of them", () => {
    expect(posOverlap(totals, new Map())).toEqual([]);
  });

  it("never skips anything by itself — it only reports", () => {
    const pos = new Map([["d_fenway", { designId: "d_fenway", units: 99, kits: 99 }]]);
    const rows = posOverlap(totals, pos);
    // The overlap is advisory; the plan still contains Fenway until the owners
    // tick it, because POS sales may be extra purchases rather than duplicates.
    expect(rows[0].posUnits).toBe(99);
    expect(buildDeductionPlan([t({ ttTicketId: "x" })], { deductKits: true }).totalCanvas).toBe(1);
  });
});

describe("discrepancies", () => {
  const ev = { ttEventId: "ev_1", name: "Sip & Stitch", state: "open" };
  const ded = (o: Partial<DeductionRowLike> & { ttTicketId: string }): DeductionRowLike => ({
    designId: "d_fenway", designName: "Fenway Frank",
    kitsRequested: 1, kitsDeducted: 1, canvasRequested: 1, canvasDeducted: 1,
    skippedForPos: false, reversedAt: null, ...o,
  });

  it("names unmapped answers and lists them", () => {
    const d = eventDiscrepancies({
      event: ev,
      tickets: [t({ ttTicketId: "it_1", status: "unmapped", designId: null, canvasAnswer: "Mystery Canvas" })],
      deductions: [],
    });
    const f = d.find((x) => x.kind === "unmapped_answer")!;
    expect(f.count).toBe(1);
    expect(f.message).toContain("Mystery Canvas");
  });

  it("calls out a masked answer as a key problem, not a mapping problem", () => {
    const d = eventDiscrepancies({
      event: ev,
      tickets: [t({ ttTicketId: "it_1", status: "unmapped", designId: null, masked: true, canvasAnswer: "****" })],
      deductions: [],
    });
    const f = d.find((x) => x.kind === "masked_answer")!;
    expect(f.message).toMatch(/API key/i);
    // It must not also be reported as an ordinary unmapped answer.
    expect(d.find((x) => x.kind === "unmapped_answer")).toBeUndefined();
  });

  it("reports tickets with no answer at all", () => {
    const d = eventDiscrepancies({
      event: ev,
      tickets: [t({ ttTicketId: "it_1", status: "no_answer", designId: null, canvasAnswer: null })],
      deductions: [],
    });
    expect(d.find((x) => x.kind === "no_answer")?.count).toBe(1);
  });

  it("flags a void that happened after confirmation, and does not restore it", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "confirmed", confirmedAt: new Date("2026-12-15") },
      tickets: [t({ ttTicketId: "it_1", voided: true, designName: "Whale Intro Kit" })],
      deductions: [ded({ ttTicketId: "it_1", designName: "Whale Intro Kit" })],
    });
    const f = d.find((x) => x.kind === "voided_after_confirm")!;
    expect(f.message).toContain("Whale Intro Kit");
    expect(f.message).toMatch(/gone home with someone/);
  });

  it("does not flag a void that happened before confirmation", () => {
    const d = eventDiscrepancies({
      event: ev, // still open
      tickets: [t({ ttTicketId: "it_1", voided: true })],
      deductions: [],
    });
    expect(d.find((x) => x.kind === "voided_after_confirm")).toBeUndefined();
  });

  it("flags a ticket sold after confirmation", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "confirmed" },
      tickets: [t({ ttTicketId: "it_1" }), t({ ttTicketId: "it_2" })],
      deductions: [ded({ ttTicketId: "it_1" })],
    });
    const f = d.find((x) => x.kind === "new_ticket_after_confirm")!;
    expect(f.count).toBe(1);
    expect(f.ttTicketIds).toEqual(["it_2"]);
  });

  it("flags an override that moved after confirmation", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "confirmed" },
      tickets: [t({ ttTicketId: "it_1", designId: "d_lobster", designName: "Lobster" })],
      deductions: [ded({ ttTicketId: "it_1", designId: "d_fenway", designName: "Fenway Frank" })],
    });
    const f = d.find((x) => x.kind === "override_changed_after_confirm")!;
    expect(f.message).toContain("Lobster");
    expect(f.message).toContain("Fenway Frank");
  });

  it("flags a clamped deduction with what it fell short by", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "confirmed" },
      tickets: [t({ ttTicketId: "it_1" })],
      deductions: [ded({ ttTicketId: "it_1", canvasRequested: 3, canvasDeducted: 1, kitsRequested: 3, kitsDeducted: 2 })],
    });
    const f = d.find((x) => x.kind === "clamped_deduction")!;
    expect(f.message).toMatch(/2 more canvases/);
    expect(f.message).toMatch(/1 more kit/);
    expect(f.message).toMatch(/understated/);
  });

  it("ignores a clamp on a row deliberately skipped for POS", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "confirmed" },
      tickets: [t({ ttTicketId: "it_1" })],
      deductions: [ded({ ttTicketId: "it_1", skippedForPos: true, canvasRequested: 1, canvasDeducted: 0, kitsRequested: 1, kitsDeducted: 0 })],
    });
    expect(d.find((x) => x.kind === "clamped_deduction")).toBeUndefined();
  });

  it("ignores a reversed deduction entirely", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "confirmed" },
      tickets: [t({ ttTicketId: "it_1", voided: true })],
      deductions: [ded({ ttTicketId: "it_1", reversedAt: new Date() })],
    });
    expect(d.find((x) => x.kind === "voided_after_confirm")).toBeUndefined();
  });

  it("flags a PosEvent day already classified as something else", () => {
    const d = eventDiscrepancies({
      event: ev, tickets: [], deductions: [],
      posEvent: { day: "2026-12-14", kind: "market", name: "Holiday Market" },
    });
    const f = d.find((x) => x.kind === "pos_event_kind_conflict")!;
    expect(f.message).toContain("market");
    expect(f.message).toMatch(/packing list/);
  });

  it("says nothing when the PosEvent day is already a sip-and-stitch", () => {
    const d = eventDiscrepancies({
      event: ev, tickets: [], deductions: [],
      posEvent: { day: "2026-12-14", kind: "sip_and_stitch", name: "Sip & Stitch" },
    });
    expect(d.find((x) => x.kind === "pos_event_kind_conflict")).toBeUndefined();
  });

  it("warns that a historical event with tickets would double-count", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "historical" },
      tickets: [t({ ttTicketId: "it_1" })],
      deductions: [],
    });
    const f = d.find((x) => x.kind === "historical_unconfirmed")!;
    expect(f.message).toMatch(/count them twice/);
  });

  it("drops the historical warning once it has been unlocked", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "historical", allowHistoricalConfirm: true },
      tickets: [t({ ttTicketId: "it_1" })],
      deductions: [],
    });
    expect(d.find((x) => x.kind === "historical_unconfirmed")).toBeUndefined();
  });

  it("finds nothing wrong with a clean confirmed event", () => {
    const d = eventDiscrepancies({
      event: { ...ev, state: "confirmed" },
      tickets: [t({ ttTicketId: "it_1" })],
      deductions: [ded({ ttTicketId: "it_1" })],
      posEvent: { day: "2026-12-14", kind: "sip_and_stitch", name: "Sip & Stitch" },
    });
    expect(d).toEqual([]);
  });
});

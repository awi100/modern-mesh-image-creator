import { describe, it, expect } from "vitest";
import {
  normaliseAnswer, isMasked, findCanvasAnswer, parseEvent, parseIssuedTicket, parseOrder,
  unixToDate, eventDate, CANVAS_QUESTION_PATTERN,
} from "./parse";
import events from "./__fixtures__/events.json";
import aeronaut from "./__fixtures__/issued_tickets_aeronaut.json";
import glasshouse from "./__fixtures__/issued_tickets_glasshouse.json";
import orders from "./__fixtures__/orders.json";

const evData = events.data as Record<string, unknown>[];
const aero = aeronaut.data as Record<string, unknown>[];
const glass = glasshouse.data as Record<string, unknown>[];
const ordData = orders.data as Record<string, unknown>[];

describe("normalising an answer", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normaliseAnswer("  Fenway   Frank ")).toBe("fenway frank");
  });

  it("makes the two capitalisations of one pick the same key", () => {
    // Both appear in the real data — 9 tickets one way, 4 the other.
    expect(normaliseAnswer("New England vs Everyone")).toBe(normaliseAnswer("New England Vs Everyone"));
  });

  it("keeps genuinely different designs apart", () => {
    // Both are real, separate designs: Shamrock is 18ct, Shamrock Intro Kit 13ct.
    expect(normaliseAnswer("Shamrock")).not.toBe(normaliseAnswer("Shamrock Intro Kit"));
  });

  it("is empty for nothing", () => {
    expect(normaliseAnswer(null)).toBe("");
    expect(normaliseAnswer("   ")).toBe("");
  });
});

describe("spotting a masked answer", () => {
  it("recognises what a key without customer-data access returns", () => {
    expect(isMasked("****")).toBe(true);
    expect(isMasked("*")).toBe(true);
  });
  it("does not mistake a real answer for masking", () => {
    expect(isMasked("Fenway Frank")).toBe(false);
    expect(isMasked("")).toBe(false);
    expect(isMasked(null)).toBe(false);
  });
});

describe("finding the canvas question", () => {
  it("matches on the word canvas, not the full wording", () => {
    // Both wordings exist in production.
    for (const q of [
      "Select Your Choice of Canvas and Kit (check out our canvas selection at modernmeshco.com)",
      "Select Your Choice of Canvas and Kit (check out our canvases at modernmeshco.com)",
    ]) {
      expect(CANVAS_QUESTION_PATTERN.test(q)).toBe(true);
      expect(findCanvasAnswer([{ question: q, answer: "Lobster" }])?.answer).toBe("Lobster");
    }
  });

  it("returns null when no question is about a canvas", () => {
    expect(findCanvasAnswer([{ question: "Dietary requirements?", answer: "None" }])).toBeNull();
    expect(findCanvasAnswer([])).toBeNull();
    expect(findCanvasAnswer(null)).toBeNull();
  });

  it("takes the first of several and reports the ambiguity", () => {
    const r = findCanvasAnswer([
      { question: "Canvas choice", answer: "Crab" },
      { question: "Second canvas?", answer: "Lucky" },
    ]);
    expect(r?.answer).toBe("Crab");
    expect(r?.ambiguous).toBe(true);
  });

  it("treats an unanswered question as no answer, not an empty pick", () => {
    const r = findCanvasAnswer([{ question: "Canvas choice", answer: "  " }]);
    expect(r?.answer).toBeNull();
    expect(r?.masked).toBe(false);
  });

  it("flags masking separately from no answer", () => {
    const r = findCanvasAnswer([{ question: "Canvas choice", answer: "****" }]);
    expect(r?.masked).toBe(true);
  });
});

describe("timestamps", () => {
  it("reads unix seconds", () => {
    expect(unixToDate(1793574103)?.toISOString()).toBe("2026-11-01T23:01:43.000Z");
  });
  it("leaves nothing as null rather than 1970", () => {
    expect(unixToDate(null)).toBeNull();
    expect(unixToDate(0)).toBeNull();
    expect(unixToDate(undefined)).toBeNull();
  });
  it("prefers unix over iso on an event date object, since iso carries no offset", () => {
    // 18:00 Eastern on 14 Dec 2026 is 23:00Z. The bare iso string would be read
    // as local time by Date, which is why unix wins.
    const unix = Math.floor(Date.parse("2026-12-14T23:00:00Z") / 1000);
    expect(eventDate({ iso: "2026-12-14T18:00:00", unix })?.toISOString())
      .toBe("2026-12-14T23:00:00.000Z");
  });

  it("falls back to iso when unix is absent", () => {
    expect(eventDate({ iso: "2026-12-14T23:00:00Z" })?.toISOString()).toBe("2026-12-14T23:00:00.000Z");
  });

  it("is null for a date object with nothing usable", () => {
    expect(eventDate({})).toBeNull();
    expect(eventDate(null)).toBeNull();
  });
});

describe("parsing real event payloads", () => {
  it("parses all five fixture events", () => {
    const parsed = evData.map((e) => parseEvent(e));
    expect(parsed).toHaveLength(5);
    for (const p of parsed) {
      expect(p.ttEventId).toMatch(/^ev_/);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.startsAt).toBeInstanceOf(Date);
    }
  });

  it("pulls out the Aeronaut test event with its venue and series", () => {
    const aeroEv = evData.map(parseEvent).find((e) => e.ttEventId === "ev_9365960")!;
    expect(aeroEv.name).toContain("Aeronaut");
    expect(aeroEv.venueName).toBe("Aeronaut Brewing");
    expect(aeroEv.ttEventSeriesId).toBe("es_2496855");
    expect(aeroEv.ttStatus).toBe("published");
    expect(aeroEv.startsAt?.getTime()).toBeGreaterThan(Date.parse("2026-12-01"));
  });

  it("gives every event its own series id — series are 1:1 here", () => {
    const series = evData.map(parseEvent).map((e) => e.ttEventSeriesId);
    expect(new Set(series).size).toBe(series.length);
  });
});

describe("parsing real issued tickets", () => {
  it("reads a canvas pick off every Aeronaut ticket", () => {
    const parsed = aero.map(parseIssuedTicket);
    expect(parsed).toHaveLength(37);
    expect(parsed.every((t) => t.canvasAnswer)).toBe(true);
    expect(parsed.every((t) => t.answerKey)).toBe(true);
    expect(parsed.some((t) => t.answerMasked)).toBe(false);
  });

  it("carries the ids a sync needs", () => {
    const t = aero.map(parseIssuedTicket)[0];
    expect(t.ttTicketId).toMatch(/^it_/);
    expect(t.ttOrderId).toMatch(/^or_/);
    expect(t.ttEventId).toBe("ev_9365960");
    expect(t.ticketTypeName).toBe("General Admission");
    expect(t.listedPriceCents).toBe(7000);
    expect(t.ttStatus).toBe("valid");
    expect(t.voidedAt).toBeNull();
  });

  it("finds the no-answer tickets that really exist", () => {
    // Publico sold 81 tickets with only 60 answers; Glass House answered all 60.
    const parsed = glass.map(parseIssuedTicket);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.filter((t) => !t.canvasAnswer).length).toBe(0);
  });

  it("normalises every answer into a usable key", () => {
    for (const t of aero.map(parseIssuedTicket)) {
      expect(t.answerKey).toBe(t.canvasAnswer!.toLowerCase().replace(/\s+/g, " ").trim());
    }
  });
});

describe("parsing real orders", () => {
  it("takes the event id from event_summary, not a top-level field", () => {
    const o = parseOrder(ordData[0]);
    expect(o.ttEventId).toMatch(/^ev_/);
    expect((ordData[0] as Record<string, unknown>).event_id).toBeUndefined();
  });

  it("reads money as minor units", () => {
    const o = parseOrder(ordData[0]);
    expect(o.totalCents).toBeGreaterThan(1000); // cents, not dollars
    expect(o.currency).toBe("usd");
    expect(o.refundCents).toBe(0);
  });

  it("returns the tickets nested inside the order", () => {
    const withTwo = ordData.map(parseOrder).find((o) => o.tickets.length > 1);
    expect(withTwo).toBeTruthy();
    for (const t of withTwo!.tickets) {
      expect(t.ttTicketId).toMatch(/^it_/);
      expect(t.ttOrderId).toBe(withTwo!.ttOrderId);
      expect(t.ttEventId).toBe(withTwo!.ttEventId);
    }
  });

  it("handles a two-ticket order whose attendees picked different canvases", () => {
    const multi = ordData.map(parseOrder).filter((o) => o.tickets.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    // Each ticket resolves its own pick; the buyer-level copy is ignored.
    for (const o of multi) {
      expect(o.tickets.every((t) => t.canvasAnswer !== null || t.answerKey === null)).toBe(true);
    }
  });

  it("records the status seen in production without trusting it", () => {
    expect(ordData.map(parseOrder).every((o) => o.status === "completed")).toBe(true);
  });
});

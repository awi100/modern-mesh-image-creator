import { describe, it, expect } from "vitest";
import { unchanged } from "./sync";

/**
 * `unchanged` decides whether a synced row is written at all, so a wrong TRUE
 * is the dangerous direction: the row silently keeps stale data and no sync
 * will ever correct it, because the next sync compares against the same stale
 * row and reaches the same wrong answer. A wrong FALSE only costs a write.
 *
 * The fields are the ones actually stored for an order or an issued ticket —
 * nullable strings, nullable ints, nullable dates and a boolean.
 */
const ticket = () => ({
  ttOrderId: "or_1",
  ttEventId: "ev_1",
  attendeeName: "Sam Rowe",
  attendeeEmail: "sam@example.com",
  ticketTypeName: "General Admission",
  ttTicketTypeId: "tt_1",
  canvasAnswer: "Fenway Frank",
  answerKey: "fenway frank",
  resolveStatus: "mapped",
  resolvedDesignId: "des_1",
  resolvedNeedsKit: true,
  ttStatus: "valid",
  voidedAt: null as Date | null,
  listedPriceCents: 6500,
  ttCreatedAt: new Date("2026-11-01T10:00:00Z"),
  ttUpdatedAt: new Date("2026-11-01T10:00:00Z"),
});

describe("skipping a row that has not moved", () => {
  it("is false when nothing is stored yet", () => {
    // A brand new ticket must always be written.
    expect(unchanged(undefined, ticket())).toBe(false);
  });

  it("is true for an identical row", () => {
    // The whole point: press Sync twice and the second one writes nothing.
    expect(unchanged({ ...ticket() }, ticket())).toBe(true);
  });

  it("compares dates by value, not by identity", () => {
    // Prisma hands back fresh Date objects every read, so `!==` on the objects
    // would report every single row as changed and save nothing at all.
    const stored = { ...ticket(), ttCreatedAt: new Date("2026-11-01T10:00:00Z") };
    expect(unchanged(stored, ticket())).toBe(true);
  });

  it("catches a void, which is the change that matters most", () => {
    // A cancelled order voids its tickets. Missing this would leave a voided
    // ticket counted in an event's plan.
    const incoming = { ...ticket(), ttStatus: "voided", voidedAt: new Date("2026-11-05T09:00:00Z") };
    expect(unchanged(ticket(), incoming)).toBe(false);
  });

  it("catches a date appearing or disappearing", () => {
    expect(unchanged(ticket(), { ...ticket(), voidedAt: new Date("2026-11-05T09:00:00Z") })).toBe(false);
    expect(unchanged({ ...ticket(), voidedAt: new Date("2026-11-05T09:00:00Z") }, ticket())).toBe(false);
  });

  it("catches a date moving", () => {
    expect(unchanged(ticket(), { ...ticket(), ttUpdatedAt: new Date("2026-11-02T10:00:00Z") })).toBe(false);
  });

  it("catches a changed canvas pick and its resolution", () => {
    expect(unchanged(ticket(), { ...ticket(), canvasAnswer: "Lobster Matchbox" })).toBe(false);
    expect(unchanged(ticket(), { ...ticket(), resolvedDesignId: "des_2" })).toBe(false);
    expect(unchanged(ticket(), { ...ticket(), resolveStatus: "unmapped" })).toBe(false);
  });

  it("catches a boolean flipping and a number moving", () => {
    expect(unchanged(ticket(), { ...ticket(), resolvedNeedsKit: false })).toBe(false);
    expect(unchanged(ticket(), { ...ticket(), listedPriceCents: 7000 })).toBe(false);
  });

  it("catches null replacing a value and a value replacing null", () => {
    expect(unchanged(ticket(), { ...ticket(), attendeeName: null })).toBe(false);
    expect(unchanged({ ...ticket(), attendeeName: null }, ticket())).toBe(false);
  });

  it("does not treat null and undefined as different", () => {
    // Prisma returns null for an unset column; a parser may leave the key
    // undefined. Writing on that difference every sync would save nothing.
    expect(unchanged({ ...ticket(), attendeeEmail: null }, { ...ticket(), attendeeEmail: null })).toBe(true);
  });

  it("ignores `raw`, and only `raw`", () => {
    // `raw` is a record of what arrived, never read to make a decision, and
    // diffing stored blobs would cost more than the write it saves.
    const stored = { ...ticket(), raw: { a: 1 } };
    expect(unchanged(stored, { ...ticket(), raw: { b: 2 } })).toBe(true);
    expect(unchanged(stored, { ...ticket(), raw: { b: 2 }, ttStatus: "voided" })).toBe(false);
  });

  it("ignores columns the sync does not write", () => {
    // `overrideDesignId` is ours, not Ticket Tailor's: it comes back in the
    // same read but is not part of the incoming data, and its presence must not
    // force a write on every ticket that has one.
    const stored = { ...ticket(), overrideDesignId: "des_9" };
    expect(unchanged(stored, ticket())).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { parseEnvelope, eventIdFromPayload, isHandled } from "./webhook";
import orders from "./__fixtures__/orders.json";
import aeronaut from "./__fixtures__/issued_tickets_aeronaut.json";

const anOrder = (orders.data as Record<string, unknown>[])[0];
const aTicket = (aeronaut.data as Record<string, unknown>[])[0];

describe("finding the event in a payload", () => {
  it("reads event_id straight off an issued ticket", () => {
    expect(eventIdFromPayload(aTicket)).toBe("ev_9365960");
  });

  it("reads event_summary.id off an order, which has no event_id", () => {
    expect(anOrder.event_id).toBeUndefined();
    expect(eventIdFromPayload(anOrder)).toMatch(/^ev_/);
  });

  it("falls back to a nested ticket's event_id", () => {
    expect(eventIdFromPayload({
      issued_tickets: [{ id: "it_1", event_id: "ev_fallback" }],
    })).toBe("ev_fallback");
  });

  it("returns null rather than guessing", () => {
    expect(eventIdFromPayload({})).toBeNull();
    expect(eventIdFromPayload(null)).toBeNull();
    expect(eventIdFromPayload({ event_id: "" })).toBeNull();
    expect(eventIdFromPayload({ issued_tickets: [{ id: "it_1" }] })).toBeNull();
  });
});

describe("parsing an envelope", () => {
  const env = (over: Record<string, unknown> = {}) => parseEnvelope({
    id: "wh_abc123", created_at: 1793574103, event: "issued_ticket.created",
    resource_url: "https://api.tickettailor.com/v1/issued_tickets/it_1",
    payload: aTicket, ...over,
  });

  it("pulls out the delivery id, which is the idempotency key", () => {
    expect(env().deliveryId).toBe("wh_abc123");
  });

  it("classifies the four events we act on", () => {
    for (const e of ["order.created", "order.updated", "issued_ticket.created", "issued_ticket.updated"]) {
      const p = env({ event: e });
      expect(p.kind).toBe(e);
      expect(isHandled(p.kind)).toBe(true);
    }
  });

  it("treats anything else as other, to be acknowledged and ignored", () => {
    for (const e of ["event.created", "event.deleted", "", "something.new"]) {
      const p = env({ event: e });
      expect(p.kind).toBe("other");
      expect(isHandled(p.kind)).toBe(false);
    }
  });

  it("finds the event id through the envelope", () => {
    expect(env().ttEventId).toBe("ev_9365960");
    expect(env({ event: "order.created", payload: anOrder }).ttEventId).toMatch(/^ev_/);
  });

  it("survives a missing or junk envelope without throwing", () => {
    for (const b of [null, undefined, 42, "nope", {}, { payload: null }]) {
      expect(() => parseEnvelope(b)).not.toThrow();
      expect(parseEnvelope(b).kind).toBe("other");
    }
  });

  it("reports a missing delivery id as null, so the route can refuse to dedupe blind", () => {
    expect(parseEnvelope({ event: "order.created", payload: aTicket }).deliveryId).toBeNull();
  });
});

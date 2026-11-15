import { describe, it, expect } from "vitest";
import { parseEnvelope, eventIdFromPayload, isHandled, orderIdFromResourceUrl } from "./webhook";
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

  /**
   * These are the strings Ticket Tailor ACTUALLY sends, copied off live
   * deliveries in `ticket_tailor_webhook_deliveries`. They are the whole
   * reason this file needed fixing: the names were originally guessed in
   * lower case as `order.created`, every real delivery fell through to
   * "other", and a test suite written from the same guess passed.
   *
   * Do not relax these to the lower-case spellings. If a name here ever stops
   * matching a live delivery, the delivery log is the source of truth.
   */
  it("classifies the names seen on live deliveries", () => {
    const seen: [string, string][] = [
      ["ORDER_V2.CREATED", "order.created"],
      ["ISSUED_TICKET.CREATED", "issued_ticket.created"],
    ];
    for (const [sent, kind] of seen) {
      const p = env({ event: sent });
      expect(p.kind, `${sent} must be handled`).toBe(kind);
      expect(isHandled(p.kind)).toBe(true);
    }
  });

  it("classifies the updates too, which are how a cancellation arrives", () => {
    // Not yet observed live — the 11 voided tickets on record all predate the
    // first delivery — so this is what we will do IF they are subscribed.
    for (const [sent, kind] of [
      ["ORDER_V2.UPDATED", "order.updated"],
      ["ISSUED_TICKET.UPDATED", "issued_ticket.updated"],
    ] as [string, string][]) {
      expect(env({ event: sent }).kind).toBe(kind);
      expect(isHandled(env({ event: sent }).kind)).toBe(true);
    }
  });

  it("accepts the unversioned and lower-case spellings as well", () => {
    // Costs nothing and means a change of casing or a dropped version suffix
    // on their side is not another silent five days.
    for (const e of ["order.created", "ORDER.CREATED", "issued_ticket.updated", "Issued_Ticket.Created"]) {
      expect(isHandled(env({ event: e }).kind), e).toBe(true);
    }
  });

  it("treats an unknown resource or action as other, to be acknowledged and ignored", () => {
    for (const e of [
      "EVENT.CREATED",       // a real Ticket Tailor event we do not act on
      "EVENT.DELETED",
      "ORDER_V2.DELETED",    // known resource, action we have no handling for
      "ORDER_V99.CREATED",   // a version not in the alias table
      "",
      "something.new",
      "ORDER_V2",            // no action at all
      ".CREATED",            // no resource at all
    ]) {
      const p = env({ event: e });
      expect(p.kind, e).toBe("other");
      expect(isHandled(p.kind)).toBe(false);
    }
  });

  it("finds the event id through the envelope", () => {
    expect(env().ttEventId).toBe("ev_9365960");
    expect(env({ event: "ORDER_V2.CREATED", payload: anOrder }).ttEventId).toMatch(/^ev_/);
  });

  it("reports no event id for an order webhook payload, which is the live case", () => {
    // `anOrder` above is an API response and DOES carry event_summary. A real
    // ORDER_V2 delivery does not: 10 of 10 live ones resolved to null. The
    // route handles that by looking the order up by its resource url, so this
    // must keep returning null rather than inventing something.
    const p = parseEnvelope({
      id: "wh_order", event: "ORDER_V2.CREATED",
      resource_url: "https://api.tickettailor.com/v1/orders/or_87136845",
      payload: { id: "or_87136845", status: "completed" },
    });
    expect(p.kind).toBe("order.created");
    expect(p.ttEventId).toBeNull();
    expect(orderIdFromResourceUrl(p.resourceUrl)).toBe("or_87136845");
  });

  it("survives a missing or junk envelope without throwing", () => {
    for (const b of [null, undefined, 42, "nope", {}, { payload: null }]) {
      expect(() => parseEnvelope(b)).not.toThrow();
      expect(parseEnvelope(b).kind).toBe("other");
    }
  });

  it("reports a missing delivery id as null, so the route can refuse to dedupe blind", () => {
    expect(parseEnvelope({ event: "ORDER_V2.CREATED", payload: aTicket }).deliveryId).toBeNull();
  });
});

describe("placing an order delivery by its resource url", () => {
  it("pulls the order id out of a real resource url", () => {
    expect(orderIdFromResourceUrl("https://api.tickettailor.com/v1/orders/or_87136845")).toBe("or_87136845");
  });

  it("is not fooled by a url for some other resource", () => {
    // An issued ticket url must not yield an order id — the route would then
    // look up the wrong row, or none, and silently skip the re-sync.
    expect(orderIdFromResourceUrl("https://api.tickettailor.com/v1/issued_tickets/it_143586230")).toBeNull();
    expect(orderIdFromResourceUrl("https://api.tickettailor.com/v1/events/ev_9365977")).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(orderIdFromResourceUrl(null)).toBeNull();
    expect(orderIdFromResourceUrl(undefined)).toBeNull();
    expect(orderIdFromResourceUrl("")).toBeNull();
    expect(orderIdFromResourceUrl("https://api.tickettailor.com/v1/orders/")).toBeNull();
  });
});

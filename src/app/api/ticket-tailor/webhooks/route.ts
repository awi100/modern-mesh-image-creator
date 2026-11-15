import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { verifySignature } from "@/lib/ticket-tailor/signature";
import { parseEnvelope, isHandled, orderIdFromResourceUrl } from "@/lib/ticket-tailor/webhook";
import { syncEvent } from "@/lib/ticket-tailor/sync";

export const dynamic = "force-dynamic";
/** A sync of one event is a handful of sequential API calls. */
export const maxDuration = 60;

/**
 * POST /api/ticket-tailor/webhooks
 *
 * Authenticated by HMAC, so it is in `publicPaths` in src/middleware.ts.
 *
 * THIS NEVER MOVES STOCK. It re-syncs the affected event so the page is current
 * and nothing more. Deduction happens only when someone presses Confirm, after
 * physically pulling the canvases.
 *
 * Idempotent by Ticket Tailor's own delivery id: they retry 22 times with
 * exponential backoff over 72 hours and may deliver the same event more than
 * once, so a repeat of something already processed returns 200 without redoing
 * the work. Even if it did redo it, every write in the sync is an upsert — the
 * dedupe saves the API calls, it is not what protects correctness.
 */
export async function POST(request: NextRequest) {
  // Raw body first: the signature covers the exact bytes, so parsing before
  // verifying would make the check meaningless.
  const rawBody = await request.text();
  const header = request.headers.get("tickettailor-webhook-signature");

  const check = verifySignature(
    rawBody,
    header,
    process.env.TICKET_TAILOR_WEBHOOK_SECRET,
    Math.floor(Date.now() / 1000),
  );
  if (!check.ok) {
    console.error(`[tt webhook] rejected: ${check.reason}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let envelope;
  try {
    envelope = parseEnvelope(JSON.parse(rawBody));
  } catch {
    // Signed but unparseable. Retrying cannot help, so take it off their queue.
    console.error("[tt webhook] signed body was not JSON");
    return NextResponse.json({ message: "Body was not JSON; ignored" });
  }

  const { deliveryId, event, kind, resourceUrl, ttEventId } = envelope;
  if (!deliveryId) {
    console.error("[tt webhook] envelope had no id, so it cannot be de-duplicated");
    return NextResponse.json({ message: "No delivery id; ignored" });
  }

  // Claim the delivery. A unique violation means we have seen it before.
  try {
    await prisma.ticketTailorWebhookDelivery.create({
      data: { id: deliveryId, event: event ?? "unknown", resourceUrl, ttEventId },
    });
  } catch {
    const existing = await prisma.ticketTailorWebhookDelivery.findUnique({ where: { id: deliveryId } });
    if (existing?.processedAt) {
      return NextResponse.json({ message: "Already processed", deliveryId });
    }
    // Seen but never finished — a previous attempt died mid-flight. Fall
    // through and try again rather than leaving the event stale forever.
    console.warn(`[tt webhook] retrying delivery ${deliveryId}, which was received but not processed`);
  }

  if (!isHandled(kind)) {
    await markProcessed(deliveryId);
    return NextResponse.json({ message: `Ignored ${event}`, deliveryId });
  }

  // An ORDER_V2 payload does not carry its event id, so place the delivery by
  // the order it names instead. See orderIdFromResourceUrl for why the payload
  // cannot be relied on and why a created order does not need this.
  let eventId = ttEventId;
  if (!eventId) {
    const orderId = orderIdFromResourceUrl(resourceUrl);
    if (orderId) {
      const known = await prisma.ticketTailorOrder.findUnique({
        where: { ttOrderId: orderId },
        select: { ttEventId: true },
      });
      eventId = known?.ttEventId ?? null;
    }
  }

  if (!eventId) {
    // Nothing to re-sync. Not an error: making them retry 22 times would not
    // conjure an event id.
    await markProcessed(deliveryId, "could not place this delivery against an event");
    return NextResponse.json({ message: "No event id in payload; ignored", deliveryId });
  }

  try {
    // Re-fetch from the API rather than trusting the payload. A webhook body is
    // one resource at one instant; the sync reads the event's whole current
    // state, which is what the page needs and what makes redelivery harmless.
    const result = await syncEvent(eventId);
    await markProcessed(deliveryId, result.errors.length ? result.errors.join("; ").slice(0, 1000) : null, eventId);
    return NextResponse.json({ deliveryId, ttEventId: eventId, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[tt webhook] ${event} for ${eventId} failed:`, message);
    await prisma.ticketTailorWebhookDelivery
      .update({ where: { id: deliveryId }, data: { error: message.slice(0, 1000) } })
      .catch(() => {});
    // 500 so they retry — this one might succeed later.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * `ttEventId` is written back here as well as on create, because an order
 * delivery arrives without one and is only placed against an event afterwards.
 * Recording it is what makes the delivery log answer "did the void on order X
 * reach us", rather than just "something arrived".
 */
/** What the events page shows about webhook health. */
export interface WebhookHealth {
  /** Deliveries ever received. 0 means the endpoint has never been reached. */
  total: number;
  /** Received in the last 7 days — what says whether it is working NOW. */
  recent: number;
  lastAt: string | null;
  lastEvent: string | null;
  /** Received but never finished, or finished with an error recorded. */
  failed: number;
}

/**
 * GET /api/ticket-tailor/webhooks — is the endpoint actually being reached?
 *
 * This exists because there was no way to tell. Webhooks were silently doing
 * nothing for five days (the event names did not match, see
 * src/lib/ticket-tailor/webhook.ts) while the notes in the repo said no
 * delivery had ever arrived; both the failure and the wrong explanation were
 * invisible because nothing displayed the delivery log.
 *
 * Authenticated explicitly: the POST on this path is in `publicPaths` in
 * src/middleware.ts because it carries an HMAC, and middleware matches on
 * prefix, so this GET is not behind the session gate by default.
 */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  // Deliberately NOT reporting "how many were ignored", which is the shape of
  // the bug this was added after: nothing on the delivery row records what the
  // route decided to do, and every proxy for it is wrong — an ignored
  // ISSUED_TICKET delivery still has an event id, so counting rows without one
  // would have reported all 20 silent deliveries as healthy. Recording that
  // properly needs one more column; until then this reports only what the
  // table can actually answer.
  const [total, recent, last, failed] = await Promise.all([
    prisma.ticketTailorWebhookDelivery.count(),
    prisma.ticketTailorWebhookDelivery.count({ where: { receivedAt: { gte: sevenDaysAgo } } }),
    prisma.ticketTailorWebhookDelivery.findFirst({
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true, event: true },
    }),
    prisma.ticketTailorWebhookDelivery.count({
      where: { OR: [{ processedAt: null }, { error: { not: null } }] },
    }),
  ]);

  const health: WebhookHealth = {
    total,
    recent,
    lastAt: last?.receivedAt.toISOString() ?? null,
    lastEvent: last?.event ?? null,
    failed,
  };
  return NextResponse.json(health);
}

async function markProcessed(deliveryId: string, error?: string | null, ttEventId?: string | null) {
  await prisma.ticketTailorWebhookDelivery
    .update({
      where: { id: deliveryId },
      data: {
        processedAt: new Date(),
        error: error ?? null,
        ...(ttEventId ? { ttEventId } : {}),
      },
    })
    .catch(() => {});
}

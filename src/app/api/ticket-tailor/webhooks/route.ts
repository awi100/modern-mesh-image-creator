import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySignature } from "@/lib/ticket-tailor/signature";
import { parseEnvelope, isHandled } from "@/lib/ticket-tailor/webhook";
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

  if (!ttEventId) {
    // Nothing to re-sync. Not an error: making them retry 22 times would not
    // conjure an event id.
    await markProcessed(deliveryId, "no event id in payload");
    return NextResponse.json({ message: "No event id in payload; ignored", deliveryId });
  }

  try {
    // Re-fetch from the API rather than trusting the payload. A webhook body is
    // one resource at one instant; the sync reads the event's whole current
    // state, which is what the page needs and what makes redelivery harmless.
    const result = await syncEvent(ttEventId);
    await markProcessed(deliveryId, result.errors.length ? result.errors.join("; ").slice(0, 1000) : null);
    return NextResponse.json({ deliveryId, ttEventId, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[tt webhook] ${event} for ${ttEventId} failed:`, message);
    await prisma.ticketTailorWebhookDelivery
      .update({ where: { id: deliveryId }, data: { error: message.slice(0, 1000) } })
      .catch(() => {});
    // 500 so they retry — this one might succeed later.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function markProcessed(deliveryId: string, error?: string | null) {
  await prisma.ticketTailorWebhookDelivery
    .update({ where: { id: deliveryId }, data: { processedAt: new Date(), error: error ?? null } })
    .catch(() => {});
}

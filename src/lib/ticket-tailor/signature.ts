/**
 * Ticket Tailor webhook signatures.
 *
 * The header is `Tickettailor-Webhook-Signature`, comma-separated, with one
 * part carrying a unix timestamp and another the hex HMAC-SHA256 of
 * `timestamp + rawBody` (concatenated, no separator) under the box office's
 * webhook secret.
 *
 * Parsed defensively rather than positionally: the key names are not
 * guaranteed, parts may be reordered, and a future version may add more. So we
 * split each part on its FIRST `=` only — a base64-ish value containing `=`
 * padding must survive — and classify by shape: the all-digits value is the
 * timestamp, the long hex value is the signature.
 *
 * Mirrors the Shopify verifier in
 * src/app/api/shopify/webhooks/fulfillment/route.ts, including the length guard
 * before timingSafeEqual (which throws on a length mismatch, so a malformed
 * header would otherwise take the route down rather than returning 401).
 */

import crypto from "crypto";

/** Replay window. Ticket Tailor's docs say reject anything older than 5
 *  minutes; the same tolerance is applied to clock skew the other way, since a
 *  timestamp far in the future is just as much a sign of a forged header. */
export const MAX_AGE_SECONDS = 300;

export type SignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: string };

export interface ParsedSignatureHeader {
  timestamp: number | null;
  signature: string | null;
}

/**
 * Pull the timestamp and signature out of the header without relying on the
 * key names or the order of the parts.
 */
export function parseSignatureHeader(header: string): ParsedSignatureHeader {
  const out: ParsedSignatureHeader = { timestamp: null, signature: null };
  if (!header) return out;

  for (const rawPart of header.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    // A bare value with no "=" is still usable — classify it by shape.
    const value = eq === -1 ? part : part.slice(eq + 1).trim();
    if (!value) continue;

    if (/^\d{9,13}$/.test(value)) {
      // Seconds (10 digits today) or milliseconds (13). Normalise to seconds.
      const n = Number(value);
      if (out.timestamp === null) out.timestamp = value.length >= 13 ? Math.floor(n / 1000) : n;
    } else if (/^[0-9a-f]{64}$/i.test(value)) {
      if (out.signature === null) out.signature = value.toLowerCase();
    }
  }
  return out;
}

/**
 * Verify a delivery.
 *
 * `nowSec` is injected rather than read from the clock so the freshness rule is
 * testable without faking time.
 */
export function verifySignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string | null | undefined,
  nowSec: number,
): SignatureResult {
  if (!secret) return { ok: false, reason: "TICKET_TAILOR_WEBHOOK_SECRET not configured" };
  if (!header) return { ok: false, reason: "missing signature header" };

  const { timestamp, signature } = parseSignatureHeader(header);
  if (timestamp === null) return { ok: false, reason: "no timestamp in signature header" };
  if (signature === null) return { ok: false, reason: "no sha256 signature in signature header" };

  const age = nowSec - timestamp;
  if (age > MAX_AGE_SECONDS) return { ok: false, reason: `stale timestamp (${age}s old)` };
  if (age < -MAX_AGE_SECONDS) return { ok: false, reason: `timestamp ${-age}s in the future` };

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}${rawBody}`, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "signature length mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  return { ok: true, timestamp };
}

/** Build a header the way Ticket Tailor does — test-only, so a fixture can be
 *  signed without hard-coding a digest that would rot if a fixture changes. */
export function signForTest(rawBody: string, secret: string, timestamp: number): string {
  const sig = crypto.createHmac("sha256", secret).update(`${timestamp}${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

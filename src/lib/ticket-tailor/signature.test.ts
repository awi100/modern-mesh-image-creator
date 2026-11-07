import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifySignature, parseSignatureHeader, signForTest, MAX_AGE_SECONDS } from "./signature";

const SECRET = "whsec_test_abc123";
const BODY = JSON.stringify({ id: "wh_1", event: "issued_ticket.created", payload: { id: "it_1" } });
const NOW = 1_793_574_103;

describe("parsing the signature header", () => {
  it("reads a timestamp and signature regardless of the key names", () => {
    const sig = "a".repeat(64);
    expect(parseSignatureHeader(`t=${NOW},v1=${sig}`)).toEqual({ timestamp: NOW, signature: sig });
    // Key names are not guaranteed, so nothing may depend on them.
    expect(parseSignatureHeader(`timestamp=${NOW},signature=${sig}`)).toEqual({ timestamp: NOW, signature: sig });
  });

  it("does not care about the order of the parts", () => {
    const sig = "b".repeat(64);
    expect(parseSignatureHeader(`v1=${sig},t=${NOW}`)).toEqual({ timestamp: NOW, signature: sig });
  });

  it("ignores extra parts a future version might add", () => {
    const sig = "c".repeat(64);
    const p = parseSignatureHeader(`t=${NOW},v1=${sig},v2=somethingelse,scheme=hmac`);
    expect(p).toEqual({ timestamp: NOW, signature: sig });
  });

  it("splits on the first = only, so a padded value survives", () => {
    const sig = "d".repeat(64);
    expect(parseSignatureHeader(`t=${NOW},v1=${sig},extra=a=b=c`).signature).toBe(sig);
  });

  it("normalises a millisecond timestamp to seconds", () => {
    const sig = "e".repeat(64);
    expect(parseSignatureHeader(`t=${NOW}000,v1=${sig}`).timestamp).toBe(NOW);
  });

  it("returns nulls for junk rather than throwing", () => {
    expect(parseSignatureHeader("")).toEqual({ timestamp: null, signature: null });
    expect(parseSignatureHeader("garbage")).toEqual({ timestamp: null, signature: null });
    expect(parseSignatureHeader(",,,=,=")).toEqual({ timestamp: null, signature: null });
  });
});

describe("verifying a delivery", () => {
  it("accepts a correctly signed body", () => {
    const r = verifySignature(BODY, signForTest(BODY, SECRET, NOW), SECRET, NOW);
    expect(r).toEqual({ ok: true, timestamp: NOW });
  });

  it("signs timestamp + body concatenated, with no separator", () => {
    // Pinning the construction: a separator would make us reject every real
    // delivery, and the failure would look like a wrong secret.
    const manual = crypto.createHmac("sha256", SECRET).update(`${NOW}${BODY}`, "utf8").digest("hex");
    expect(signForTest(BODY, SECRET, NOW)).toBe(`t=${NOW},v1=${manual}`);
  });

  it("rejects a tampered body", () => {
    const header = signForTest(BODY, SECRET, NOW);
    const r = verifySignature(BODY.replace("it_1", "it_2"), header, SECRET, NOW);
    expect(r).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects the wrong secret", () => {
    const header = signForTest(BODY, "whsec_someone_elses", NOW);
    expect(verifySignature(BODY, header, SECRET, NOW)).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects a stale timestamp", () => {
    const old = NOW - MAX_AGE_SECONDS - 1;
    const r = verifySignature(BODY, signForTest(BODY, SECRET, old), SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/stale/);
  });

  it("accepts one right at the edge of the window", () => {
    const edge = NOW - MAX_AGE_SECONDS;
    expect(verifySignature(BODY, signForTest(BODY, SECRET, edge), SECRET, NOW).ok).toBe(true);
  });

  it("rejects a timestamp far in the future", () => {
    const ahead = NOW + MAX_AGE_SECONDS + 60;
    const r = verifySignature(BODY, signForTest(BODY, SECRET, ahead), SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/future/);
  });

  it("rejects a malformed header without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the guard turns that into a
    // clean 401 instead of a 500 that Ticket Tailor would retry 22 times.
    for (const h of ["", "garbage", `t=${NOW}`, "v1=tooshort", `t=${NOW},v1=zz`]) {
      expect(() => verifySignature(BODY, h, SECRET, NOW)).not.toThrow();
      expect(verifySignature(BODY, h, SECRET, NOW).ok).toBe(false);
    }
  });

  it("fails closed when the secret is not configured", () => {
    const r = verifySignature(BODY, signForTest(BODY, SECRET, NOW), undefined, NOW);
    expect(r).toEqual({ ok: false, reason: "TICKET_TAILOR_WEBHOOK_SECRET not configured" });
  });
});

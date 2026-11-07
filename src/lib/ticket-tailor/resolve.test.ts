import { describe, it, expect } from "vitest";
import { resolveTicket, mappingsByKey, type MappingLike } from "./resolve";

const maps: MappingLike[] = [
  { answerKey: "fenway frank", designId: "d_fenway", needsKit: true },
  { answerKey: "comm ave street sign", designId: "d_commave", needsKit: true },
  { answerKey: "shamrock intro kit", designId: "d_shamrock_intro", needsKit: true },
  { answerKey: "shamrock", designId: "d_shamrock_18", needsKit: true },
  { answerKey: "gift card", designId: null, needsKit: false }, // not a canvas
  { answerKey: "bare canvas special", designId: "d_bare", needsKit: false },
];
const byKey = mappingsByKey(maps);

describe("resolving a pick", () => {
  it("maps an exact answer", () => {
    expect(resolveTicket({ canvasAnswer: "Fenway Frank", answerKey: "fenway frank" }, byKey))
      .toEqual({ designId: "d_fenway", needsKit: true, status: "mapped", masked: false });
  });

  it("maps either capitalisation of the same pick", () => {
    for (const a of ["Fenway Frank", "FENWAY FRANK", "  fenway   frank  "]) {
      expect(resolveTicket({ canvasAnswer: a }, byKey).designId).toBe("d_fenway");
    }
  });

  it("keeps Shamrock and Shamrock Intro Kit apart", () => {
    // Both are real designs, 18ct and 13ct, and both appear in production.
    expect(resolveTicket({ canvasAnswer: "Shamrock" }, byKey).designId).toBe("d_shamrock_18");
    expect(resolveTicket({ canvasAnswer: "Shamrock Intro Kit" }, byKey).designId).toBe("d_shamrock_intro");
  });

  it("uses a mapping to reach a design the answer does not name", () => {
    // "Comm Ave Street Sign" is the answer; the design is "Comm Ave".
    expect(resolveTicket({ canvasAnswer: "Comm Ave Street Sign" }, byKey).designId).toBe("d_commave");
  });

  it("lets an override beat the mapping", () => {
    const r = resolveTicket({ canvasAnswer: "Fenway Frank", overrideDesignId: "d_lobster" }, byKey);
    expect(r).toEqual({ designId: "d_lobster", needsKit: true, status: "override", masked: false });
  });

  it("overrides even an unmapped answer, so one ticket need not block an event", () => {
    const r = resolveTicket({ canvasAnswer: "Something Brand New", overrideDesignId: "d_crab" }, byKey);
    expect(r.status).toBe("override");
    expect(r.designId).toBe("d_crab");
  });

  it("reports an unmapped answer rather than guessing", () => {
    const r = resolveTicket({ canvasAnswer: "Mystery Thing" }, byKey);
    expect(r).toEqual({ designId: null, needsKit: true, status: "unmapped", masked: false });
  });

  it("separates an answer deliberately ignored from one not yet mapped", () => {
    expect(resolveTicket({ canvasAnswer: "Gift Card" }, byKey).status).toBe("ignored");
    expect(resolveTicket({ canvasAnswer: "Gift Cardz" }, byKey).status).toBe("unmapped");
  });

  it("reports no answer at all", () => {
    // Publico sold 81 tickets with 60 answers, so this is common, not an edge.
    for (const t of [{}, { canvasAnswer: null }, { canvasAnswer: "   " }]) {
      expect(resolveTicket(t, byKey).status).toBe("no_answer");
    }
  });

  it("never treats a masked answer as an answer", () => {
    // Otherwise "****" becomes one mapping row absorbing every ticket.
    const r = resolveTicket({ canvasAnswer: "****", answerKey: "****", answerMasked: true }, byKey);
    expect(r.status).toBe("unmapped");
    expect(r.designId).toBeNull();
    expect(r.masked).toBe(true);
  });

  it("still honours an override on a masked ticket, but keeps the alarm", () => {
    const r = resolveTicket({ canvasAnswer: "****", answerMasked: true, overrideDesignId: "d_crab" }, byKey);
    expect(r.status).toBe("override");
    expect(r.masked).toBe(true);
  });

  it("honours a mapping that says canvas without a kit", () => {
    expect(resolveTicket({ canvasAnswer: "Bare Canvas Special" }, byKey))
      .toMatchObject({ designId: "d_bare", needsKit: false, status: "mapped" });
  });

  it("defaults needsKit true everywhere else, since every sip-and-stitch canvas is kitted", () => {
    expect(resolveTicket({ canvasAnswer: "Fenway Frank" }, byKey).needsKit).toBe(true);
    expect(resolveTicket({ canvasAnswer: "Unknown" }, byKey).needsKit).toBe(true);
    expect(resolveTicket({ overrideDesignId: "d_x" }, byKey).needsKit).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { parseOverrides, sameOverrides, diffOverrides } from "./print-colors";

describe("parsing stored overrides", () => {
  it("reads a normal map", () => {
    expect(parseOverrides('{"209":"#9070C8"}')).toEqual({ "209": "#9070C8" });
  });
  it("treats null and empty as no adjustments", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("")).toEqual({});
  });
  it("does not throw on malformed JSON or the wrong shape", () => {
    // A revision is history; a parse error must not take the page down with it.
    expect(parseOverrides("{not json")).toEqual({});
    expect(parseOverrides('["209"]')).toEqual({});
    expect(parseOverrides("null")).toEqual({});
  });
});

describe("comparing override sets", () => {
  it("ignores key order", () => {
    expect(sameOverrides({ a: "#111", b: "#222" }, { b: "#222", a: "#111" })).toBe(true);
  });
  it("ignores hex case", () => {
    expect(sameOverrides({ "209": "#9070c8" }, { "209": "#9070C8" })).toBe(true);
  });
  it("sees an added or removed colour", () => {
    expect(sameOverrides({ a: "#111" }, { a: "#111", b: "#222" })).toBe(false);
    expect(sameOverrides({ a: "#111", b: "#222" }, { a: "#111" })).toBe(false);
  });
  it("sees a changed hex", () => {
    expect(sameOverrides({ a: "#111" }, { a: "#112" })).toBe(false);
  });
  it("counts two empty sets as the same", () => {
    expect(sameOverrides({}, {})).toBe(true);
  });
});

describe("diffing revisions", () => {
  it("reports what changed, added and removed", () => {
    const d = diffOverrides({ "209": "#111111", "310": "#222222" }, { "209": "#999999", "500": "#333333" });
    expect(d).toEqual([
      { dmcNumber: "209", from: "#111111", to: "#999999" },
      { dmcNumber: "310", from: "#222222", to: null },   // reset to the DMC hex
      { dmcNumber: "500", from: null, to: "#333333" },   // newly adjusted
    ]);
  });
  it("is empty when nothing moved", () => {
    expect(diffOverrides({ a: "#111" }, { a: "#111" })).toEqual([]);
  });
});

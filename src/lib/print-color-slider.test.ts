import { describe, it, expect } from "vitest";
import { printHexForLightness, isBackToPalette } from "./print-color-slider";
import { hexToHsl } from "./pdf-export";
import { DMC_PEARL_COTTON } from "./dmc-pearl-cotton";

const PALETTE = "#2a9d5f"; // hue 147.65, sat 57.8%, lightness 39.0

/** One slider gesture: every onChange from `from` to `to`, a step apart. */
function drag(from: number, to: number, lightnessToHex: (l: number) => string): string {
  const dir = to > from ? 1 : -1;
  let hex = lightnessToHex(from);
  for (let l = from; l !== to + dir; l += dir) hex = lightnessToHex(l);
  return hex;
}

describe("the slider rebuilds from the palette", () => {
  it("gives the same hex for a lightness however it was reached", () => {
    // The whole point: no dependence on the previous value, so no compounding.
    expect(printHexForLightness(PALETTE, 39)).toBe(printHexForLightness(PALETTE, 39));
    expect(printHexForLightness(PALETTE, 85)).toBe("#c3efd7");
  });

  it("drags out and back to the original hex", () => {
    // The regression this replaces took hue/saturation from the previous
    // override, so this same gesture (~92 onChange events) walked #2a9d5f to
    // #2a9d75 — hue 147.65 -> 159.13 degrees, 5.47 dE2000 — and auto-saved it.
    const start = printHexForLightness(PALETTE, 39);
    drag(39, 85, (l) => printHexForLightness(PALETTE, l));
    const back = drag(85, 39, (l) => printHexForLightness(PALETTE, l));
    expect(back).toBe(start);
  });

  it("survives a click on either end point", () => {
    // hexToHsl reports {h:0, s:0} for black and white and the range is 0..100,
    // so rebuilding from the stored override stranded the colour achromatic:
    // one click on an end point left every later move grey (#636363, 29.41
    // dE2000) with no way back but Reset.
    expect(printHexForLightness(PALETTE, 0)).toBe("#000000");
    expect(printHexForLightness(PALETTE, 100)).toBe("#ffffff");

    // The hue is held by the palette, not by what was last written, so a move
    // off either end point comes back to exactly the original colour.
    expect(printHexForLightness(PALETTE, 39)).toBe(PALETTE);
    expect(hexToHsl(printHexForLightness(PALETTE, 39)).s).toBeGreaterThan(50);
  });

  it("keeps the palette's hue at every position the slider can reach", () => {
    // Across the usable band the hue holds to within 1 degree (worst 0.98 at
    // L=15). It loosens to 7.65 degrees at L=1, where a near-black colour has
    // only a few 8-bit codes left to carry a hue — that is the hex format, not
    // drift, and it does not accumulate, because the next move rebuilds from
    // the palette rather than from this value.
    const palette = hexToHsl(PALETTE);
    for (let l = 10; l <= 90; l++) {
      const hsl = hexToHsl(printHexForLightness(PALETTE, l));
      expect(Math.abs(hsl.h - palette.h)).toBeLessThan(1.5);
    }
    for (let l = 1; l <= 99; l++) {
      const hsl = hexToHsl(printHexForLightness(PALETTE, l));
      expect(Math.abs(hsl.h - palette.h)).toBeLessThan(8);
    }
  });
});

describe("detecting that the slider is back to the palette", () => {
  it("resets at the lightness the slider actually shows", () => {
    // The thumb sits at Math.round(l), so that is the position "unadjusted"
    // means — #2a9d5f is L 39.0.
    expect(isBackToPalette(39, PALETTE)).toBe(true);
    expect(isBackToPalette(38, PALETTE)).toBe(false);
    expect(isBackToPalette(40, PALETTE)).toBe(false);
  });

  it("can reset every palette colour by dragging, not just the round ones", () => {
    // Only 140 of the 480 palette colours survive the hex -> HSL -> round ->
    // hex trip (just 6 have an integer L* to begin with). Under the old exact
    // hex compare the other 340 kept a phantom override, one or
    // two channel steps off the palette, that the row showed as "adjusted"
    // forever.
    for (const c of DMC_PEARL_COTTON) {
      const shown = Math.round(hexToHsl(c.hex).l);
      expect(isBackToPalette(shown, c.hex)).toBe(true);
    }
  });

  it("does not swallow a genuine one-step nudge", () => {
    // A hex-channel tolerance wide enough to cover the drift (2 per channel,
    // e.g. #FDFDFF rebuilding as #ffffff) would also delete a real adjustment
    // on a dark colour. In slider units there is no overlap.
    for (const c of DMC_PEARL_COTTON) {
      const shown = Math.round(hexToHsl(c.hex).l);
      if (shown > 0) expect(isBackToPalette(shown - 1, c.hex)).toBe(false);
      if (shown < 100) expect(isBackToPalette(shown + 1, c.hex)).toBe(false);
    }
  });
});

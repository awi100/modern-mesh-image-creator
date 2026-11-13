/**
 * The print-colour lightness slider.
 *
 * The colours page lets you lighten or darken each DMC colour so the printed
 * canvas comes out closer to the thread. Lightness is the ONLY thing it can
 * change: there is no hue or saturation control anywhere in the app, and every
 * writer of `printColorOverrides` — this slider, `adjustColorForPrint` (the
 * auto-adjust button and the load-time defaults), and the restore route
 * replaying an earlier snapshot — leaves hue and saturation exactly as the
 * palette has them.
 *
 * So the slider rebuilds from the PALETTE every time, never from the override
 * it is replacing. That is what makes it idempotent. Rebuilding from the
 * previous override instead compounds the hex -> HSL -> hex rounding once per
 * onChange event: dragging #2a9d5f from L39 out to L85 and back to L39 in one
 * gesture (~92 events) lands on #2a9d75, hue walked 147.65 -> 159.13 degrees,
 * 5.47 dE2000 — and the debounced auto-save writes it out. Worse, `hexToHsl`
 * reports {h:0, s:0} for black and white, and the slider range is 0..100, so a
 * single click on either end point would strand the colour achromatic: every
 * later move rebuilds from grey and the hue is gone for good (#2a9d5f -> L0 ->
 * L39 gives #636363, 29.41 dE2000).
 *
 * Measured against the live database before this was written: across all 294
 * stored override entries, rebuilding from the palette's hue and saturation
 * instead of the override's own moves the colour by a mean of 0.071 dE2000,
 * max 1.699 — 4 entries above the just-noticeable 1.0. Nothing is being thrown
 * away, because nothing hand-matched a hue to throw away.
 *
 * Kept out of the page component because `src/app` has no test setup, and
 * idempotence is the part worth pinning down.
 */

import { hexToHsl, hslToHex } from "./pdf-export";

/**
 * The hex to store for a colour the slider has moved to `lightness`.
 *
 * Depends only on the palette and the slider position, so the same position
 * always yields the same hex no matter how it was reached.
 */
export function printHexForLightness(paletteHex: string, lightness: number): string {
  const hsl = hexToHsl(paletteHex);
  return hslToHex(hsl.h, hsl.s, lightness);
}

/**
 * Whether the slider is back where it started, so the override should be
 * dropped rather than stored as a no-op.
 *
 * Compared in lightness, not in hex. The slider emits whole numbers (step="1",
 * `parseInt`) and sits at `Math.round(l)`, but a palette colour's own lightness
 * is almost never whole — only 6 of the 480 have an integer L*, and only 140
 * survive the hex -> HSL -> round -> hex trip unchanged. Under the old exact
 * `newHex === color.hex` the other 340 could not be reset by dragging at all:
 * the colour came back to the eye
 * but a hex one or two steps off the palette stayed stored, so the row read
 * "adjusted" for good and every print-history entry counted it as a change.
 *
 * A tolerance on the hex channels would not do it either — the drift reaches 2
 * per channel (#FDFDFF rebuilds as #ffffff), and a 2-step tolerance is wide
 * enough to swallow a genuine one-point nudge on a dark colour. The slider's
 * own units have no such ambiguity.
 */
export function isBackToPalette(lightness: number, paletteHex: string): boolean {
  return Math.round(lightness) === Math.round(hexToHsl(paletteHex).l);
}

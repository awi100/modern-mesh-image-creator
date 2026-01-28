// Shared symbol list for distinguishing colors in grids and PDFs
export const SYMBOLS = [
  "\u25CF", "\u25A0", "\u25B2", "\u25C6", "\u2605", "\u2666", "\u2665", "\u2663", "\u2660",
  "\u25CB", "\u25A1", "\u25B3", "\u25C7", "\u2606", "\u2B21", "\u2B22", "\u2726", "\u2727",
  "+", "\u00D7", "\u00F7", "\u00B1", "\u221E", "\u2248", "\u2260", "\u2205", "\u2229",
  "\u03B1", "\u03B2", "\u03B3", "\u03B4", "\u03B5", "\u03B8", "\u03BB", "\u03BC", "\u03C0",
  "\u03A9", "\u03A3", "\u03A6", "\u03A8", "\u0394", "\u0393", "\u039B", "\u039E", "\u03A0",
];

/**
 * Returns relative luminance (0–1) from a hex color string.
 * Used to pick black or white text for contrast.
 */
export function hexLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  // sRGB luminance
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

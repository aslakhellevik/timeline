/**
 * Colour arithmetic shared by the three canvas renderers.
 *
 * Small on purpose. The renderers need three things and nothing else: an alpha
 * variant of a palette entry, a mix of two, and enough of the luminance formula
 * to decide whether text on a bar should be dark or light.
 */

/**
 * Last resort when a colour cannot be read at all.
 *
 * A neutral grey rather than something loud: an unparseable colour is a data
 * problem, and the drawing should stay legible rather than shout about it.
 */
export const FALLBACK_INK = '#898781';

export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Hex to RGB, or `null` for anything this does not understand.
 *
 * Validated rather than assumed. `Tag.color` arrives from packs and from
 * imported files, so `#f00` and `rebeccapurple` both reach the renderers in
 * practice — and the naive `parseInt(slice(0,2), 16)` produced `rgba(NaN, …)`,
 * which canvas ignores in silence. A tag whose colour was written in shorthand
 * simply stopped drawing, with nothing anywhere to say why.
 */
export function parseColour(colour: string): Rgb | null {
  if (typeof colour !== 'string' || !HEX.test(colour)) return null;

  const value = colour.slice(1);
  const expanded =
    value.length === 3
      ? `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`
      : value;

  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

/** Hex to rgba, so one palette entry can serve both a fill ramp and an edge. */
export function withAlpha(colour: string, alpha: number, fallback = FALLBACK_INK): string {
  const rgb = parseColour(colour) ?? parseColour(fallback) ?? [137, 135, 129];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** `amount` of the way from `from` to `to`, in sRGB. */
export function mix(from: string, to: string, amount: number, fallback = FALLBACK_INK): string {
  const a = parseColour(from) ?? parseColour(fallback) ?? [137, 135, 129];
  const b = parseColour(to) ?? [255, 255, 255];
  const u = Math.min(1, Math.max(0, amount));
  const at = (i: 0 | 1 | 2) => {
    const start = a[i] as number;
    return Math.round(start + ((b[i] as number) - start) * u);
  };
  return `rgb(${at(0)}, ${at(1)}, ${at(2)})`;
}

/**
 * What a translucent fill actually looks like once it is on the surface.
 *
 * The renderers draw era bars at half alpha, so the colour a reader sees is
 * never the colour in the palette — and choosing label ink against the palette
 * entry rather than against the composite is how a "light" bar ends up with
 * white text on it.
 */
export function composite(fg: string, bg: string, alpha: number): Rgb {
  const f = parseColour(fg) ?? [137, 135, 129];
  const b = parseColour(bg) ?? [0, 0, 0];
  const at = (i: 0 | 1 | 2) => (f[i] as number) * alpha + (b[i] as number) * (1 - alpha);
  return [at(0), at(1), at(2)];
}

/** Relative luminance, WCAG 2.1. 0 is black, 1 is white. */
export function luminance(rgb: Rgb): number {
  const channel = (v: number) => {
    const u = v / 255;
    return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/**
 * Ink that reads on a given background: dark text on a light bar, light on dark.
 *
 * The threshold is where the two candidates' contrast ratios cross for this
 * project's palette, not the textbook 0.179 — the light ink here is off-white
 * and the dark ink is the chart surface, so neither end is the ideal case the
 * standard figure assumes.
 */
export function inkOn(background: Rgb, dark: string, light: string): string {
  return luminance(background) > 0.32 ? dark : light;
}

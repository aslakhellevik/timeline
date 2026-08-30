/**
 * Canvas text shared by the three renderers: the label font, how much room a
 * label may take, truncation, and the date under the cursor.
 *
 * All of it was duplicated verbatim in `timeline-renderer.ts`,
 * `depth-renderer.ts` and `map-renderer.ts`, which is three chances to fix a
 * bug in one place and leave it in the other two.
 */

import type { Days } from '../core/model/types';
import { toGregorian } from '../core/time';
import { formatYear } from './ticks';

export const LABEL_FONT = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * How wide a truncated label may be, per role, in device-independent pixels.
 *
 * One table rather than a literal at each call site: these are the same
 * judgement made four times, and they only stay in proportion to each other if
 * they are written down together.
 *
 * Titles run long — "Tomás Vela is awarded the Ashcombe prize for work on a
 * vaccine for cattle plague carried out twenty years earlier" would occupy a
 * whole row on its own — so they are cut here and shown whole in the detail
 * pane.
 */
export const LABEL_WIDTH = {
  /** An event title on the flat timeline. */
  mark: 240,
  /** The same in the depth view, where the corridor leaves less room beside it. */
  depthMark: 190,
  /** An era's name, beside or inside its bar. */
  era: 150,
  /** The note at an arc's apex: one line, alone, so it can afford more. */
  arcNote: 336,
} as const;

/**
 * Truncates to `maxWidth`, appending an ellipsis only when it actually cuts.
 *
 * Binary search on the cut point rather than a character estimate, because
 * proportional fonts make "WWII" and "iiii" very different widths.
 */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Date under the cursor, at a precision the current zoom can actually justify. */
export function formatMoment(t: Days, spanDays: number): string {
  const { year, month, day } = toGregorian(t);
  const spanYears = spanDays / 365.2425;
  if (spanYears > 24) return formatYear(year);
  if (spanYears > 2) return `${MONTHS[month - 1]} ${formatYear(year)}`;
  return `${day} ${MONTHS[month - 1]} ${formatYear(year)}`;
}

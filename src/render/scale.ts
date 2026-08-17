/**
 * The time axis projection (docs/design.md §2.4, D12).
 *
 * Linear with continuous zoom is the default and the only one implemented. The
 * indirection exists because two other projections are plausible later — a
 * log-time axis anchored at now, and a density-equalised axis using the CDF of
 * the user's own knowledge as the transform — and neither should require the
 * renderer to be rewritten. Both are pure functions of the viewport.
 *
 * Nothing here knows about calendars. A `Days` value is just a float64.
 */

import type { Days, Viewport } from '../core/model/types';

export interface Scale {
  readonly name: string;
  /** Time to device-independent pixels, measured from the left edge. */
  toPx(t: Days, vp: Viewport): number;
  /** Pixels back to time. Exact inverse of `toPx`. */
  toTime(px: number, vp: Viewport): Days;
}

export const linearScale: Scale = {
  name: 'linear',
  toPx(t, vp) {
    return ((t - vp.start) / (vp.end - vp.start)) * vp.width;
  },
  toTime(px, vp) {
    return vp.start + (px / vp.width) * (vp.end - vp.start);
  },
};

/** Time units per pixel — the quantity the kernel bandwidth is defined against (§3.1). */
export function timePerPixel(vp: Viewport): number {
  return (vp.end - vp.start) / vp.width;
}

/**
 * Viewport arithmetic: pan, zoom, clamping. Pure functions over the `Viewport`
 * value — no canvas, no DOM, no state. The interaction layer turns gestures into
 * calls here, and the renderer only ever reads the result.
 *
 * Zoom is continuous. There are no discrete zoom levels anywhere in this project:
 * the far/mid/near transition is driven by events-per-pixel (§3.4), not by a
 * level counter, which is what keeps it from popping.
 */

import type { Days, Viewport } from '../core/model/types';

const DAY = 1;
const YEAR = 365.2425;

export interface ZoomLimits {
  /** Narrowest visible span. A day across the full width is as far as it goes. */
  minSpan: Days;
  /** Widest visible span. */
  maxSpan: Days;
}

export const DEFAULT_ZOOM_LIMITS: ZoomLimits = {
  minSpan: DAY,
  maxSpan: 8000 * YEAR,
};

/** Hard stops on where the window may sit, supplied by the app (§2.4). */
export interface TimeBounds {
  min: Days;
  max: Days;
}

export function span(vp: Viewport): Days {
  return vp.end - vp.start;
}

export function centre(vp: Viewport): Days {
  return (vp.start + vp.end) / 2;
}

/**
 * Clamps span to the zoom limits and then slides the window inside the bounds.
 *
 * Order matters: a window wider than the bounds is centred on them rather than
 * shoved against one edge, which is what you want when zooming all the way out.
 */
export function clamp(vp: Viewport, bounds: TimeBounds, limits = DEFAULT_ZOOM_LIMITS): Viewport {
  const available = bounds.max - bounds.min;
  const maxSpan = Math.min(limits.maxSpan, available);
  const wanted = Math.min(Math.max(span(vp), limits.minSpan), maxSpan);

  // Re-derive the window around its centre so clamping the span does not shift it.
  const c = centre(vp);
  let start = c - wanted / 2;
  let end = c + wanted / 2;

  if (start < bounds.min) {
    start = bounds.min;
    end = start + wanted;
  }
  if (end > bounds.max) {
    end = bounds.max;
    start = end - wanted;
  }

  return { start, end, width: vp.width };
}

/**
 * Zooms by `factor` (>1 zooms out) keeping the time under `anchorPx` pinned to
 * that pixel. This is what makes wheel-zoom feel attached to the cursor rather
 * than to the centre of the screen.
 */
export function zoomAt(
  vp: Viewport,
  anchorPx: number,
  factor: number,
  bounds: TimeBounds,
  limits = DEFAULT_ZOOM_LIMITS,
): Viewport {
  const fraction = vp.width === 0 ? 0.5 : anchorPx / vp.width;
  const anchorTime = vp.start + fraction * span(vp);
  const newSpan = span(vp) * factor;

  return clamp(
    {
      start: anchorTime - fraction * newSpan,
      end: anchorTime + (1 - fraction) * newSpan,
      width: vp.width,
    },
    bounds,
    limits,
  );
}

/** Pans by a pixel delta. Positive `dPx` moves the content left, i.e. forwards in time. */
export function panByPx(vp: Viewport, dPx: number, bounds: TimeBounds): Viewport {
  const dt = (dPx / vp.width) * span(vp);
  return clamp({ start: vp.start + dt, end: vp.end + dt, width: vp.width }, bounds);
}

/** Frames `[from, to]` with a fraction of padding on each side. */
export function fitTo(
  from: Days,
  to: Days,
  width: number,
  bounds: TimeBounds,
  padding = 0.05,
): Viewport {
  const raw = Math.max(to - from, DEFAULT_ZOOM_LIMITS.minSpan);
  const pad = raw * padding;
  return clamp({ start: from - pad, end: to + pad, width }, bounds);
}

/** Resizes without changing the visible time window. */
export function resize(vp: Viewport, width: number): Viewport {
  return { start: vp.start, end: vp.end, width };
}

/**
 * Interpolates between two windows in log space for the span and linear space for
 * the centre. Zooming linearly in span looks wrong — it accelerates at one end —
 * whereas constant proportional change reads as steady motion.
 */
export function interpolate(a: Viewport, b: Viewport, u: number): Viewport {
  const c = centre(a) + (centre(b) - centre(a)) * u;
  const s = Math.exp(Math.log(span(a)) + (Math.log(span(b)) - Math.log(span(a))) * u);
  return { start: c - s / 2, end: c + s / 2, width: b.width };
}

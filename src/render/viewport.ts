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
 *
 * **The anchor is the first thing `clamp` gives up.** At the span limits, and
 * against the pan bounds, the window it is handed cannot be honoured, and
 * `clamp` re-derives the result around its *centre* — so a wheel at the far
 * right of a fully zoomed-out canvas slides the content sideways rather than
 * holding still. Deliberate: the alternative is to preserve the anchor and let
 * the window drift outside the corpus, and a window that stays where it was
 * asked to be is the more useful of the two invariants at a hard stop.
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

/**
 * A little slack at each end of the frame, so the outermost events are not
 * flush to the edge.
 *
 * One copy, because two things have to agree about it: the pan bounds a view
 * hands the interaction layer, and the bounds `revealWindow` clamps against. If
 * they differed, a reveal would land somewhere the next gesture immediately
 * corrected.
 */
export function frameBounds(frame: { start: Days; end: Days }): TimeBounds {
  const margin = Math.max((frame.end - frame.start) * 0.02, 1);
  return { min: frame.start - margin, max: frame.end + margin };
}

/** The shortest period a reveal treats as the thing being revealed. */
const REVEAL_MIN_CONTEXT = 10 * YEAR;

/**
 * How many of those periods the window may hold and still count as showing one.
 *
 * Four, because "on screen" and "legible" are not the same claim, and only the
 * second one is worth moving the view for. Fitted to the whole corpus every
 * event is inside the window — the selected one included — and it is a hairline
 * among eight hundred others, dissolved into the mass by the semantic zoom
 * (D50). A reveal that stopped at "it is technically in the window" would do
 * nothing at all in exactly the case that made the bug worth fixing.
 *
 * Stated as a multiple of the target's own period rather than solved from the
 * density, though the density is what actually decides whether a mark resolves:
 * a solved window would land somewhere different for every event, and a reveal
 * has to be predictable enough that the second one teaches you what the first
 * one did.
 */
const REVEAL_MAX_CONTEXTS = 4;

/**
 * Half the width of the band that counts as comfortably on screen, as a
 * fraction of the window. The remainder is the edges, where a mark is about to
 * leave and a reveal should still act.
 */
const REVEAL_COMFORT = 0.44;

/**
 * The window that brings `[from, to]` into view, or `null` when it is already
 * there (docs/design.md §5.1).
 *
 * Two rules, in this order. The span the user chose is kept wherever it already
 * shows the target — a reveal is a **pan** whenever a pan is enough, because
 * zooming to a day around an instant throws away the period they were reading.
 * Where it is not enough the window is re-derived around the target: never
 * narrower than `1.8 ×` its length, which is `fitTo(from, to, …, 0.4)`, and
 * never wider than `REVEAL_MAX_CONTEXTS` of it. A re-derived window is centred
 * on the target.
 */
export function revealWindow(
  vp: Viewport,
  from: Days,
  to: Days,
  bounds: TimeBounds,
): Viewport | null {
  const target = Math.max(to - from, 0);
  const widest = Math.max(target, REVEAL_MIN_CONTEXT) * REVEAL_MAX_CONTEXTS;
  const current = span(vp);

  const near = vp.start + current * (0.5 - REVEAL_COMFORT);
  const far = vp.start + current * (0.5 + REVEAL_COMFORT);
  if (from >= near && to <= far && current <= widest) return null;

  const wanted = Math.min(Math.max(current, target * 1.8), widest);
  const middle = (from + to) / 2;
  const start = middle - wanted / 2;
  return clamp({ start, end: start + wanted, width: vp.width }, bounds);
}

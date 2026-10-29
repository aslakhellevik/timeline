/**
 * The trapezoid, in pixels (docs/design.md §5.1).
 *
 * A `TimeSpec` is four numbers: certain between `b` and `c`, uncertain over the
 * flanks `a`→`b` and `c`→`d`. Drawn, that is a solid bar with a ramp to
 * transparent at each end — the only honest rendering of "the years I was
 * reading Russian novels", since an era whose `a`≠`b` has no first day and a
 * crisp edge would claim it does.
 *
 * Eras were drawn this way from M4. Events were not, and that was the lie: an
 * interval event became a one-pixel tick at its mean, so `1914–1918` and a
 * single day in 1916 drew identically while the density beneath them plainly
 * did not agree. Both now share this geometry, which is what makes the two
 * layers say the same thing.
 *
 * Pure: pixels in, pixels out, no canvas.
 */

import type { Days } from '../core/model/types';

/** The four numbers this needs — `TimeSpec` and `Era['when']` both satisfy it. */
export interface SpanLike {
  a: Days;
  b: Days;
  c: Days;
  d: Days;
}

export interface SpanBar {
  /** Certain extent, `b`→`c`, clamped to a sane distance outside the viewport. */
  x1: number;
  x2: number;
  /** Ramp widths for the uncertain flanks, in pixels. */
  fadeLeft: number;
  fadeRight: number;
  /** Whether the span continues beyond the viewport, so the drawing can say so. */
  clippedLeft: boolean;
  clippedRight: boolean;
}

/**
 * Bar geometry for one span.
 *
 * Coordinates are clamped to a viewport's width either side, because an era
 * spanning four thousand years, viewed at a span of a week, puts an edge
 * billions of pixels away — and a path through that point does not survive
 * being flattened by the rasteriser. The *fades* are measured before clamping,
 * so the ramp keeps its true slope rather than being compressed into the
 * clamped edge.
 */
export function spanBar(span: SpanLike, toPx: (t: Days) => number, width: number): SpanBar {
  const left = toPx(span.a);
  const right = toPx(span.d);
  const inner1 = toPx(span.b);
  const inner2 = toPx(span.c);

  return {
    x1: clampPx(inner1, width),
    x2: clampPx(inner2, width),
    fadeLeft: Math.max(0, inner1 - left),
    fadeRight: Math.max(0, right - inner2),
    clippedLeft: left < 0,
    clippedRight: right > width,
  };
}

/** Total drawn width, ramps included — what decides bar against hairline. */
export function spanWidth(span: SpanLike, toPx: (t: Days) => number): number {
  return toPx(span.d) - toPx(span.a);
}

function clampPx(x: number, width: number): number {
  return Math.min(width * 2, Math.max(-width, x));
}

/** The minimum a drawn thing has to expose for a hit test to consider it. */
export interface Pickable {
  left: number;
  right: number;
  /** How visible it is. A shape faded out is not a target.  */
  alpha: number;
}

/**
 * What is drawn under `x`, among things laid out along one axis.
 *
 * Against the **span**, not the distance to a midpoint: `1914–1918` is drawn as
 * a bar four years wide, and asking the user to click its mean because that is
 * where a hairline used to be would be a hit target that disagrees with the
 * picture.
 *
 * Two rules beyond that. Tolerance scales with alpha, so a shape still
 * dissolved into the mass is not a target — clicking empty-looking canvas used
 * to select whatever invisible event happened to be nearest. And where several
 * spans contain the point, the **narrowest** wins: it is the more specific
 * claim, and a wide one that loses here is still reachable everywhere else
 * along its length.
 */
export function pickSpan<T extends Pickable>(
  items: readonly T[],
  x: number,
  tolerance: number,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;

  for (const item of items) {
    const reach = tolerance * item.alpha;
    if (reach < 1) continue;
    if (x < item.left - reach || x > item.right + reach) continue;

    const distance = x < item.left ? item.left - x : x > item.right ? x - item.right : 0;
    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        best !== null &&
        item.right - item.left < best.right - best.left)
    ) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

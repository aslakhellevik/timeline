/**
 * The knowledge density (docs/design.md §3) — the estimator behind the timeline's
 * headline view.
 *
 * ## What it computes
 *
 *     ρ(t) = Σᵢ (fᵢ * K_h)(t)
 *
 * Every event carries unit mass spread over its own temporal claim `fᵢ` — the
 * trapezoid `(a,b,c,d)` — convolved with a Gaussian whose bandwidth is measured
 * in **screen space**, `h = β · Δt_px`. That last point is the one that matters:
 * because the bandwidth shrinks as you zoom, mass genuinely resolves into
 * structure instead of the same curve being stretched, and a vague event stays
 * smeared at every zoom while a precise one sharpens to a spike.
 *
 * ## How it computes it
 *
 * Not by evaluating a closed form per event per pixel — that is O(n · support)
 * and misses the frame budget by an order of magnitude at 50k events. Instead:
 *
 *   1. Rasterise the *sum of the raw trapezoids* onto a sub-pixel grid. A
 *      trapezoid is piecewise linear, so it is fully described by four
 *      slope-changes (or two jumps, when an edge is vertical). Depositing those
 *      is O(1) per event; a double prefix sum turns the whole array back into the
 *      summed density in one pass.
 *   2. Convolve that grid **once** with the kernel.
 *
 * Total O(n + W). It is also more faithful than the per-event closed form the
 * design sketched, which approximated each trapezoid by a moment-matched
 * Gaussian: here the shapes are exact and only the kernel is approximated.
 *
 * A consequence worth stating, since `sigma` is derived from `(a,b,c,d)` rather
 * than independent of it: the event's own spread enters through its rasterised
 * shape and *only* there. Adding σ into the kernel as well would double-count it.
 */

import type { Days, TimeSpec, Viewport } from '../model/types';
import { gaussianBlur } from './blur';
import {
  DEFAULT_BETA,
  DEFAULT_LAMBDA_REF,
  DEFAULT_MASS_EXPONENT,
  DEFAULT_SUPERSAMPLE,
  type DensityOptions,
  type DensityResult,
} from './shared';

export type { DensityOptions, DensityResult } from './shared';
export { DEFAULT_BETA, DEFAULT_LAMBDA_REF, DEFAULT_MASS_EXPONENT } from './shared';
export { densityAt, computeDensityReference, specDensityAt } from './reference';
export { normalCdf, normalPdf, psi } from './normal';

/**
 * Deposits `value` at a fractional cell index, split linearly across the two
 * neighbouring cells.
 *
 * Positions left of the grid are clamped to cell 0 rather than dropped: these
 * arrays are prefix-summed, so a slope change or step that happened before the
 * window still governs everything inside it. Dropping them would silently erase
 * every event that begins off-screen to the left.
 */
function deposit(arr: Float64Array, pos: number, value: number): void {
  const n = arr.length;
  if (pos >= n) return;
  if (pos <= 0) {
    arr[0] = (arr[0] as number) + value;
    return;
  }
  const i = Math.floor(pos);
  const frac = pos - i;
  arr[i] = (arr[i] as number) + value * (1 - frac);
  if (i + 1 < n) arr[i + 1] = (arr[i + 1] as number) + value * frac;
}

/** Height of the unit-mass trapezoid at cell `u`. */
function trapezoidAt(u: number, a: number, b: number, c: number, d: number, height: number): number {
  if (u <= a || u >= d) return 0;
  if (u < b) return (height * (u - a)) / (b - a);
  if (u <= c) return height;
  return (height * (d - u)) / (d - c);
}

/**
 * Below this width, in grid cells, an event is deposited as a point mass. A shape
 * narrower than one cell *is* a point at this resolution, and trying to rasterise
 * it as a shape produces a spike of height 1/width that the grid cannot represent —
 * mass would be badly wrong rather than merely imprecise. The kernel supplies the
 * visible width in either case, so the crossover is not noticeable.
 */
const MIN_SHAPE_CELLS = 1;

const EDGE_EPSILON = 1e-9;

export function computeDensity(
  specs: readonly TimeSpec[],
  viewport: Viewport,
  options?: DensityOptions,
): DensityResult {
  const width = Math.max(1, Math.round(viewport.width));
  const beta = options?.beta ?? DEFAULT_BETA;
  const supersample = Math.max(1, Math.round(options?.supersample ?? DEFAULT_SUPERSAMPLE));

  const dt = (viewport.end - viewport.start) / width;
  const lambda = new Float64Array(width);

  if (!(dt > 0) || specs.length === 0) {
    return { lambda, lambdaMax: 0, total: 0 };
  }

  const project = options?.toPixel;

  // Pad by the kernel's reach so nothing just outside the window is lost, and so
  // the zero boundary in the blur never bites inside the visible span.
  const padPx = Math.ceil(4 * beta) + 1;
  const cells = (width + 2 * padPx) * supersample;

  const jumps = new Float64Array(cells);
  const slopeChanges = new Float64Array(cells);
  const points = new Float64Array(cells);

  // The one place time meets pixels. A nonlinear axis composes here and nowhere
  // else — see `DensityOptions.toPixel` for why that is enough.
  const toCell = project
    ? (t: Days) => (project(t) + padPx) * supersample
    : (t: Days) => ((t - viewport.start) / dt + padPx) * supersample;

  for (const spec of specs) {
    // A single non-finite bound would prefix-sum into NaN across the whole grid
    // and blank the view. The store rejects such a spec on the way in
    // (`isWellFormedSpec`); this is the backstop, and it costs two comparisons.
    if (!Number.isFinite(spec.a) || !Number.isFinite(spec.d)) continue;

    const a = toCell(spec.a);
    const d = toCell(spec.d);
    if (d <= 0 || a >= cells) continue;

    const b = toCell(spec.b);
    const c = toCell(spec.c);

    const denom = d - a + (c - b);
    if (!(denom > 0) || d - a < MIN_SHAPE_CELLS) {
      deposit(points, (a + d) / 2, 1);
      continue;
    }

    const height = 2 / denom;

    // Entering the grid mid-shape: seed the height already reached at cell 0.
    //
    // The seed subsumes a vertical left edge, so that jump must not also be
    // deposited — clamping it to cell 0 as well would count the step twice, and
    // a long interval straddling the window would carry double its mass. Slope
    // changes are a different matter: they are still clamped in, because they
    // set the *slope* from cell 0 onwards, which the seeded value does not.
    const clipped = a < 0;
    if (clipped) {
      const seeded = trapezoidAt(0, a, b, c, d, height);
      if (seeded > 0) jumps[0] = (jumps[0] as number) + seeded;
    }

    if (b - a < EDGE_EPSILON) {
      if (!clipped) deposit(jumps, a, height);
    } else {
      const slope = height / (b - a);
      deposit(slopeChanges, a, slope);
      deposit(slopeChanges, b, -slope);
    }

    if (d - c < EDGE_EPSILON) {
      deposit(jumps, d, -height);
    } else {
      const slope = height / (d - c);
      deposit(slopeChanges, c, -slope);
      deposit(slopeChanges, d, slope);
    }
  }

  // Double prefix sum: slope changes integrate to slopes, slopes to the curve.
  // The half-step correction makes the discrete sum the midpoint rule, which
  // conserves mass exactly rather than overshooting by half a cell per ramp.
  const grid = new Float64Array(cells);
  let slope = 0;
  let value = 0;
  for (let i = 0; i < cells; i++) {
    const change = slopeChanges[i] as number;
    slope += change;
    value += (jumps[i] as number) + slope - 0.5 * change;
    grid[i] = value + (points[i] as number);
  }

  gaussianBlur(grid, beta * supersample);

  // Down to one value per pixel column. Cells hold mass, so summing is correct.
  const offset = padPx * supersample;
  let lambdaMax = 0;
  let total = 0;
  for (let px = 0; px < width; px++) {
    let sum = 0;
    const base = offset + px * supersample;
    for (let s = 0; s < supersample; s++) sum += grid[base + s] as number;
    lambda[px] = sum;
    if (sum > lambdaMax) lambdaMax = sum;
    total += sum;
  }

  return { lambda, lambdaMax, total };
}

/**
 * Mass height as a fraction of the available space (§3.4).
 *
 * The compression is doing real work: it keeps a lone event visible without
 * letting the Second World War flatten everything else into the baseline. See
 * `DEFAULT_MASS_EXPONENT` for why it is a cube root rather than the square root
 * the design first assumed. The scale is fixed rather than ranged to the
 * viewport, so a sparse stretch of history honestly looks sparse — which is the
 * property the whole far view exists to show.
 */
export function heightFraction(
  lambda: number,
  lambdaRef: number = DEFAULT_LAMBDA_REF,
  exponent: number = DEFAULT_MASS_EXPONENT,
): number {
  if (!(lambda > 0) || !(lambdaRef > 0)) return 0;
  return Math.min(1, Math.pow(lambda / lambdaRef, exponent));
}

/**
 * Width the corpus is measured at when calibrating. Arbitrary: the result is a
 * rate, and `calibrateRate` divides the width back out again.
 */
const CALIBRATION_WIDTH = 1600;

/**
 * Headroom over the corpus peak, so the tallest hill does not sit flush against
 * the top of the frame — or, worse, get clipped flat across it.
 */
export const MASS_HEADROOM = 1.3;

/**
 * The corpus peak, as **events per day** rather than events per pixel (§3.4).
 *
 * A rate is a property of the data. λ is not: it counts events in a *pixel
 * column*, so it scales with `span / width` and a λ calibrated at one canvas
 * width is simply wrong at another. Measured on the 800-event corpus, a λ_ref
 * fixed at 1600 px left eleven columns saturated at 1100 px and seventeen at
 * 390 px — two different centuries drawn at exactly the same height, which is
 * the one thing the far view promises never happens.
 */
export function calibrateRate(
  specs: readonly TimeSpec[],
  extent: { start: Days; end: Days },
): number {
  const span = extent.end - extent.start;
  if (!(span > 0) || specs.length === 0) return 0;

  const { lambdaMax } = computeDensity(specs, { ...extent, width: CALIBRATION_WIDTH });
  return (lambdaMax * CALIBRATION_WIDTH) / span;
}

/**
 * The λ that counts as full height, for a canvas of `width` showing a corpus
 * spanning `span` days.
 *
 * Derived per frame from the rate, which is what makes the drawing honest at
 * every canvas size. `span` is the **corpus** extent, not the viewport: §3.4's
 * scale is fixed with respect to the viewport, so panning and zooming shrink
 * the hills rather than re-ranging under them, and a sparse stretch of history
 * honestly looks sparse.
 */
export function lambdaRefFor(
  rateRef: number,
  span: number,
  width: number,
  headroom: number = MASS_HEADROOM,
): number {
  if (!(rateRef > 0) || !(span > 0) || !(width > 0)) return DEFAULT_LAMBDA_REF;
  return (rateRef * span * headroom) / width;
}

/**
 * Opacity of the far (mass) view during the semantic-zoom crossfade (§3.4).
 *
 * Driven by the same λ as the height, so there is one scalar governing the whole
 * transition and no zoom thresholds to tune. Individual marks fade in as this
 * fades out: above one event per pixel there is nothing to draw individually,
 * below a quarter there is no mass worth drawing.
 *
 * Both canvas renderers feed it a **local** λ — per row in the depth view, per
 * column in the flat one (D35, D50). One number for the whole frame is a
 * different claim, and a false one: it says the frame is dense because its
 * busiest column is, so a lone event in 400 BC stays dissolved for as long as
 * the twentieth century is on screen with it.
 */
export function farViewOpacity(lambdaMax: number): number {
  const lo = 0.25;
  const hi = 1;
  if (lambdaMax >= hi) return 1;
  if (lambdaMax <= lo) return 0;
  const u = (lambdaMax - lo) / (hi - lo);
  return u * u * (3 - 2 * u);
}

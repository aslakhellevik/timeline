/**
 * The obviously-correct estimator: evaluate every event's exact contribution at
 * every pixel centre. O(n · width), far too slow to render with, and it exists
 * only so the fast path in `index.ts` has something to be checked against.
 *
 * ## The closed form
 *
 * A `TimeSpec` is a trapezoid with support [a,d] and plateau [b,c]. Write the
 * ramp `r_{p,q}` — 0 below p, rising linearly to 1 at q, 1 above — and the
 * trapezoid is
 *
 *     f(t) = H · [ r_{a,b}(t) − r_{c,d}(t) ],     H = 2 / ((d−a) + (c−b))
 *
 * which is easy to check at each of the five regions. But `r_{p,q}` is exactly
 * the CDF of Uniform(p,q), so convolving it with a Gaussian gives the
 * antiderivative of Φ:
 *
 *     (r_{p,q} * K_h)(t) = [Ψ(u) − Ψ(v)] / (u − v),   u = (t−p)/h, v = (t−q)/h
 *
 * with Ψ(x) = x·Φ(x) + φ(x). So the whole trapezoid convolved with the kernel is
 * a difference of two such terms — no numerical integration anywhere, and the
 * degenerate shapes fall out as limits rather than needing separate branches.
 */

import type { Days, TimeSpec, Viewport } from '../model/types';
import { normalCdf, psi } from './normal';
import { DEFAULT_BETA, type DensityResult } from './shared';

/**
 * One smoothed ramp. As `q → p` the ratio tends to Φ(u), so a vertical edge is
 * the limit of the same expression rather than a special case.
 *
 * Below the threshold the difference quotient is replaced by its central-
 * difference equivalent Φ((u+v)/2): the exact form would be subtracting two
 * nearly-equal values and dividing by a tiny one, which loses most of the
 * available precision exactly where day-granularity events live.
 */
function smoothedRamp(t: Days, p: Days, q: Days, h: number): number {
  const u = (t - p) / h;
  const v = (t - q) / h;
  const du = u - v;
  if (Math.abs(du) < 1e-3) return normalCdf((u + v) / 2);
  return (psi(u) - psi(v)) / du;
}

/** Contribution of a single spec to the density at `t`. Integrates to 1 over all t. */
export function specDensityAt(spec: TimeSpec, t: Days, h: number): number {
  const { a, b, c, d } = spec;
  const denom = d - a + (c - b);

  // A true point has no width to normalise against; it is a bare kernel.
  if (denom <= 0) {
    const z = (t - a) / h;
    return Math.exp(-0.5 * z * z) / (h * 2.5066282746310002);
  }

  const height = 2 / denom;
  return height * (smoothedRamp(t, a, b, h) - smoothedRamp(t, c, d, h));
}

/** ρ(t): expected events per unit time. */
export function densityAt(specs: readonly TimeSpec[], t: Days, h: number): number {
  let sum = 0;
  for (const spec of specs) sum += specDensityAt(spec, t, h);
  return sum;
}

export function computeDensityReference(
  specs: readonly TimeSpec[],
  viewport: Viewport,
  options?: { beta?: number },
): DensityResult {
  const width = Math.max(1, Math.round(viewport.width));
  const dt = (viewport.end - viewport.start) / width;
  const h = (options?.beta ?? DEFAULT_BETA) * dt;

  const lambda = new Float64Array(width);
  let lambdaMax = 0;
  let total = 0;

  for (let i = 0; i < width; i++) {
    // Midpoint rule over the pixel column: ρ at the centre, times the column width.
    const value = densityAt(specs, viewport.start + (i + 0.5) * dt, h) * dt;
    lambda[i] = value;
    if (value > lambdaMax) lambdaMax = value;
    total += value;
  }

  return { lambda, lambdaMax, total };
}

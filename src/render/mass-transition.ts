/**
 * The mass redistribution animation (docs/design.md §3.5).
 *
 * Interpolating the two density grids is what makes a tag filter read as weight
 * moving rather than as one picture being swapped for another. It is `W` floats
 * and costs nothing.
 */

import type { DensityResult } from '../core/density';

/** How long a redistribution takes. */
export const TRANSITION_MS = 300;

export interface TransitionFrame {
  density: DensityResult;
  /** Another frame is needed. The caller schedules it; this class owns no timer. */
  animating: boolean;
}

export class MassTransition {
  private active: { from: Float64Array; fromMax: number; start: number; key: string } | null = null;
  /** Set when the data changes, consumed by the next frame, which has both grids. */
  private pending = false;
  /** What the last frame actually put on screen — the start point of the next blend. */
  private lastDrawn: Float64Array | null = null;
  private lastDrawnMax = 0;

  constructor(private readonly duration: number = TRANSITION_MS) {}

  /** Call when the drawn data changes. Harmless before anything has been drawn. */
  begin(): void {
    this.pending = this.lastDrawn !== null;
  }

  /** Drop any animation in flight — used when the data is replaced wholesale. */
  reset(): void {
    this.active = null;
    this.pending = false;
    this.lastDrawn = null;
    this.lastDrawnMax = 0;
  }

  /**
   * The grid to draw this frame: the target, or a blend towards it.
   *
   * `key` identifies the window the grids describe. A pan or zoom changes it,
   * and the transition is abandoned — the two grids then describe different
   * windows and there is nothing meaningful to interpolate.
   */
  resolve(target: DensityResult, key: string, now: number): TransitionFrame {
    if (this.pending) {
      this.pending = false;
      // Always from the grid the last frame actually put on screen. Mid-flight
      // that is a partly-faded picture, and starting the new blend anywhere else
      // makes a second filter change within the animation snap before it moves —
      // which is worse than not animating at all.
      const from = this.lastDrawn;
      this.active =
        from && from.length === target.lambda.length
          ? { from, fromMax: this.lastDrawnMax, start: now, key }
          : null;
    }

    const active = this.active;
    if (!active || active.key !== key) {
      this.active = null;
      return this.settle(target);
    }

    const t = eased((now - active.start) / this.duration);
    if (t >= 1) {
      this.active = null;
      return this.settle(target);
    }

    const lambda = blend(active.from, target.lambda, t);
    const lambdaMax = active.fromMax + (target.lambdaMax - active.fromMax) * t;
    this.lastDrawn = lambda;
    this.lastDrawnMax = lambdaMax;
    return { density: { ...target, lambda, lambdaMax }, animating: true };
  }

  private settle(target: DensityResult): TransitionFrame {
    this.lastDrawn = target.lambda;
    this.lastDrawnMax = target.lambdaMax;
    return { density: target, animating: false };
  }
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Ease-in-out on the transition clock.
 *
 * Linear interpolation between two density grids reads as a mechanical wipe;
 * easing the ends makes the same arithmetic read as weight settling.
 */
export function eased(t: number): number {
  const u = clamp01(t);
  return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
}

/** Linear blend of two density grids of equal length. */
export function blend(from: Float64Array, to: Float64Array, t: number): Float64Array {
  const out = new Float64Array(from.length);
  for (let i = 0; i < out.length; i++) {
    const a = from[i] as number;
    out[i] = a + ((to[i] as number) - a) * t;
  }
  return out;
}

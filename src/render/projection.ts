/**
 * The perspective projection behind the depth view (docs/design.md §6.7).
 *
 * Time runs *into* the screen instead of across it: now is at your feet, the
 * past recedes to a horizon. Pure geometry, no canvas — the renderer draws what
 * this computes, and every number here is testable without a browser.
 *
 * D12 anticipated this. The scale function was made pluggable because "a
 * log-time axis anchored at now, and a density-equalised axis" were both
 * plausible later; a perspective axis is the same kind of change, and it happens
 * to be a principled version of the second one. Screen space is allocated as
 * `1/z`, which is roughly how a personal corpus thins out with age — most of
 * what anyone knows is recent, and near means large means room for it.
 *
 * **The viewport stays one-dimensional.** This is a projection, not a camera:
 * the window on time is still `(start, end)`, so pan, zoom, the URL state and
 * the pan bounds all keep working untouched. That is the single biggest cost
 * this design avoids.
 */

import type { Days, Viewport } from '../core/model/types';

export interface DepthGeometry {
  width: number;
  height: number;
  /** Where `z → ∞`. Nothing is ever drawn above it. */
  horizonY: number;
  /** Where `z = 1` — the near plane, at your feet. */
  groundY: number;
  centreX: number;
  /** Half-width of the corridor at the near plane, in pixels. */
  halfWidth: number;
  /**
   * Depth at the far edge of the window.
   *
   * The compression ratio across the view, near to far. Nine is enough to read
   * as depth without crushing the far end into unusable slivers; much more and
   * the oldest third of the window becomes a smudge at the horizon.
   */
  zFar: number;
}

export const DEFAULT_Z_FAR = 9;

/**
 * A projection bound to one viewport and one canvas geometry.
 *
 * Rebuilt each frame — it is a handful of divisions, and holding one across a
 * viewport change is how a hit target drifts away from what is on screen.
 */
export class DepthProjection {
  private readonly start: Days;
  private readonly span: Days;
  private readonly depth: number;
  private readonly nearY: number;

  constructor(
    readonly viewport: Viewport,
    readonly geometry: DepthGeometry,
  ) {
    this.start = viewport.start;
    this.span = viewport.end - viewport.start || 1;
    this.depth = geometry.groundY - geometry.horizonY;
    this.nearY = geometry.groundY;
  }

  /**
   * Depth at time `t`. The newest edge of the window sits at `z = 1`, the oldest
   * at `zFar`, linearly in time — so zooming and panning behave exactly as they
   * do in the flat view, and only the mapping to pixels is curved.
   */
  zAt(t: Days): number {
    const u = (t - this.start) / this.span;
    return 1 + (1 - u) * (this.geometry.zFar - 1);
  }

  /** On-screen scale at time `t`: 1 at the near plane, `1/zFar` at the far one. */
  scaleAt(t: Days): number {
    const z = this.zAt(t);
    // Behind the eye, or beyond it: clamped rather than allowed to go negative,
    // which would fold the corridor back on itself.
    return z > 0.05 ? 1 / z : 20;
  }

  /** Screen y of the corridor's centre line at time `t`. */
  yAt(t: Days): number {
    return this.geometry.horizonY + this.scaleAt(t) * this.depth;
  }

  /** Screen x at time `t`, `lateral` measured in half-widths from the centre. */
  xAt(t: Days, lateral: number): number {
    return this.geometry.centreX + this.scaleAt(t) * lateral * this.geometry.halfWidth;
  }

  /** Inverse of `yAt`. Closed form — `1/z` inverts cleanly, which is why it was chosen. */
  timeAtY(y: number): Days {
    const s = (y - this.geometry.horizonY) / this.depth;
    if (!(s > 0)) return this.start;
    const z = 1 / s;
    const u = 1 - (z - 1) / (this.geometry.zFar - 1);
    return this.start + u * this.span;
  }

  /**
   * Position along the corridor in pixels, measured from the far edge of the
   * window. This is the coordinate the density grid is built in.
   */
  pixelAt(t: Days): number {
    return this.yAt(t) - this.yAt(this.start);
  }

  /** How many pixel rows the window occupies on screen. */
  get depthPixels(): number {
    return Math.max(1, Math.round(this.nearY - this.yAt(this.start)));
  }

  /** Time at a row of the density grid. */
  timeAtPixel(pixel: number): Days {
    return this.timeAtY(this.yAt(this.start) + pixel);
  }

  /**
   * Rows per unit time at `t` — the local stretch of the projection.
   *
   * Needed to turn the grid's events-per-row into events-per-year. The two
   * differ by a factor of `z²` here, which is not a detail: without the
   * conversion a compressed stretch of antiquity would render as wide as a
   * genuinely dense one, and the view would claim the opposite of the truth.
   *
   * `y = horizon + depth/z` and `dz/dt = -(zFar - 1)/span`, so
   * `dy/dt = depth · (zFar - 1) / (span · z²)`.
   */
  rowsPerTime(t: Days): number {
    const z = this.zAt(t);
    if (!(z > 0.05)) return 0;
    return (this.depth * (this.geometry.zFar - 1)) / (this.span * z * z);
  }
}

/**
 * Geometry for a canvas of the given size.
 *
 * The horizon sits above the middle, so the near half of the corridor — where
 * almost everything a personal timeline holds actually is — gets most of the
 * screen.
 */
export function depthGeometry(
  width: number,
  height: number,
  zFar: number = DEFAULT_Z_FAR,
): DepthGeometry {
  return {
    width,
    height,
    horizonY: Math.round(height * 0.22),
    groundY: height - 28,
    centreX: width / 2,
    // Wide enough for the river and its era lanes without the near plane
    // running off the sides.
    halfWidth: Math.min(width * 0.42, 620),
    zFar,
  };
}

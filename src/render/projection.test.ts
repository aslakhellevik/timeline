import { describe, expect, it } from 'vitest';
import type { Viewport } from '../core/model/types';
import { computeDensity } from '../core/density';
import { interval } from '../core/time';
import { DEFAULT_Z_FAR, DepthProjection, depthGeometry } from './projection';

const VIEWPORT: Viewport = { start: 0, end: 1000, width: 1200 };
const GEOMETRY = depthGeometry(1200, 800);
const project = () => new DepthProjection(VIEWPORT, GEOMETRY);

describe('depth', () => {
  it('puts the newest edge at the near plane and the oldest at zFar', () => {
    const p = project();
    expect(p.zAt(1000)).toBeCloseTo(1);
    expect(p.zAt(0)).toBeCloseTo(DEFAULT_Z_FAR);
    expect(p.scaleAt(1000)).toBeCloseTo(1);
    expect(p.scaleAt(0)).toBeCloseTo(1 / DEFAULT_Z_FAR);
  });

  it('recedes monotonically, and never reaches the horizon', () => {
    // Later time is nearer, so further down the screen. Nothing ever reaches the
    // horizon, because 1/z only approaches zero.
    const p = project();
    let previous = -Infinity;
    for (let t = 0; t <= 1000; t += 25) {
      const y = p.yAt(t);
      expect(y).toBeGreaterThan(GEOMETRY.horizonY);
      expect(y).toBeGreaterThan(previous);
      previous = y;
    }
    expect(p.yAt(1000)).toBeCloseTo(GEOMETRY.groundY);
  });

  it('compresses the far half far more than the near half', () => {
    // The whole point: screen space is allocated as 1/z, so recent time — where
    // a personal corpus actually is — gets most of the room.
    const p = project();
    const nearHalf = p.yAt(1000) - p.yAt(500);
    const farHalf = p.yAt(500) - p.yAt(0);
    expect(nearHalf / farHalf).toBeGreaterThan(4);
  });

  it('narrows the corridor into the distance', () => {
    const p = project();
    const near = p.xAt(1000, 1) - p.xAt(1000, -1);
    const far = p.xAt(0, 1) - p.xAt(0, -1);
    expect(far).toBeCloseTo(near / DEFAULT_Z_FAR);
  });

  it('inverts exactly', () => {
    const p = project();
    for (const t of [0, 1, 137, 500, 999, 1000]) {
      expect(p.timeAtY(p.yAt(t))).toBeCloseTo(t, 6);
    }
  });

  it('maps the window onto its pixel rows, far edge first', () => {
    const p = project();
    expect(p.pixelAt(0)).toBeCloseTo(0);
    expect(p.pixelAt(1000)).toBeCloseTo(p.depthPixels, 0);
    expect(p.timeAtPixel(0)).toBeCloseTo(0, 6);
  });

  it('survives a degenerate viewport without folding the corridor', () => {
    const p = new DepthProjection({ start: 5, end: 5, width: 1200 }, GEOMETRY);
    expect(Number.isFinite(p.yAt(5))).toBe(true);
    expect(Number.isFinite(p.scaleAt(5))).toBe(true);
    expect(p.depthPixels).toBeGreaterThan(0);
  });

  it('clamps rather than folding for times outside the window', () => {
    const p = project();
    // Far beyond the far plane the depth would pass through zero and the
    // corridor would turn inside out.
    expect(Number.isFinite(p.scaleAt(-100000))).toBe(true);
    expect(p.scaleAt(-100000)).toBeGreaterThan(0);
  });
});

describe('rowsPerTime', () => {
  /** The analytic derivative has to match the projection it claims to describe. */
  it('matches a numerical derivative of yAt', () => {
    const p = project();
    for (const t of [10, 250, 500, 750, 990]) {
      const h = 0.01;
      const numeric = (p.yAt(t + h) - p.yAt(t - h)) / (2 * h);
      expect(p.rowsPerTime(t)).toBeCloseTo(numeric, 4);
    }
  });

  it('is much larger near than far, by roughly z squared', () => {
    const p = project();
    const ratio = p.rowsPerTime(1000) / p.rowsPerTime(0);
    expect(ratio).toBeCloseTo(DEFAULT_Z_FAR ** 2, 0);
  });
});

describe('density under the projection', () => {
  // Days, not years, and a window that holds every one of them — the point being
  // measured is what the warp does to the mass, not what clipping does.
  const specs = Array.from({ length: 400 }, (_, i) => interval(i * 100, i * 100));
  const flat: Viewport = { start: -2_000, end: 42_000, width: 900 };

  /**
   * The property that makes the whole depth view possible: warping the axis
   * changes where mass lands, never how much there is.
   */
  it('conserves mass under an arbitrary monotone warp', () => {
    const linear = computeDensity(specs, flat);
    const span = flat.end - flat.start;
    const warped = computeDensity(specs, flat, {
      // A strong, smooth, monotone squash — harsher than the real projection.
      toPixel: (t) => Math.sqrt((t - flat.start) / span) * flat.width,
    });

    expect(linear.total).toBeCloseTo(specs.length, 0);
    expect(warped.total).toBeCloseTo(linear.total, 3);
  });

  it('conserves mass under the real perspective projection', () => {
    // Placed in the near half, where there is pixel room on both sides. At the
    // far edge the projection compresses so hard that an event's blurred support
    // runs off the end of the grid, and the mass that leaves is genuinely gone —
    // the same clipping the flat view does, just arriving much sooner.
    const near = Array.from({ length: 200 }, (_, i) => interval(20_000 + i * 95, 20_000 + i * 95));
    const p = new DepthProjection(flat, depthGeometry(1200, 800));
    const warped = computeDensity(near, { ...flat, width: p.depthPixels }, {
      toPixel: (t) => p.pixelAt(t),
    });
    expect(warped.total).toBeCloseTo(near.length, 0);
  });

  it('piles the same events into fewer rows where the axis compresses', () => {
    const p = new DepthProjection(flat, depthGeometry(1200, 800));
    const warped = computeDensity(specs, { ...flat, width: p.depthPixels }, {
      toPixel: (t) => p.pixelAt(t),
    });
    const linear = computeDensity(specs, { ...flat, width: p.depthPixels });

    // Events spread evenly in time occupy a shorter, taller stretch of the far
    // end once the axis is warped — which is exactly why the renderer converts
    // rows back to a rate before drawing anything.
    expect(warped.lambdaMax).toBeGreaterThan(linear.lambdaMax * 1.5);
  });

  it('leaves the linear path untouched when no mapping is given', () => {
    // The flat view must be bit-for-bit unaffected by the depth view existing.
    const a = computeDensity(specs, flat);
    const b = computeDensity(specs, flat, { beta: 5 });
    expect([...b.lambda]).toEqual([...a.lambda]);
  });

  it('handles intervals as well as instants under a warp', () => {
    const spans = Array.from({ length: 50 }, (_, i) =>
      interval(20_000 + i * 300, 20_000 + i * 300 + 200),
    );
    const span = flat.end - flat.start;
    const warped = computeDensity(spans, flat, {
      toPixel: (t) => Math.sqrt(Math.max(0, (t - flat.start) / span)) * flat.width,
    });
    expect(warped.total).toBeCloseTo(spans.length, 0);
  });
});

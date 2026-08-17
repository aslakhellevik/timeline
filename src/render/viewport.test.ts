import { describe, expect, it } from 'vitest';
import { linearScale, timePerPixel } from './scale';
import {
  DEFAULT_ZOOM_LIMITS,
  centre,
  clamp,
  fitTo,
  interpolate,
  panByPx,
  resize,
  span,
  zoomAt,
} from './viewport';
import type { TimeBounds } from './viewport';
import type { Viewport } from '../core/model/types';

const YEAR = 365.2425;
const bounds: TimeBounds = { min: -6000 * YEAR, max: 20_000 };
const vp = (start: number, end: number, width = 1000): Viewport => ({ start, end, width });

describe('linearScale', () => {
  it('maps the window onto the width', () => {
    const v = vp(0, 1000, 500);
    expect(linearScale.toPx(0, v)).toBe(0);
    expect(linearScale.toPx(1000, v)).toBe(500);
    expect(linearScale.toPx(500, v)).toBe(250);
  });

  it('inverts exactly', () => {
    const v = vp(-1_000_000, 25_000, 1440);
    for (const px of [0, 1, 137, 720, 1439, 1440]) {
      expect(linearScale.toPx(linearScale.toTime(px, v), v)).toBeCloseTo(px, 9);
    }
  });

  it('reports time per pixel', () => {
    expect(timePerPixel(vp(0, 2000, 1000))).toBe(2);
  });
});

describe('zoomAt', () => {
  it('pins the time under the anchor pixel', () => {
    const before = vp(0, 1000);
    const anchorPx = 250;
    const anchorTime = linearScale.toTime(anchorPx, before);

    const after = zoomAt(before, anchorPx, 0.5, bounds);

    expect(linearScale.toTime(anchorPx, after)).toBeCloseTo(anchorTime, 6);
    expect(span(after)).toBeCloseTo(500, 6);
  });

  it('pins correctly at both edges', () => {
    const before = vp(0, 1000);
    for (const anchorPx of [0, 1000]) {
      const t = linearScale.toTime(anchorPx, before);
      const after = zoomAt(before, anchorPx, 0.25, bounds);
      expect(linearScale.toTime(anchorPx, after)).toBeCloseTo(t, 6);
    }
  });

  it('round-trips zoom in and out', () => {
    const before = vp(0, 1000);
    const there = zoomAt(before, 300, 0.5, bounds);
    const back = zoomAt(there, 300, 2, bounds);
    expect(back.start).toBeCloseTo(before.start, 6);
    expect(back.end).toBeCloseTo(before.end, 6);
  });

  it('refuses to zoom in past the minimum span', () => {
    let v = vp(0, 1000);
    for (let i = 0; i < 40; i++) v = zoomAt(v, 500, 0.5, bounds);
    expect(span(v)).toBeCloseTo(DEFAULT_ZOOM_LIMITS.minSpan, 6);
  });

  it('refuses to zoom out past the bounds', () => {
    let v = vp(0, 1000);
    for (let i = 0; i < 60; i++) v = zoomAt(v, 500, 2, bounds);
    expect(span(v)).toBeLessThanOrEqual(bounds.max - bounds.min + 1e-6);
    expect(v.start).toBeGreaterThanOrEqual(bounds.min - 1e-6);
    expect(v.end).toBeLessThanOrEqual(bounds.max + 1e-6);
  });
});

describe('clamp', () => {
  it('slides a window back inside the bounds without changing its span', () => {
    const wanted = 1000;
    const clamped = clamp(vp(bounds.min - 5000, bounds.min - 5000 + wanted), bounds);
    expect(span(clamped)).toBeCloseTo(wanted, 6);
    expect(clamped.start).toBeCloseTo(bounds.min, 6);
  });

  it('centres a window wider than the bounds rather than pinning it to an edge', () => {
    const clamped = clamp(vp(bounds.min - 1e9, bounds.max + 1e9), bounds);
    expect(clamped.start).toBeCloseTo(bounds.min, 6);
    expect(clamped.end).toBeCloseTo(bounds.max, 6);
  });

  it('preserves the centre when only the span is clamped', () => {
    const v = vp(-100, 100);
    const clamped = clamp(v, bounds, { minSpan: 50, maxSpan: 1e9 });
    expect(centre(clamped)).toBeCloseTo(0, 6);
    expect(span(clamped)).toBeCloseTo(200, 6);
  });
});

describe('panByPx', () => {
  it('moves forwards in time for a positive delta', () => {
    const after = panByPx(vp(0, 1000), 100, bounds);
    expect(after.start).toBeCloseTo(100, 6);
    expect(after.end).toBeCloseTo(1100, 6);
  });

  it('stops at the bounds', () => {
    const after = panByPx(vp(bounds.max - 1000, bounds.max), 5000, bounds);
    expect(after.end).toBeCloseTo(bounds.max, 6);
    expect(span(after)).toBeCloseTo(1000, 6);
  });
});

describe('fitTo and resize', () => {
  it('frames a range with padding', () => {
    const v = fitTo(0, 1000, 800, bounds, 0.1);
    expect(v.start).toBeCloseTo(-100, 6);
    expect(v.end).toBeCloseTo(1100, 6);
    expect(v.width).toBe(800);
  });

  it('keeps the time window when the width changes', () => {
    const v = resize(vp(10, 20, 100), 640);
    expect(v.start).toBe(10);
    expect(v.end).toBe(20);
    expect(v.width).toBe(640);
  });
});

describe('interpolate', () => {
  it('hits both endpoints', () => {
    const a = vp(0, 100);
    const b = vp(500, 700);
    expect(span(interpolate(a, b, 0))).toBeCloseTo(span(a), 6);
    expect(centre(interpolate(a, b, 1))).toBeCloseTo(centre(b), 6);
  });

  it('changes span geometrically, so halfway is the geometric mean', () => {
    const a = vp(0, 100);
    const b = vp(0, 10_000);
    expect(span(interpolate(a, b, 0.5))).toBeCloseTo(1000, 6);
  });
});

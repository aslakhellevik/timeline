import { describe, expect, it } from 'vitest';
import { linearScale, timePerPixel } from './scale';
import {
  DEFAULT_ZOOM_LIMITS,
  centre,
  clamp,
  fitTo,
  frameBounds,
  interpolate,
  panByPx,
  resize,
  revealWindow,
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

describe('frameBounds', () => {
  it('leaves a little slack at each end', () => {
    const b = frameBounds({ start: 0, end: 1000 });
    expect(b.min).toBeCloseTo(-20, 6);
    expect(b.max).toBeCloseTo(1020, 6);
  });

  it('never collapses to a point, however narrow the frame', () => {
    const b = frameBounds({ start: 5, end: 5 });
    expect(b.max - b.min).toBeGreaterThanOrEqual(2);
  });
});

describe('revealWindow', () => {
  const wide: TimeBounds = { min: -3000 * YEAR, max: 60 * YEAR };
  /** An instant in the middle of the corpus. */
  const t = 0;

  it('does nothing when the target is comfortably framed at a sensible zoom', () => {
    expect(revealWindow(vp(-10 * YEAR, 10 * YEAR), t, t, wide)).toBeNull();
  });

  it('acts when the target sits at the very edge of the window', () => {
    const window = revealWindow(vp(t - 20 * YEAR, t + 0.3 * YEAR), t, t, wide);
    expect(window).not.toBeNull();
  });

  /**
   * The bug the whole thing exists for: fitted to the corpus the selected event
   * *is* in the window, and is a hairline among eight hundred others.
   */
  it('zooms in when the window is far wider than the period being revealed', () => {
    const window = revealWindow(vp(-3000 * YEAR, 50 * YEAR), t, t, wide);
    expect(window).not.toBeNull();
    expect(span(window!)).toBeCloseTo(40 * YEAR, 3);
    expect(centre(window!)).toBeCloseTo(t, 3);
  });

  it('pans without zooming when the span already shows the target', () => {
    const from = vp(-30 * YEAR, -10 * YEAR);
    const window = revealWindow(from, t, t, wide);
    expect(window).not.toBeNull();
    expect(span(window!)).toBeCloseTo(span(from), 6);
    expect(centre(window!)).toBeCloseTo(t, 6);
  });

  it('zooms out to hold a target longer than the window, with padding', () => {
    const window = revealWindow(vp(-5 * YEAR, 5 * YEAR), -100 * YEAR, 100 * YEAR, wide);
    expect(window).not.toBeNull();
    // 0.4 of padding at each end, which is 1.8 times the target's own length.
    expect(span(window!)).toBeCloseTo(200 * YEAR * 1.8, 3);
  });

  it('keeps the window inside the bounds, target or no target', () => {
    const window = revealWindow(vp(-3000 * YEAR, 50 * YEAR), 59 * YEAR, 59 * YEAR, wide);
    expect(window).not.toBeNull();
    expect(window!.end).toBeLessThanOrEqual(wide.max + 1e-6);
    expect(window!.start).toBeGreaterThanOrEqual(wide.min - 1e-6);
  });

  /**
   * The corridor spends half its height on the newest tenth of the window, so
   * an event centred in time is drawn at the horizon (D33, §6.7).
   */
  it('places the target where asked, for a view whose axis is not linear', () => {
    const window = revealWindow(vp(-3000 * YEAR, 50 * YEAR), t, t, wide, 0.85);
    expect(window).not.toBeNull();
    const fraction = (t - window!.start) / span(window!);
    expect(fraction).toBeCloseTo(0.85, 3);
  });

  it('holds a target near the far edge to be revealed, under that placement', () => {
    // 0.2 along the window is comfortable when centred and not when the view
    // wants its target at 0.85 — the same rule, moved with the anchor.
    const window = vp(-10 * YEAR, 10 * YEAR);
    expect(revealWindow(window, -6 * YEAR, -6 * YEAR, wide)).toBeNull();
    expect(revealWindow(window, -6 * YEAR, -6 * YEAR, wide, 0.85)).not.toBeNull();
  });
});

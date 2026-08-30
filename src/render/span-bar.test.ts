import { describe, expect, it } from 'vitest';
import { fuzzy, instant, interval } from '../core/time';
import { pickSpan, spanBar, spanWidth } from './span-bar';

/** `when` is read straight back as pixels, so these tests talk in pixels. */
const identity = (t: number) => t;

describe('spanBar', () => {
  it('draws the certain core between b and c', () => {
    const bar = spanBar(interval(100, 400), identity, 1000);
    expect(bar.x1).toBe(100);
    expect(bar.x2).toBe(400);
    expect(bar.fadeLeft).toBe(0);
    expect(bar.fadeRight).toBe(0);
  });

  it('turns a fuzzy span into ramps on the flanks', () => {
    const bar = spanBar(fuzzy(100, 200, 400, 500), identity, 1000);
    expect(bar.x1).toBe(200);
    expect(bar.x2).toBe(400);
    expect(bar.fadeLeft).toBe(100);
    expect(bar.fadeRight).toBe(100);
  });

  it('reports which end runs off the viewport', () => {
    const bar = spanBar(interval(-50, 1200), identity, 1000);
    expect(bar.clippedLeft).toBe(true);
    expect(bar.clippedRight).toBe(true);

    const inside = spanBar(interval(10, 900), identity, 1000);
    expect(inside.clippedLeft).toBe(false);
    expect(inside.clippedRight).toBe(false);
  });

  it('keeps coordinates finite for a span far outside the viewport', () => {
    // A quadratic path through a point a billion pixels away does not survive
    // being flattened by the rasteriser.
    const bar = spanBar(interval(-1e9, 1e9), identity, 1000);
    expect(Number.isFinite(bar.x1)).toBe(true);
    expect(Math.abs(bar.x1)).toBeLessThan(1e5);
    expect(Math.abs(bar.x2)).toBeLessThan(1e5);
  });

  it('measures the ramps before clamping, so their slope stays true', () => {
    const bar = spanBar(fuzzy(-4000, -3000, 500, 600), identity, 1000);
    expect(bar.fadeLeft).toBe(1000);
    expect(bar.x1).toBe(-1000);
  });
});

describe('spanWidth', () => {
  it('measures a to d, which is what decides bar against hairline', () => {
    expect(spanWidth(interval(100, 400), identity)).toBe(300);
    expect(spanWidth(fuzzy(0, 100, 200, 300), identity)).toBe(300);
    expect(spanWidth(instant(1969, 7, 20), (t) => t * 0)).toBe(0);
  });

  it('scales with the projection, so the threshold is a zoom threshold', () => {
    const spec = interval(0, 100);
    expect(spanWidth(spec, (t) => t / 10)).toBe(10);
    expect(spanWidth(spec, (t) => t * 10)).toBe(1000);
  });
});

describe('pickSpan', () => {
  const mark = (left: number, right: number, alpha = 1) => ({ left, right, alpha });

  it('hits anywhere along a span, not only at its middle', () => {
    const bar = mark(200, 400);
    for (const x of [200, 260, 340, 400]) {
      expect(pickSpan([bar], x, 7)).toBe(bar);
    }
    expect(pickSpan([bar], 150, 7)).toBeNull();
  });

  it('is forgiving by the tolerance at each end', () => {
    const bar = mark(200, 400);
    expect(pickSpan([bar], 195, 7)).toBe(bar);
    expect(pickSpan([bar], 406, 7)).toBe(bar);
    expect(pickSpan([bar], 412, 7)).toBeNull();
  });

  it('prefers the narrower claim where two spans contain the point', () => {
    // A wide fuzzy event should not swallow the precise one drawn inside it;
    // the wide one is still reachable everywhere else along its length.
    const wide = mark(0, 900);
    const narrow = mark(300, 320);
    expect(pickSpan([wide, narrow], 310, 7)).toBe(narrow);
    expect(pickSpan([narrow, wide], 310, 7)).toBe(narrow);
    expect(pickSpan([wide, narrow], 700, 7)).toBe(wide);
  });

  it('takes the nearer of two it merely comes close to', () => {
    const left = mark(100, 100);
    const right = mark(112, 112);
    expect(pickSpan([left, right], 104, 7)).toBe(left);
    expect(pickSpan([left, right], 110, 7)).toBe(right);
  });

  it('will not select something that has faded into the mass', () => {
    // Clicking empty-looking canvas used to select whatever invisible event
    // happened to be nearest.
    expect(pickSpan([mark(200, 400, 0.05)], 300, 7)).toBeNull();
    expect(pickSpan([mark(200, 400, 0)], 300, 7)).toBeNull();
    expect(pickSpan([mark(200, 400, 0.5)], 300, 7)?.alpha).toBe(0.5);
  });
});

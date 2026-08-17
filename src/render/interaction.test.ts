import { describe, expect, it } from 'vitest';
import { wheelZoomFactor } from './interaction';

describe('wheelZoomFactor', () => {
  it('zooms out for a downward scroll and in for an upward one', () => {
    expect(wheelZoomFactor(100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-100, 0)).toBeLessThan(1);
  });

  it('is exactly reciprocal, so a scroll and its inverse cancel', () => {
    expect(wheelZoomFactor(80, 0) * wheelZoomFactor(-80, 0)).toBeCloseTo(1, 12);
  });

  it('is neutral on zero delta', () => {
    expect(wheelZoomFactor(0, 0)).toBe(1);
  });

  it('normalises line and page deltas against pixel deltas', () => {
    // One mouse notch (3 lines) should move much further than 3 trackpad pixels.
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48, 0), 12);
    expect(wheelZoomFactor(1, 2)).toBeCloseTo(wheelZoomFactor(400, 0), 12);
  });

  it('clamps a violent flick to a bounded factor', () => {
    const huge = wheelZoomFactor(100_000, 0);
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBeCloseTo(Math.exp(200 * 0.0015), 12);
  });
});

import { describe, expect, it } from 'vitest';
import { laneAtLateral, laneInner, laneOuter } from './depth-renderer';

/**
 * The lane geometry of the depth view, and nothing else in it.
 *
 * Testing the renderer itself would need a canvas, which the testing policy in
 * the decision log rules out — but the arithmetic that decides *which era bar
 * the cursor is over* is pure, and it was wrong: it rounded to the nearest lane
 * boundary while a bar occupies four fifths of its lane's step, so the hit
 * target sat a third of a bar away from the bar.
 */
describe('laneAtLateral', () => {
  it('finds the lane a point inside a bar belongs to', () => {
    for (const lane of [0, 1, 2]) {
      const middle = (laneInner(lane) + laneOuter(lane)) / 2;
      expect(laneAtLateral(middle)).toBe(lane);
    }
  });

  it('claims both edges of every bar', () => {
    for (const lane of [0, 1, 2]) {
      expect(laneAtLateral(laneInner(lane))).toBe(lane);
      expect(laneAtLateral(laneOuter(lane))).toBe(lane);
    }
  });

  it('hits nothing in the gap between two bars', () => {
    // The gap is what stops "the Cold War" and "the Nineties" reading as one
    // bar, so clicking in it has to hit nothing — `round` claimed it for the
    // nearer lane, which is the off-by-a-third this replaced.
    const gap = (laneOuter(0) + laneInner(1)) / 2;
    expect(gap).toBeGreaterThan(laneOuter(0));
    expect(gap).toBeLessThan(laneInner(1));
    expect(laneAtLateral(gap)).toBeNull();
  });

  it('hits nothing inside the river or beyond the outermost lane', () => {
    expect(laneAtLateral(0)).toBeNull();
    expect(laneAtLateral(0.3)).toBeNull();
    expect(laneAtLateral(laneInner(0) - 0.1)).toBeNull();
    expect(laneAtLateral(laneOuter(2) + 0.1)).toBeNull();
  });

  it('never reports a lane the renderer does not draw', () => {
    for (let magnitude = 0; magnitude <= 2; magnitude += 0.001) {
      const lane = laneAtLateral(magnitude);
      if (lane === null) continue;
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(lane).toBeLessThan(3);
      // Within the bar it claims, plus the slack that keeps an edge clickable.
      expect(magnitude).toBeGreaterThan(laneInner(lane) - 0.02);
      expect(magnitude).toBeLessThan(laneOuter(lane) + 0.02);
    }
  });

  it('leaves the lanes in ascending, non-overlapping order', () => {
    expect(laneOuter(0)).toBeLessThan(laneInner(1));
    expect(laneOuter(1)).toBeLessThan(laneInner(2));
    expect(laneOuter(2)).toBeLessThanOrEqual(1);
  });
});

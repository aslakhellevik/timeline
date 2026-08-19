import { describe, expect, it } from 'vitest';
import type { DensityResult } from '../core/density';
import { MassTransition, blend, eased } from './mass-transition';

function grid(...values: number[]): DensityResult {
  const lambda = Float64Array.from(values);
  return { lambda, lambdaMax: Math.max(0, ...values), total: values.reduce((a, b) => a + b, 0) };
}

describe('eased', () => {
  it('pins both ends and passes through the middle', () => {
    expect(eased(0)).toBe(0);
    expect(eased(0.5)).toBeCloseTo(0.5);
    expect(eased(1)).toBe(1);
  });

  it('clamps outside [0, 1] rather than overshooting', () => {
    expect(eased(-3)).toBe(0);
    expect(eased(4)).toBe(1);
  });

  it('starts and ends slower than linear', () => {
    // The whole reason it exists: a linear blend reads as a mechanical wipe.
    expect(eased(0.15)).toBeLessThan(0.15);
    expect(eased(0.85)).toBeGreaterThan(0.85);
  });
});

describe('blend', () => {
  it('interpolates element-wise', () => {
    const out = blend(Float64Array.from([0, 10]), Float64Array.from([10, 0]), 0.25);
    expect([...out]).toEqual([2.5, 7.5]);
  });
});

describe('MassTransition', () => {
  const KEY = 'window';

  it('settles immediately when nothing has been drawn yet', () => {
    const transition = new MassTransition(300);
    transition.begin();
    const frame = transition.resolve(grid(1, 2, 3), KEY, 0);
    expect(frame.animating).toBe(false);
    expect([...frame.density.lambda]).toEqual([1, 2, 3]);
  });

  it('interpolates from the drawn grid towards the new one', () => {
    const transition = new MassTransition(300);
    transition.resolve(grid(10, 10), KEY, 0);

    transition.begin();
    const start = transition.resolve(grid(0, 0), KEY, 0);
    expect(start.animating).toBe(true);
    expect(start.density.lambda[0]).toBeCloseTo(10);

    const middle = transition.resolve(grid(0, 0), KEY, 150);
    expect(middle.density.lambda[0]).toBeCloseTo(5);
    expect(middle.animating).toBe(true);

    const done = transition.resolve(grid(0, 0), KEY, 300);
    expect(done.density.lambda[0]).toBe(0);
    expect(done.animating).toBe(false);
  });

  it('interpolates lambdaMax too, so the crossfade moves with the mass', () => {
    const transition = new MassTransition(300);
    transition.resolve(grid(8, 8), KEY, 0);
    transition.begin();
    transition.resolve(grid(0, 0), KEY, 0);
    expect(transition.resolve(grid(0, 0), KEY, 150).density.lambdaMax).toBeCloseTo(4);
  });

  it('abandons the animation when the window moves', () => {
    // A pan recomputes the grid against a different window, so the two grids
    // describe different things and there is nothing to interpolate.
    const transition = new MassTransition(300);
    transition.resolve(grid(10, 10), KEY, 0);
    transition.begin();
    transition.resolve(grid(0, 0), KEY, 0);

    const panned = transition.resolve(grid(0, 0), 'other window', 100);
    expect(panned.animating).toBe(false);
    expect(panned.density.lambda[0]).toBe(0);
  });

  it('continues from where it looks, not from where it started', () => {
    /*
     * Two filter changes in quick succession. The second must pick up the
     * partly-faded picture on screen; blending from the original would snap the
     * mass back to full before moving on, which is worse than not animating.
     */
    const transition = new MassTransition(300);
    transition.resolve(grid(10), KEY, 0);
    transition.begin();
    transition.resolve(grid(0), KEY, 0);
    const halfway = transition.resolve(grid(0), KEY, 150);
    expect(halfway.density.lambda[0]).toBeCloseTo(5);

    transition.begin();
    const restarted = transition.resolve(grid(20), KEY, 150);
    expect(restarted.density.lambda[0]).toBeCloseTo(5, 5);
  });

  it('skips the animation when the grid changes length', () => {
    // A resize, not a filter change: there is no element-wise correspondence.
    const transition = new MassTransition(300);
    transition.resolve(grid(1, 2, 3), KEY, 0);
    transition.begin();
    const frame = transition.resolve(grid(1, 2), KEY, 0);
    expect(frame.animating).toBe(false);
  });

  it('forgets everything on reset', () => {
    const transition = new MassTransition(300);
    transition.resolve(grid(10), KEY, 0);
    transition.reset();
    transition.begin();
    expect(transition.resolve(grid(0), KEY, 0).animating).toBe(false);
  });
});

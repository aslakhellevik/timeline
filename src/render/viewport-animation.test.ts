import { describe, expect, it } from 'vitest';
import type { Viewport } from '../core/model/types';
import { animateViewport, ease } from './viewport-animation';
import type { AnimationClock } from './viewport-animation';
import { centre, span } from './viewport';

/**
 * The clock is a parameter for exactly this: there is no
 * `requestAnimationFrame` here, and "does it end on the window it promised"
 * is the property worth pinning — a reveal that stops a pixel short is a
 * reveal that leaves the mark half off the edge.
 */
function fakeClock(): AnimationClock & { tick(ms: number): void; pending(): number } {
  let time = 0;
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    now: () => time,
    request(callback) {
      const handle = next++;
      queue.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle);
    },
    tick(ms) {
      time += ms;
      const due = [...queue.entries()];
      queue.clear();
      for (const [, callback] of due) callback();
    },
    pending: () => queue.size,
  };
}

function owner(start: number, end: number) {
  let viewport: Viewport = { start, end, width: 1000 };
  const seen: Viewport[] = [];
  return {
    getViewport: () => viewport,
    setViewport(next: Viewport) {
      viewport = next;
      seen.push(next);
    },
    seen,
  };
}

const host = () => {
  let draws = 0;
  return { requestDraw: () => void draws++, count: () => draws };
};

describe('ease', () => {
  it('pins both ends and stays inside them', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    for (let u = 0; u <= 1; u += 0.05) {
      expect(ease(u)).toBeGreaterThanOrEqual(0);
      expect(ease(u)).toBeLessThanOrEqual(1);
    }
  });

  it('never goes backwards', () => {
    let last = -1;
    for (let u = 0; u <= 1; u += 0.02) {
      const value = ease(u);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it('starts and ends gently, which is the whole point of it', () => {
    expect(ease(0.05)).toBeLessThan(0.05);
    expect(ease(0.95)).toBeGreaterThan(0.95);
  });
});

describe('animateViewport', () => {
  it('does not move on the call, only on the first frame', () => {
    const clock = fakeClock();
    const view = owner(0, 1000);
    animateViewport(host(), view, { start: 500, end: 700, width: 1000 }, { ms: 100, clock });
    expect(view.seen).toHaveLength(0);
    clock.tick(10);
    expect(view.seen).toHaveLength(1);
  });

  it('lands exactly on the target and then stops', () => {
    const clock = fakeClock();
    const view = owner(0, 1000);
    const target = { start: 500, end: 700, width: 1000 };
    animateViewport(host(), view, target, { ms: 100, clock });

    for (let i = 0; i < 20; i++) clock.tick(16);
    expect(view.getViewport()).toEqual(target);
    expect(clock.pending()).toBe(0);
  });

  it('moves through the interval, never past either end', () => {
    const clock = fakeClock();
    const view = owner(0, 1000);
    animateViewport(host(), view, { start: 4000, end: 4200, width: 1000 }, { ms: 100, clock });

    for (let i = 0; i < 6; i++) clock.tick(16);
    for (const frame of view.seen) {
      expect(centre(frame)).toBeGreaterThanOrEqual(500);
      expect(centre(frame)).toBeLessThanOrEqual(4100);
      expect(span(frame)).toBeLessThanOrEqual(1000);
      expect(span(frame)).toBeGreaterThanOrEqual(200);
    }
  });

  it('redraws once per frame', () => {
    const clock = fakeClock();
    const painter = host();
    animateViewport(painter, owner(0, 1000), { start: 0, end: 400, width: 1000 }, {
      ms: 100,
      clock,
    });
    clock.tick(16);
    clock.tick(16);
    expect(painter.count()).toBe(2);
  });

  /** A gesture arriving mid-flight has to win, or the canvas fights the hand. */
  it('stops dead when cancelled, leaving the viewport where it was', () => {
    const clock = fakeClock();
    const view = owner(0, 1000);
    const cancel = animateViewport(host(), view, { start: 0, end: 100, width: 1000 }, {
      ms: 100,
      clock,
    });

    clock.tick(30);
    const held = view.getViewport();
    cancel();
    clock.tick(1000);
    expect(view.getViewport()).toBe(held);
    expect(clock.pending()).toBe(0);
  });

  it('a zero duration is one jump, not a division by zero', () => {
    const clock = fakeClock();
    const view = owner(0, 1000);
    const target = { start: 10, end: 20, width: 1000 };
    animateViewport(host(), view, target, { ms: 0, clock });
    clock.tick(0);
    expect(view.getViewport()).toEqual(target);
  });
});

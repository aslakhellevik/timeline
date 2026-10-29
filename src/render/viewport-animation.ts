/**
 * Eases the viewport from where it is to where it should be (§5.1).
 *
 * `viewport.ts` knows how to interpolate two windows and deliberately knows
 * nothing else; this is the part with a clock in it. Framework-agnostic like
 * everything else under `src/render` (D11): it drives a renderer that owns a
 * viewport and a host that owns a canvas, and never learns what either is.
 *
 * The clock is a parameter rather than a global so the easing can be tested on
 * a fake one — there is no `requestAnimationFrame` in the test environment, and
 * "does it end exactly on the target" is precisely the property worth pinning.
 */

import type { Viewport } from '../core/model/types';
import { interpolate } from './viewport';

/** The half of a renderer an animation touches. */
export interface ViewportOwner {
  getViewport(): Viewport;
  setViewport(viewport: Viewport): void;
}

/** The half of `CanvasHost` an animation touches. */
export interface DrawHost {
  requestDraw(): void;
}

export interface AnimationClock {
  now(): number;
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/**
 * Long enough to read as motion, short enough that nobody waits for it.
 *
 * §5.1 asks for "a short ease" for one specific reason: the mass-to-marks
 * transition is a crossfade, and a jump cuts straight past it, so a zoom that
 * teleports looks like a redraw rather than like resolving detail.
 */
export const VIEWPORT_EASE_MS = 260;

const DEFAULT_CLOCK: AnimationClock = {
  now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * Slow at both ends, quickest in the middle.
 *
 * Cubic in and out rather than an ease-out: the movement starts from a picture
 * the user was reading, and pulling it away at full speed on the first frame is
 * what makes an animated view feel like it is fighting you.
 */
export function ease(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export interface AnimateOptions {
  ms?: number;
  /** Called with every intermediate window, for the URL mirror (D24). */
  onFrame?: (viewport: Viewport) => void;
  clock?: AnimationClock;
}

/**
 * Moves `owner`'s viewport to `to` over `ms`, redrawing as it goes.
 *
 * Returns a cancel function, and the caller is expected to use it: a gesture
 * arriving mid-flight has to win, or the animation goes on writing the viewport
 * underneath the finger. The last frame is the target *exactly* rather than an
 * interpolation at `u = 1`, so a reveal ends on the window it promised however
 * the frames happened to fall.
 */
export function animateViewport(
  host: DrawHost,
  owner: ViewportOwner,
  to: Viewport,
  { ms = VIEWPORT_EASE_MS, onFrame, clock = DEFAULT_CLOCK }: AnimateOptions = {},
): () => void {
  const from = owner.getViewport();
  const started = clock.now();
  let handle: number | null = null;
  let stopped = false;

  const apply = (viewport: Viewport) => {
    owner.setViewport(viewport);
    host.requestDraw();
    onFrame?.(viewport);
  };

  const step = () => {
    handle = null;
    if (stopped) return;

    const u = ms <= 0 ? 1 : (clock.now() - started) / ms;
    if (u >= 1) {
      stopped = true;
      apply({ ...to });
      return;
    }
    apply(interpolate(from, to, ease(u)));
    handle = clock.request(step);
  };

  // The first frame is scheduled rather than applied here: moving on the call
  // would put a jump at the front of the very thing meant to remove one.
  handle = clock.request(step);

  return () => {
    stopped = true;
    if (handle !== null) clock.cancel(handle);
    handle = null;
  };
}

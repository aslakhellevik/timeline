/**
 * Turns gestures into viewport changes (docs/design.md §5.1).
 *
 * Wheel zooms at the cursor, drag pans, two fingers pinch, arrows pan and +/-
 * zoom. All of it goes through the pure functions in `viewport.ts`; nothing here
 * holds timeline state.
 *
 * The zoom-factor maths is separated out and tested; the event plumbing is not,
 * per the testing policy in the decision log.
 */

import type { Viewport } from '../core/model/types';
import { panByPx, zoomAt } from './viewport';
import type { TimeBounds } from './viewport';

/**
 * Wheel delta to a multiplicative zoom factor.
 *
 * Normalising by `deltaMode` matters: a mouse wheel reports lines (mode 1) in
 * coarse notches while a trackpad reports pixels (mode 0) in a fine stream, and
 * treating them alike makes one of the two unusable. The exponential keeps zoom
 * proportional, so a notch changes the span by the same ratio at every scale.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, sensitivity = 0.0015): number {
  const perLine = 16;
  const perPage = 400;
  const px = deltaMode === 1 ? deltaY * perLine : deltaMode === 2 ? deltaY * perPage : deltaY;
  // Clamp so a violent trackpad flick cannot jump several octaves in one event.
  return Math.exp(Math.max(-200, Math.min(200, px)) * sensitivity);
}

export interface InteractionHandlers {
  getViewport: () => Viewport;
  /**
   * `eased` asks for the change to be animated rather than applied at once
   * (§5.1).
   *
   * The distinction is between gestures that are already continuous and
   * gestures that are one discrete jump. A drag or a wheel arrives as a stream
   * and easing it would only make the canvas lag the hand; a double-click or a
   * `+` moves the window in a single step, and stepping straight past the
   * mass-to-marks crossfade makes it read as a cut rather than as detail
   * resolving.
   */
  setViewport: (vp: Viewport, eased?: boolean) => void;
  getBounds: () => TimeBounds;
}

/** Attaches listeners and returns a detach function. */
export function attachInteraction(el: HTMLElement, h: InteractionHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let dragging = false;
  let lastX = 0;

  /*
   * The element's left edge, cached.
   *
   * `getBoundingClientRect` forces a layout flush, and this used to run inside
   * the wheel handler — which fires as a continuous stream from a trackpad, so
   * every notch of a zoom paid for a full style recalculation. The edge only
   * moves when the page does, so it is recomputed lazily after the three things
   * that can move it: the window resizing, an ancestor scrolling, and the
   * pointer arriving over the canvas after any layout change in between.
   */
  let rectLeft = 0;
  let stale = true;
  const invalidate = () => {
    stale = true;
  };
  const localX = (clientX: number) => {
    if (stale) {
      rectLeft = el.getBoundingClientRect().left;
      stale = false;
    }
    return clientX - rectLeft;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const vp = h.getViewport();

    // Horizontal intent — shift-wheel, or a trackpad two-finger swipe — pans.
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      h.setViewport(panByPx(vp, dx, h.getBounds()));
      return;
    }

    const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
    h.setViewport(zoomAt(vp, localX(e.clientX), factor, h.getBounds()));
  };

  const onPointerDown = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    invalidate();

    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
    } else if (pointers.size === 2) {
      dragging = false;
      pinchDistance = spread(pointers);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const distance = spread(pointers);
      if (pinchDistance > 0 && distance > 0) {
        const midpoint = centreOf(pointers);
        h.setViewport(
          zoomAt(h.getViewport(), localX(midpoint), pinchDistance / distance, h.getBounds()),
        );
      }
      pinchDistance = distance;
      return;
    }

    if (dragging) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      // Dragging right should pull earlier time into view, so the content follows
      // the finger — hence the negated delta.
      h.setViewport(panByPx(h.getViewport(), -dx, h.getBounds()));
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = 0;

    if (pointers.size === 0) {
      dragging = false;
    } else if (pointers.size === 1) {
      /*
       * One finger of a pinch lifted, and the other is still down.
       *
       * That is a pan, not the end of the gesture — but `dragging` was cleared
       * when the second finger arrived and nothing turned it back on, so the
       * canvas simply stopped following the remaining finger until it was
       * lifted and put down again. The survivor's position seeds `lastX`, or
       * the first move after the lift is read as a jump from wherever the
       * *other* finger last was.
       */
      const [survivor] = pointers.values();
      if (survivor) {
        dragging = true;
        lastX = survivor.x;
      }
    }

    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const vp = h.getViewport();
    const step = e.shiftKey ? vp.width * 0.5 : vp.width * 0.1;

    switch (e.key) {
      case 'ArrowLeft':
        h.setViewport(panByPx(vp, -step, h.getBounds()));
        break;
      case 'ArrowRight':
        h.setViewport(panByPx(vp, step, h.getBounds()));
        break;
      case '+':
      case '=':
        h.setViewport(zoomAt(vp, vp.width / 2, 1 / 1.4, h.getBounds()), true);
        break;
      case '-':
      case '_':
        h.setViewport(zoomAt(vp, vp.width / 2, 1.4, h.getBounds()), true);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onDoubleClick = (e: MouseEvent) => {
    h.setViewport(zoomAt(h.getViewport(), localX(e.clientX), 1 / 2.5, h.getBounds()), true);
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('pointerenter', invalidate);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('resize', invalidate);
  // Capture, because a scroll on any ancestor moves the canvas and scroll events
  // from an element do not bubble.
  window.addEventListener('scroll', invalidate, true);

  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('pointerenter', invalidate);
    el.removeEventListener('keydown', onKeyDown);
    el.removeEventListener('dblclick', onDoubleClick);
    window.removeEventListener('resize', invalidate);
    window.removeEventListener('scroll', invalidate, true);
  };
}

function spread(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centreOf(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return (a.x + b.x) / 2;
}

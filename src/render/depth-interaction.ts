/**
 * Gestures for the depth view (docs/design.md §6.7).
 *
 * A separate file from `interaction.ts` rather than a flag on it, because one
 * thing genuinely differs: the axis is vertical *and* nonlinear, so a drag
 * cannot be converted to a time delta by a constant. Dragging grabs the ground
 * and pulls it — the time under the cursor when the drag began stays under the
 * cursor — which is the only model that feels right when a pixel near the
 * horizon is worth eighty times a pixel at your feet.
 *
 * Everything else is reused: the viewport is still one-dimensional, so `zoomAt`
 * and `clamp` from `viewport.ts` do the actual work.
 */

import type { Viewport } from '../core/model/types';
import type { DepthProjection } from './projection';
import { wheelZoomFactor } from './interaction';
import { clamp, zoomAt } from './viewport';
import type { TimeBounds } from './viewport';

export interface DepthHandlers {
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport) => void;
  getBounds: () => TimeBounds;
  /** The projection of the last drawn frame — the source of the inverse mapping. */
  getProjection: () => DepthProjection | null;
}

/**
 * Zoom anchored on the time under the cursor.
 *
 * `zoomAt` works in flat pixels, so the anchor is converted: find the time at
 * the cursor's height, then ask where that time would sit on a linear axis of
 * the same window. The window maths is then identical to the flat view's, which
 * is why zoom limits, bounds and the URL round-trip all keep working.
 */
function zoomAtY(
  viewport: Viewport,
  projection: DepthProjection | null,
  y: number,
  factor: number,
  bounds: TimeBounds,
): Viewport {
  if (!projection) return zoomAt(viewport, viewport.width / 2, factor, bounds);
  const t = projection.timeAtY(y);
  const span = viewport.end - viewport.start || 1;
  const anchorPx = ((t - viewport.start) / span) * viewport.width;
  return zoomAt(viewport, anchorPx, factor, bounds);
}

export function attachDepthInteraction(el: HTMLElement, h: DepthHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let dragging = false;
  let lastY = 0;

  const localY = (clientY: number) => clientY - el.getBoundingClientRect().top;

  /** Shift the window so the time that was at `fromY` moves to `toY`. */
  const dragTo = (fromY: number, toY: number) => {
    const projection = h.getProjection();
    const vp = h.getViewport();
    if (!projection) return;
    const dt = projection.timeAtY(fromY) - projection.timeAtY(toY);
    if (!Number.isFinite(dt) || dt === 0) return;
    h.setViewport(clamp({ start: vp.start + dt, end: vp.end + dt, width: vp.width }, h.getBounds()));
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
    h.setViewport(zoomAtY(h.getViewport(), h.getProjection(), localY(e.clientY), factor, h.getBounds()));
  };

  const onPointerDown = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = true;
      lastY = localY(e.clientY);
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
        const centre = [...pointers.values()].reduce((sum, p) => sum + p.y, 0) / 2;
        h.setViewport(
          zoomAtY(
            h.getViewport(),
            h.getProjection(),
            localY(centre),
            pinchDistance / distance,
            h.getBounds(),
          ),
        );
      }
      pinchDistance = distance;
      return;
    }

    if (dragging) {
      const y = localY(e.clientY);
      dragTo(lastY, y);
      lastY = y;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) dragging = false;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const vp = h.getViewport();
    const projection = h.getProjection();
    const height = el.getBoundingClientRect().height;
    const step = e.shiftKey ? height * 0.4 : height * 0.12;

    switch (e.key) {
      // Up walks into the past, which is where the corridor goes.
      case 'ArrowUp':
        if (projection) dragTo(height * 0.6, height * 0.6 + step);
        break;
      case 'ArrowDown':
        if (projection) dragTo(height * 0.6, height * 0.6 - step);
        break;
      case '+':
      case '=':
        h.setViewport(zoomAtY(vp, projection, height * 0.6, 1 / 1.4, h.getBounds()));
        break;
      case '-':
      case '_':
        h.setViewport(zoomAtY(vp, projection, height * 0.6, 1.4, h.getBounds()));
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onDoubleClick = (e: MouseEvent) => {
    h.setViewport(zoomAtY(h.getViewport(), h.getProjection(), localY(e.clientY), 1 / 2.5, h.getBounds()));
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('dblclick', onDoubleClick);

  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('keydown', onKeyDown);
    el.removeEventListener('dblclick', onDoubleClick);
  };
}

function spread(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

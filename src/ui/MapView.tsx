import { useCallback, useEffect, useRef } from 'react';
import type { Id, Tag, TimelineEvent } from '../core/model/types';
import { project } from '../core/geo';
import { compareTime } from '../core/time';
import { CanvasHost } from '../render/canvas-host';
import { MapRenderer } from '../render/map-renderer';
import { clamp } from '../render/viewport';
import type { TimeBounds } from '../render/viewport';
import { animateViewport } from '../render/viewport-animation';

/**
 * The spatial view (docs/design.md §11).
 *
 * Two regions, each with one meaning, because a canvas with two interaction
 * models on it is a canvas nobody can predict: the map pans and zooms in
 * *space*, and the scrubber along the bottom moves and resizes the window in
 * *time*. Dragging in one never does the other's job.
 */
export interface MapViewProps {
  events: readonly TimelineEvent[];
  tags: readonly Tag[];
  allEvents: readonly TimelineEvent[];
  selectedId: Id | null;
  /** The first endpoint of a connection being made, so the map can draw it too. */
  connectFrom: Id | null;
  onSelectEvent: (id: Id) => void;
  /** Bumped when something asks for the selection to be brought into view. */
  revealRequest: number;
  initialViewport?: { centre: number; span: number };
  onViewportChange?: (viewport: { centre: number; span: number }) => void;
}

export function MapView({
  events,
  tags,
  allEvents,
  selectedId,
  connectFrom,
  onSelectEvent,
  revealRequest,
  initialViewport,
  onViewportChange,
}: MapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const hostRef = useRef<CanvasHost | null>(null);

  const reportRef = useRef(onViewportChange);
  reportRef.current = onViewportChange;
  const selectRef = useRef(onSelectEvent);
  selectRef.current = onSelectEvent;
  const initialRef = useRef(initialViewport);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  /** Cancels the scrubber animation in flight, if any. */
  const stopRef = useRef<(() => void) | null>(null);
  /** The id this map's own click just selected — see the reveal effect. */
  const clickedRef = useRef<Id | null>(null);
  const requestRef = useRef(revealRequest);

  const report = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const viewport = renderer.getViewport();
    reportRef.current?.({
      centre: (viewport.start + viewport.end) / 2,
      span: viewport.end - viewport.start,
    });
  }, []);

  /** Stops the scrubber animation, so a gesture always wins over a reveal. */
  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    const renderer = new MapRenderer();
    rendererRef.current = renderer;
    renderer.setData({ events, tags, calibration: allEvents });

    const host = new CanvasHost(canvas, (ctx, size) => renderer.draw(ctx, size));
    hostRef.current = host;

    const extent = renderer.getExtent();
    const bounds: TimeBounds = { min: extent.start, max: extent.end };
    const width = host.getSize().width || 1000;

    const restored = initialRef.current;
    renderer.setViewport(
      restored
        ? clamp(
            {
              start: restored.centre - restored.span / 2,
              end: restored.centre + restored.span / 2,
              width,
            },
            bounds,
          )
        : { start: extent.start, end: extent.end, width },
    );
    host.requestDraw();

    const local = (event: PointerEvent | WheelEvent) => {
      const rect = frame.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    type Drag =
      | { kind: 'map'; x: number; y: number }
      | { kind: 'window'; x: number; start: number; end: number }
      | { kind: 'edge'; edge: 'start' | 'end' };

    let drag: Drag | null = null;
    let downAt: { x: number; y: number } | null = null;

    /** Where a scrubber press lands: an edge to resize, or the band to slide. */
    const scrubTarget = (x: number): Drag => {
      const viewport = renderer.getViewport();
      const extentNow = renderer.getExtent();
      const span = extentNow.end - extentNow.start || 1;
      const toPx = (t: number) => ((t - extentNow.start) / span) * (host.getSize().width || 1);
      const left = toPx(viewport.start);
      const right = toPx(viewport.end);

      // Grabbing within a few pixels of an edge resizes the window; anywhere
      // else slides it. A band narrower than a finger has no interior, so the
      // edges take priority only when there is room for both.
      if (right - left > 24) {
        if (Math.abs(x - left) < 8) return { kind: 'edge', edge: 'start' };
        if (Math.abs(x - right) < 8) return { kind: 'edge', edge: 'end' };
      }
      return { kind: 'window', x, start: viewport.start, end: viewport.end };
    };

    const onDown = (event: PointerEvent) => {
      const { x, y } = local(event);
      downAt = { x, y };
      // A hand on the canvas outranks a reveal still easing towards its window.
      stop();
      frame.setPointerCapture(event.pointerId);

      if (y > renderer.getMapHeight()) {
        drag = scrubTarget(x);
        // A press anywhere in the strip also jumps the window there, which is
        // what a scrubber is for.
        if (drag.kind === 'window') moveWindowTo(x, drag);
      } else {
        drag = { kind: 'map', x, y };
      }
    };

    const moveWindowTo = (x: number, state: Extract<Drag, { kind: 'window' }>) => {
      const extentNow = renderer.getExtent();
      const span = extentNow.end - extentNow.start || 1;
      const width_ = host.getSize().width || 1;
      const dt = ((x - state.x) / width_) * span;
      const length = state.end - state.start;
      let start = state.start + dt;
      start = Math.max(extentNow.start, Math.min(extentNow.end - length, start));
      renderer.setViewport({ start, end: start + length, width: width_ });
      host.requestDraw();
      report();
    };

    const onMove = (event: PointerEvent) => {
      const { x, y } = local(event);
      renderer.setHover(x, y);

      if (!drag) {
        const target = renderer.hitTest(x, y);
        frame.style.cursor =
          y > renderer.getMapHeight() ? 'ew-resize' : target ? 'pointer' : 'grab';
        host.requestDraw();
        return;
      }

      if (drag.kind === 'map') {
        const camera = renderer.getCamera();
        renderer.setCamera({
          ...camera,
          cx: camera.cx - (x - drag.x) / camera.k,
          cy: camera.cy + (y - drag.y) / camera.k,
        });
        drag = { kind: 'map', x, y };
      } else if (drag.kind === 'window') {
        moveWindowTo(x, drag);
      } else {
        const viewport = renderer.getViewport();
        const t = renderer.timeAtScrubber(x);
        const next =
          drag.edge === 'start'
            ? { start: Math.min(t, viewport.end - 1), end: viewport.end }
            : { start: viewport.start, end: Math.max(t, viewport.start + 1) };
        renderer.setViewport({ ...next, width: host.getSize().width || 1 });
        report();
      }

      host.requestDraw();
    };

    const onUp = (event: PointerEvent) => {
      const start = downAt;
      const wasDragging = drag;
      drag = null;
      downAt = null;
      if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
      if (!start || wasDragging?.kind !== 'map') return;

      const { x, y } = local(event);
      if (Math.hypot(x - start.x, y - start.y) > 4) return;

      const target = renderer.hitTest(x, y);
      if (target?.kind === 'cluster') {
        // A cluster of one selects it; a cluster of many selects the earliest,
        // which is the one the eye is looking for on a map of a period.
        // `compareTime` rather than a `b` subtraction: it is the corpus's sort
        // key (it breaks a tie on `a`), and two orderings of the same events is
        // one more than this project needs.
        const earliest = [...target.cluster.events].sort((a, b) => compareTime(a.when, b.when))[0];
        if (earliest) {
          // Noted before the selection lands, so the reveal below can tell a
          // selection made *here* from one that arrived from elsewhere.
          clickedRef.current = earliest.id;
          selectRef.current(earliest.id);
        }
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { x, y } = local(event);
      stop();

      if (y > renderer.getMapHeight()) {
        // Over the scrubber the wheel zooms *time*, anchored where the cursor is.
        const viewport = renderer.getViewport();
        const anchor = renderer.timeAtScrubber(x);
        const factor = Math.exp(Math.max(-200, Math.min(200, event.deltaY)) * 0.0015);
        const extentNow = renderer.getExtent();
        const span = Math.min(
          extentNow.end - extentNow.start,
          Math.max(30, (viewport.end - viewport.start) * factor),
        );
        const ratio = (anchor - viewport.start) / (viewport.end - viewport.start || 1);
        let start = anchor - ratio * span;
        start = Math.max(extentNow.start, Math.min(extentNow.end - span, start));
        renderer.setViewport({ start, end: start + span, width: host.getSize().width || 1 });
        report();
      } else {
        // Over the map it zooms *space*, keeping the point under the cursor fixed.
        const camera = renderer.getCamera();
        const before = renderer.screenToLonLat(x, y);
        const factor = Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.0018);
        renderer.setCamera({ ...camera, k: camera.k * factor });
        const after = renderer.screenToLonLat(x, y);
        const next = renderer.getCamera();
        const shift = projectShift(before, after);
        renderer.setCamera({ ...next, cx: next.cx + shift.x, cy: next.cy + shift.y });
      }

      host.requestDraw();
    };

    const onLeave = () => {
      renderer.setHover(null, null);
      host.requestDraw();
    };

    /** Double-click reframes the whole world — the way back from any zoom. */
    const onDoubleClick = () => {
      renderer.fitWorld();
      host.requestDraw();
    };

    frame.addEventListener('pointerdown', onDown);
    frame.addEventListener('pointermove', onMove);
    frame.addEventListener('pointerup', onUp);
    frame.addEventListener('pointercancel', onUp);
    frame.addEventListener('pointerleave', onLeave);
    frame.addEventListener('wheel', onWheel, { passive: false });
    frame.addEventListener('dblclick', onDoubleClick);

    return () => {
      stop();
      frame.removeEventListener('pointerdown', onDown);
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('pointerup', onUp);
      frame.removeEventListener('pointercancel', onUp);
      frame.removeEventListener('pointerleave', onLeave);
      frame.removeEventListener('wheel', onWheel);
      frame.removeEventListener('dblclick', onDoubleClick);
      host.destroy();
      rendererRef.current = null;
      hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setData({ events, tags, calibration: allEvents });
    hostRef.current?.requestDraw();
  }, [events, tags, allEvents]);

  useEffect(() => {
    rendererRef.current?.setSelection(selectedId);
    rendererRef.current?.setConnectFrom(connectFrom);
    hostRef.current?.requestDraw();
  }, [selectedId, connectFrom]);

  /**
   * Brings the selected event onto the map (§6.1).
   *
   * Two motions, because the map has two axes with two meanings. The window
   * moves in *time* — an event outside it is not drawn here at all, so
   * selecting one from the list would otherwise leave nothing to look at — and
   * the camera moves in *space*, but only when the event's dot is off screen.
   * A click on a cluster is exempt for the reason it is on the other canvases:
   * it was already under the pointer.
   */
  useEffect(() => {
    const asked = revealRequest !== requestRef.current;
    requestRef.current = revealRequest;
    const clicked = clickedRef.current === selectedId;
    clickedRef.current = null;
    if (clicked && !asked) return;

    const renderer = rendererRef.current;
    const host = hostRef.current;
    if (!renderer || !host || !selectedId) return;
    const event = eventsRef.current.find((candidate) => candidate.id === selectedId);
    if (!event) return;

    const target = renderer.revealTime(event.when.b, event.when.c);
    if (target) {
      stop();
      stopRef.current = animateViewport(host, renderer, target, { onFrame: report });
    }
    if (renderer.revealEvent(event.id)) host.requestDraw();
  }, [selectedId, revealRequest, report, stop]);

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      // The same role as the other two canvases, though this one is pointer-only
      // so far: the label says so rather than promising keys it does not bind.
      role="application"
      aria-roledescription="map canvas"
      aria-label={`A world map of ${events.length} events, with a time scrubber. Dragging and the wheel move it; the list view is the keyboard-navigable equivalent, and ? lists the shortcuts.`}
      className="h-full w-full cursor-grab touch-none outline-none focus-visible:ring-1 focus-visible:ring-paper-dim/40"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

/**
 * How far the camera must move so a point stays under the cursor across a zoom.
 *
 * Worked in projected space rather than degrees, because that is where the
 * camera lives and the conversion is exact there.
 */
function projectShift(
  before: { lon: number; lat: number },
  after: { lon: number; lat: number },
): { x: number; y: number } {
  const a = project(before.lon, before.lat);
  const b = project(after.lon, after.lat);
  return { x: a.x - b.x, y: a.y - b.y };
}

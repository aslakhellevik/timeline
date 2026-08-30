import { useEffect, useRef } from 'react';
import type { Connection, Era, Id, Tag, TimelineEvent } from '../core/model/types';
import { CanvasHost } from '../render/canvas-host';
import { DepthRenderer } from '../render/depth-renderer';
import { attachDepthInteraction } from '../render/depth-interaction';
import { fitTo } from '../render/viewport';
import type { TimeBounds } from '../render/viewport';

/**
 * Mounts the depth renderer (docs/design.md §6.7).
 *
 * Deliberately the same shape as `TimelineView`: same props, same lifecycle,
 * same refusal to let React touch the canvas. The two views share a viewport
 * model, so switching between them keeps the period you were looking at.
 */
export interface DepthViewProps {
  events: readonly TimelineEvent[];
  connections: readonly Connection[];
  tags: readonly Tag[];
  eras: readonly Era[];
  /** The unfiltered corpus — sets the mass scale and the extent (D31). */
  allEvents: readonly TimelineEvent[];
  selectedId: Id | null;
  selectedConnectionId: Id | null;
  selectedEraId: Id | null;
  connectFrom: Id | null;
  onSelectEvent: (id: Id) => void;
  onSelectConnection: (id: Id) => void;
  onSelectEra: (id: Id) => void;
  initialViewport?: { centre: number; span: number };
  onViewportChange?: (viewport: { centre: number; span: number }) => void;
}

export function DepthView({
  events,
  connections,
  tags,
  eras,
  allEvents,
  selectedId,
  selectedConnectionId,
  selectedEraId,
  connectFrom,
  onSelectEvent,
  onSelectConnection,
  onSelectEra,
  initialViewport,
  onViewportChange,
}: DepthViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const rendererRef = useRef<DepthRenderer | null>(null);
  const hostRef = useRef<CanvasHost | null>(null);
  const boundsRef = useRef<TimeBounds>({ min: 0, max: 1 });
  const reportRef = useRef(onViewportChange);
  reportRef.current = onViewportChange;
  const selectEventRef = useRef(onSelectEvent);
  selectEventRef.current = onSelectEvent;
  const selectConnectionRef = useRef(onSelectConnection);
  selectConnectionRef.current = onSelectConnection;
  const selectEraRef = useRef(onSelectEra);
  selectEraRef.current = onSelectEra;
  const initialRef = useRef(initialViewport);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    const renderer = new DepthRenderer();
    rendererRef.current = renderer;
    renderer.setData({ events, connections, tags, eras, calibration: allEvents });

    const host = new CanvasHost(canvas, (ctx, size) => renderer.draw(ctx, size));
    hostRef.current = host;

    // `getFrame`, not `getExtent`: eras count towards what the corridor may pan
    // over, and with neither it states a default. The old `{0, 1}` fallback was
    // a one-day window at the epoch, which `clamp` then read as a three-day zoom
    // limit — so a timeline with no events but a "my life" era could not be
    // zoomed out far enough to reach it.
    const extent = renderer.getFrame();
    boundsRef.current = boundsOf(extent);
    const width = host.getSize().width || 1000;

    const restored = initialRef.current;
    renderer.setViewport(
      restored
        ? fitTo(
            restored.centre - restored.span / 2,
            restored.centre + restored.span / 2,
            width,
            boundsRef.current,
            0,
          )
        : fitTo(extent.start, extent.end, width, boundsRef.current, 0.01),
    );
    host.requestDraw();

    const report = () => {
      const viewport = renderer.getViewport();
      reportRef.current?.({
        centre: (viewport.start + viewport.end) / 2,
        span: viewport.end - viewport.start,
      });
    };

    const detach = attachDepthInteraction(frame, {
      getViewport: () => renderer.getViewport(),
      setViewport: (viewport) => {
        renderer.setViewport(viewport);
        host.requestDraw();
        report();
      },
      getBounds: () => boundsRef.current,
      getProjection: () => renderer.getProjection(),
    });

    const localPoint = (event: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onMove = (event: PointerEvent) => {
      const { x, y } = localPoint(event);
      renderer.setHover(x, y);
      frame.style.cursor = renderer.hitTest(x, y) ? 'pointer' : 'crosshair';
      host.requestDraw();
    };
    const onLeave = () => {
      renderer.setHover(null, null);
      host.requestDraw();
    };

    // Distance, not `click` — the corridor pans on drag and every pan would
    // otherwise end in a selection.
    let downAt: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      downAt = localPoint(event);
    };
    const onUp = (event: PointerEvent) => {
      const start = downAt;
      downAt = null;
      if (!start) return;
      const { x, y } = localPoint(event);
      if (Math.hypot(x - start.x, y - start.y) > 4) return;

      const target = renderer.hitTest(x, y);
      if (target?.kind === 'event') selectEventRef.current(target.id);
      else if (target?.kind === 'connection') selectConnectionRef.current(target.id);
      else if (target?.kind === 'era') selectEraRef.current(target.id);
    };

    frame.addEventListener('pointermove', onMove);
    frame.addEventListener('pointerleave', onLeave);
    frame.addEventListener('pointerdown', onDown);
    frame.addEventListener('pointerup', onUp);

    return () => {
      detach();
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('pointerleave', onLeave);
      frame.removeEventListener('pointerdown', onDown);
      frame.removeEventListener('pointerup', onUp);
      host.destroy();
      rendererRef.current = null;
      hostRef.current = null;
    };
    // Data flows through the effect below rather than remounting, so the view
    // survives adding an event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if (!renderer || !host) return;

    // Whether there were *events* before, which is the thing worth refitting
    // for: the frame may already be wide because of an era, and the first event
    // can easily land outside it.
    const before = renderer.getExtent();
    renderer.setData({ events, connections, tags, eras, calibration: allEvents });
    const after = renderer.getFrame();

    boundsRef.current = boundsOf(after);
    if (!before && renderer.getExtent()) {
      const width = host.getSize().width || 1000;
      renderer.setViewport(fitTo(after.start, after.end, width, boundsRef.current, 0.01));
    }
    host.requestDraw();
  }, [events, connections, tags, eras, allEvents]);

  useEffect(() => {
    rendererRef.current?.setSelection({
      eventId: selectedId,
      connectionId: selectedConnectionId,
      eraId: selectedEraId,
      connectFrom,
    });
    hostRef.current?.requestDraw();
  }, [selectedId, selectedConnectionId, selectedEraId, connectFrom]);

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      role="img"
      aria-label={`${events.length} historical events along a corridor receding into the past, with ${connections.length} connections drawn as arcs. Switch to the list view for a keyboard-navigable equivalent.`}
      className="h-full w-full cursor-crosshair touch-none outline-none focus-visible:ring-1 focus-visible:ring-paper-dim/40"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

function boundsOf(extent: { start: number; end: number }): TimeBounds {
  const margin = Math.max((extent.end - extent.start) * 0.02, 1);
  return { min: extent.start - margin, max: extent.end + margin };
}

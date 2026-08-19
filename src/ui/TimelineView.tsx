import { useEffect, useRef } from 'react';
import type { Connection, Id, Tag, TimelineEvent } from '../core/model/types';
import { CanvasHost } from '../render/canvas-host';
import { attachInteraction } from '../render/interaction';
import { TimelineRenderer } from '../render/timeline-renderer';
import { fitTo } from '../render/viewport';
import type { TimeBounds } from '../render/viewport';

/**
 * Mounts the canvas renderer and gets out of its way.
 *
 * React never touches the canvas or holds the viewport: pan and zoom run at
 * animation frequency and routing them through component state would re-render
 * the tree sixty times a second for no benefit. The renderer owns the viewport;
 * this component owns only its lifecycle.
 */
export interface TimelineViewProps {
  events: readonly TimelineEvent[];
  connections: readonly Connection[];
  tags: readonly Tag[];
  selectedId: Id | null;
  selectedConnectionId: Id | null;
  connectFrom: Id | null;
  onSelectEvent: (id: Id) => void;
  onSelectConnection: (id: Id) => void;
  /** Restores a bookmarked position (D24). Applied once, on mount. */
  initialViewport?: { centre: number; span: number };
  onViewportChange?: (viewport: { centre: number; span: number }) => void;
}

export function TimelineView({
  events,
  connections,
  tags,
  selectedId,
  selectedConnectionId,
  connectFrom,
  onSelectEvent,
  onSelectConnection,
  initialViewport,
  onViewportChange,
}: TimelineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // The renderer and its host outlive any single render, and the callbacks are
  // reached through refs so a new function identity never tears them down.
  const rendererRef = useRef<TimelineRenderer | null>(null);
  const hostRef = useRef<CanvasHost | null>(null);
  const boundsRef = useRef<TimeBounds>({ min: 0, max: 1 });
  const reportRef = useRef(onViewportChange);
  reportRef.current = onViewportChange;
  const selectEventRef = useRef(onSelectEvent);
  selectEventRef.current = onSelectEvent;
  const selectConnectionRef = useRef(onSelectConnection);
  selectConnectionRef.current = onSelectConnection;
  const initialRef = useRef(initialViewport);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    const renderer = new TimelineRenderer();
    rendererRef.current = renderer;
    renderer.setData(events, connections, tags);

    const host = new CanvasHost(canvas, (ctx, size) => renderer.draw(ctx, size));
    hostRef.current = host;

    const extent = renderer.getExtent() ?? { start: 0, end: 1 };
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

    const detach = attachInteraction(frame, {
      getViewport: () => renderer.getViewport(),
      setViewport: (viewport) => {
        renderer.setViewport(viewport);
        host.requestDraw();
        report();
      },
      getBounds: () => boundsRef.current,
    });

    const localPoint = (event: PointerEvent | MouseEvent) => {
      const rect = frame.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onMove = (event: PointerEvent) => {
      const { x, y } = localPoint(event);
      renderer.setHover(x, y);
      // The cursor is the only signal that an arc is clickable, and a crosshair
      // over one says nothing.
      frame.style.cursor = renderer.hitTest(x, y) ? 'pointer' : 'crosshair';
      host.requestDraw();
    };
    const onLeave = () => {
      renderer.setHover(null, null);
      host.requestDraw();
    };

    // Distinguishing a click from a drag by distance, not by `click`: the canvas
    // pans on drag, and every pan would otherwise end in a selection.
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
    // Data changes flow through the effect below rather than remounting, so the
    // viewport survives adding an event — which is what capture-while-reading
    // needs, since the whole point is to keep looking at the same period.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * New data widens the pannable range, and fills the frame the first time
   * there is anything to fill it with.
   *
   * Refitting on every change would be wrong — capture happens while reading,
   * and yanking the view back to full extent each time an event is added is
   * exactly the behaviour that makes a capture tool unusable — but never
   * refitting leaves the first event stranded in a viewport fitted to nothing.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if (!renderer || !host) return;

    const before = renderer.getExtent();
    renderer.setData(events, connections, tags);
    const after = renderer.getExtent();

    if (after) {
      boundsRef.current = boundsOf(after);
      if (!before) {
        const width = host.getSize().width || 1000;
        renderer.setViewport(fitTo(after.start, after.end, width, boundsRef.current, 0.01));
      }
    }
    host.requestDraw();
  }, [events, connections, tags]);

  useEffect(() => {
    rendererRef.current?.setSelection({
      eventId: selectedId,
      connectionId: selectedConnectionId,
      connectFrom,
    });
    hostRef.current?.requestDraw();
  }, [selectedId, selectedConnectionId, connectFrom]);

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      role="img"
      aria-label={`Density of ${events.length} historical events over time, with ${connections.length} connections drawn as arcs. Switch to the list view for a keyboard-navigable equivalent.`}
      className="h-full w-full cursor-crosshair touch-none outline-none focus-visible:ring-1 focus-visible:ring-paper-dim/40"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

/** A little slack at each end, so the outermost events are not flush to the edge. */
function boundsOf(extent: { start: number; end: number }): TimeBounds {
  const margin = Math.max((extent.end - extent.start) * 0.02, 1);
  return { min: extent.start - margin, max: extent.end + margin };
}

import { useEffect, useRef } from 'react';
import type { TimelineEvent } from '../core/model/types';
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
  /** Restores a bookmarked position (D24). Applied once, on mount. */
  initialViewport?: { centre: number; span: number };
  onViewportChange?: (viewport: { centre: number; span: number }) => void;
}

export function TimelineView({ events, initialViewport, onViewportChange }: TimelineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // Kept in a ref so a changing callback does not tear down the renderer.
  const reportRef = useRef(onViewportChange);
  reportRef.current = onViewportChange;
  const initialRef = useRef(initialViewport);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    const renderer = new TimelineRenderer();
    renderer.setData(events);

    const host = new CanvasHost(canvas, (ctx, size) => renderer.draw(ctx, size));

    const extent = renderer.getExtent() ?? { start: 0, end: 1 };
    const margin = (extent.end - extent.start) * 0.02;
    const bounds: TimeBounds = { min: extent.start - margin, max: extent.end + margin };
    const width = host.getSize().width || 1000;

    const restored = initialRef.current;
    renderer.setViewport(
      restored
        ? fitTo(restored.centre - restored.span / 2, restored.centre + restored.span / 2, width, bounds, 0)
        : fitTo(extent.start, extent.end, width, bounds, 0.01),
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
      getBounds: () => bounds,
    });

    const onMove = (event: PointerEvent) => {
      renderer.setHover(event.clientX - frame.getBoundingClientRect().left);
      host.requestDraw();
    };
    const onLeave = () => {
      renderer.setHover(null);
      host.requestDraw();
    };

    frame.addEventListener('pointermove', onMove);
    frame.addEventListener('pointerleave', onLeave);

    return () => {
      detach();
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('pointerleave', onLeave);
      host.destroy();
    };
  }, [events]);

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      role="img"
      aria-label={`Density of ${events.length} historical events over time. A searchable list view is planned for M2.`}
      className="h-full w-full cursor-crosshair touch-none outline-none focus-visible:ring-1 focus-visible:ring-paper-dim/40"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

import type { Connection, Era, Id, Tag, TimelineEvent } from '../core/model/types';
import { DepthRenderer } from '../render/depth-renderer';
import { attachDepthInteraction } from '../render/depth-interaction';
import { useCanvasRenderer } from './use-canvas-renderer';

/**
 * The depth view (docs/design.md §6.7).
 *
 * Deliberately the same shape as `TimelineView`, and now literally so: both
 * mount through `useCanvasRenderer`, and the corridor differs only in taking
 * gestures that know about the projection — the axis is vertical *and*
 * nonlinear, so a drag cannot be converted to a time delta by a constant. The
 * two views share a viewport model (D33), so switching between them keeps the
 * period you were looking at.
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
  revealRequest: number;
  initialViewport?: { centre: number; span: number };
  onViewportChange?: (viewport: { centre: number; span: number }) => void;
}

export function DepthView(props: DepthViewProps) {
  const { frameRef, canvasRef } = useCanvasRenderer({
    create: () => new DepthRenderer(),
    attachGestures: (frame, renderer, gestures) =>
      attachDepthInteraction(frame, {
        ...gestures,
        getProjection: () => renderer.getProjection(),
      }),
    ...props,
  });

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      role="img"
      aria-label={`${props.events.length} historical events along a corridor receding into the past, with ${props.connections.length} connections drawn as arcs. Switch to the list view for a keyboard-navigable equivalent.`}
      className="h-full w-full cursor-crosshair touch-none outline-none focus-visible:ring-1 focus-visible:ring-paper-dim/40"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

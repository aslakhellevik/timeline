import type { Connection, Era, Id, Tag, TimelineEvent } from '../core/model/types';
import { attachInteraction } from '../render/interaction';
import { TimelineRenderer } from '../render/timeline-renderer';
import { useCanvasRenderer } from './use-canvas-renderer';

/**
 * The flat timeline.
 *
 * Everything about mounting a canvas — the renderer's lifecycle, the pan
 * bounds, the click/drag discriminator, the reveal — lives in
 * `useCanvasRenderer`, which the depth view shares. What is left here is what
 * actually differs: which renderer, which gesture layer, and what a screen
 * reader is told the picture shows.
 */
export interface TimelineViewProps {
  events: readonly TimelineEvent[];
  connections: readonly Connection[];
  tags: readonly Tag[];
  eras: readonly Era[];
  /** The unfiltered corpus — sets the mass scale and the extent, see TimelineData. */
  allEvents: readonly TimelineEvent[];
  selectedId: Id | null;
  selectedConnectionId: Id | null;
  selectedEraId: Id | null;
  connectFrom: Id | null;
  onSelectEvent: (id: Id) => void;
  onSelectConnection: (id: Id) => void;
  onSelectEra: (id: Id) => void;
  /** Bumped when something asks for the selection to be brought into view. */
  revealRequest: number;
  /** Restores a bookmarked position (D24). Applied once, on mount. */
  initialViewport?: { centre: number; span: number };
  onViewportChange?: (viewport: { centre: number; span: number }) => void;
}

export function TimelineView(props: TimelineViewProps) {
  const { frameRef, canvasRef } = useCanvasRenderer({
    create: () => new TimelineRenderer(),
    attachGestures: (frame, _renderer, gestures) => attachInteraction(frame, gestures),
    ...props,
  });

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      /*
        `application`, not `img`: it is focusable, the arrows pan it and `+`/`−`
        zoom it, and a screen reader that treats it as a picture swallows every
        one of those keys. The label says what it is, what it does with the
        keyboard, and where the same data is available as text (D23).
      */
      role="application"
      aria-roledescription="timeline canvas"
      aria-label={`Density of ${props.events.length} historical events over time, with ${props.connections.length} connections drawn as arcs. Arrow keys pan and + or − zooms; press ? for the rest, or switch to the list view for a keyboard-navigable equivalent.`}
      className="h-full w-full cursor-crosshair touch-none outline-none focus-visible:ring-1 focus-visible:ring-paper-dim/40"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

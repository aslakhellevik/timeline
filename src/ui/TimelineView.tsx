import type { Connection, Era, Id, Tag, TimelineEvent } from '../core/model/types';
import { attachInteraction } from '../render/interaction';
import { TimelineRenderer } from '../render/timeline-renderer';
import { useCanvasRenderer } from './use-canvas-renderer';

/**
 * The flat timeline.
 *
 * Everything about mounting a canvas — the renderer's lifecycle, the pan
 * bounds, the click/drag discriminator, the reveal — lives in
 * `useCanvasRenderer`. What is left here is which renderer, which gesture
 * layer, and what a screen reader is told the picture shows.
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
    <div className="relative h-full w-full">
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
      {props.allEvents.length === 0 && <EmptyNote />}
    </div>
  );
}

/**
 * What to do with an empty timeline, over the canvas rather than drawn on it.
 *
 * A blank canvas is indistinguishable from a broken one, so it says how to put
 * something in — and offers the demo, for whoever wants to see a filled one
 * before typing anything. That half is a link, which is why this is DOM and not
 * the line of canvas text it used to be.
 */
function EmptyNote() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
      <div className="max-w-lg text-center text-xs leading-relaxed text-paper-dim">
        <p>
          type an event in the box above — like{' '}
          <span className="text-paper-soft">battle of lepanto 1571 #europe #war</span> — and
          press enter
        </p>
        <p className="mt-2">
          or{' '}
          <a
            href="?demo"
            className="pointer-events-auto underline underline-offset-2 hover:text-paper"
          >
            look at a demo timeline
          </a>
        </p>
      </div>
    </div>
  );
}

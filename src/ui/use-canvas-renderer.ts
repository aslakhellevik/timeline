import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type {
  Connection,
  Days,
  Era,
  Id,
  Tag,
  TimelineEvent,
  Viewport,
} from '../core/model/types';
import { CanvasHost } from '../render/canvas-host';
import type { CanvasSize } from '../render/canvas-host';
import type { Selection, Target, TimelineData } from '../render/timeline-renderer';
import { animateViewport } from '../render/viewport-animation';
import { fitTo, frameBounds } from '../render/viewport';
import type { TimeBounds } from '../render/viewport';

/**
 * Mounts a timeline canvas and gets out of its way.
 *
 * React never touches the canvas or holds the viewport: pan and zoom run at
 * animation frequency and routing them through component state would re-render
 * the tree sixty times a second for no benefit. The renderer owns the viewport;
 * this hook owns only its lifecycle.
 */

/** What the timeline renderer can do. Structural, so it does not have to know. */
export interface TimeCanvas {
  setData(data: TimelineData): void;
  setViewport(viewport: Viewport): void;
  getViewport(): Viewport;
  setHover(x: number | null, y: number | null): void;
  setSelection(selection: Selection): void;
  hitTest(x: number, y: number): Target | null;
  getExtent(): { start: Days; end: Days } | null;
  getFrame(): { start: Days; end: Days };
  revealTime(from: Days, to: Days): Viewport | null;
  draw(ctx: CanvasRenderingContext2D, size: CanvasSize): boolean;
}

/** What a gesture layer is handed. The same shape `attachInteraction` takes. */
export interface CanvasGestures {
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport, eased?: boolean) => void;
  getBounds: () => TimeBounds;
}

export interface CanvasRendererOptions<R extends TimeCanvas> {
  /** Makes the renderer. Called once, on mount. */
  create: () => R;
  /** Installs the view's own gestures and returns a detach function. */
  attachGestures: (frame: HTMLElement, renderer: R, gestures: CanvasGestures) => () => void;

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

  /** Bumped when something asks for the selection to be brought into view. */
  revealRequest: number;
  /** Restores a bookmarked position (D24). Applied once, on mount. */
  initialViewport?: { centre: number; span: number } | undefined;
  onViewportChange?: ((viewport: { centre: number; span: number }) => void) | undefined;
}

export interface CanvasRefs {
  frameRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export function useCanvasRenderer<R extends TimeCanvas>({
  create,
  attachGestures,
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
  revealRequest,
  initialViewport,
  onViewportChange,
}: CanvasRendererOptions<R>): CanvasRefs {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // The renderer and its host outlive any single render, and the callbacks are
  // reached through refs so a new function identity never tears them down.
  const rendererRef = useRef<R | null>(null);
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
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const createRef = useRef(create);
  const attachRef = useRef(attachGestures);
  const initialRef = useRef(initialViewport);

  /** Cancels the animation in flight, if any. Null when nothing is moving. */
  const stopRef = useRef<(() => void) | null>(null);
  /** The id this canvas's own click just selected — see the reveal effect. */
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

  /** Eases to `target`, replacing whatever was moving before. */
  const animateTo = useCallback(
    (target: Viewport) => {
      const renderer = rendererRef.current;
      const host = hostRef.current;
      if (!renderer || !host) return;
      stopRef.current?.();
      stopRef.current = animateViewport(host, renderer, target, { onFrame: report });
    },
    [report],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    const renderer = createRef.current();
    rendererRef.current = renderer;
    renderer.setData({ events, connections, tags, eras, calibration: allEvents });

    const host = new CanvasHost(canvas, (ctx, size) => renderer.draw(ctx, size));
    hostRef.current = host;

    // `getFrame`, not `getExtent`: eras count towards what the view may pan
    // over, and with neither it states a default. The old `{0, 1}` fallback was
    // a one-day window at the epoch, which `clamp` then read as a three-day
    // zoom limit — so a timeline with no events but a "my life" era could not
    // be zoomed out far enough to see it.
    const extent = renderer.getFrame();
    boundsRef.current = frameBounds(extent);
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

    const detach = attachRef.current(frame, renderer, {
      getViewport: () => renderer.getViewport(),
      setViewport: (viewport, eased) => {
        // A gesture always wins over an animation still in flight, or the two
        // write the viewport in turn and the canvas fights the finger.
        stopRef.current?.();
        stopRef.current = null;
        if (eased) {
          animateTo(viewport);
          return;
        }
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
      if (target?.kind === 'event') {
        // Noted before the selection lands, so the reveal below can tell a
        // selection made *here* from one that arrived from elsewhere.
        clickedRef.current = target.id;
        selectEventRef.current(target.id);
      } else if (target?.kind === 'connection') selectConnectionRef.current(target.id);
      else if (target?.kind === 'era') selectEraRef.current(target.id);
    };

    frame.addEventListener('pointermove', onMove);
    frame.addEventListener('pointerleave', onLeave);
    frame.addEventListener('pointerdown', onDown);
    frame.addEventListener('pointerup', onUp);

    return () => {
      stopRef.current?.();
      stopRef.current = null;
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

    // Whether there were *events* before, which is the thing worth refitting
    // for: the frame may already be wide because of an era, and the first event
    // can easily land outside it.
    const before = renderer.getExtent();
    renderer.setData({ events, connections, tags, eras, calibration: allEvents });
    const after = renderer.getFrame();

    boundsRef.current = frameBounds(after);
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

  /**
   * Brings the selected event into view (§5.1).
   *
   * Selecting something used to leave the picture exactly where it was, which
   * made the first thing anyone does with a link — open `#e=…` — look broken:
   * the pane described an event in 1990 while the canvas showed five thousand
   * years with a hairline somewhere in it. The renderer decides *whether* and
   * *where* (`revealTime`); this decides *when*.
   *
   * Twice not, in the two cases where moving would be wrong. A click on this
   * canvas selected something already under the pointer, and pulling the
   * picture out from under it is the view arguing with itself — so the click
   * handler above marks its own selection and this skips it. And an event
   * filtered out of this view is not there to reveal.
   *
   * The counter is what makes "show on timeline" work on an event that is
   * already selected: nothing in the selection changes, so only an explicit
   * request distinguishes the second press from the first.
   */
  useEffect(() => {
    const asked = revealRequest !== requestRef.current;
    requestRef.current = revealRequest;
    const clicked = clickedRef.current === selectedId;
    clickedRef.current = null;
    if (clicked && !asked) return;

    const renderer = rendererRef.current;
    if (!renderer || !selectedId) return;
    const event = eventsRef.current.find((candidate) => candidate.id === selectedId);
    if (!event) return;

    const target = renderer.revealTime(event.when.b, event.when.c);
    if (target) animateTo(target);
  }, [selectedId, revealRequest, animateTo]);

  return { frameRef, canvasRef };
}

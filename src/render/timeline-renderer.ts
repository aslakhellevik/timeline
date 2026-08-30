/**
 * The timeline canvas (docs/design.md §6.1).
 *
 * Framework-agnostic by rule (D11): no React, no imports from `src/ui`. It owns
 * nothing but drawing — the caller supplies data, a viewport and a hover
 * position, and gets pixels.
 *
 * What it draws, from the bottom of the zoom range up:
 *
 *   far   the density field — mass, with era-scale structure visible as shape
 *   mid   individual events resolve as marks along the baseline
 *   near  labels appear, selectively, where there is room for them
 *
 * The far→mid transition is a crossfade driven by events-per-pixel (§3.4), not by
 * a zoom-level counter, so nothing pops.
 */

import type {
  Connection,
  Days,
  Era,
  Id,
  Tag,
  TimeSpec,
  TimelineEvent,
  Viewport,
} from '../core/model/types';
import {
  DEFAULT_BETA,
  calibrateRate,
  computeDensity,
  farViewOpacity,
  heightFraction,
  lambdaRefFor,
} from '../core/density';
import type { DensityResult } from '../core/density';
import { compareTime, fromGregorian, midpoint, toGregorian } from '../core/time';
import { arcInkScale, arcPointAt, buildArcIndex, hitTestArc, layoutArcs } from './arcs';
import type { ArcLayout, ArcSource } from './arcs';
import { LABEL_INSET, LABEL_LEAD, hitTestLanes, layoutLanes } from './lanes';
import type { EraBar, LaneLayout } from './lanes';
import { MassTransition, clamp01 } from './mass-transition';
import { linearScale } from './scale';
import { pickSpan, spanBar, spanWidth } from './span-bar';
import type { SpanBar } from './span-bar';
import { generateTicks } from './ticks';
import { formatYear } from './ticks';
import { LABEL_FONT, LABEL_WIDTH, fitText, formatMoment } from './text';
import { composite, inkOn, mix, withAlpha } from './colour';
import type { CanvasSize } from './canvas-host';
import { frameBounds, revealWindow } from './viewport';

/**
 * Chart chrome and ink. Values are the validated dark-surface roles: recessive
 * grid and axis, muted tick labels, and a single sequential hue for the mass —
 * there is only one series here, so no categorical palette is in play yet.
 */
export interface TimelineTheme {
  surface: string;
  grid: string;
  gridMajor: string;
  axis: string;
  muted: string;
  ink: string;
  inkSecondary: string;
  /** Sequential hue for the density field. */
  mass: string;
  massEdge: string;
  mark: string;
  /** Arcs whose connection carries no tag colour of its own. */
  connection: string;
  /** The selected event and the arcs leaving it. */
  selection: string;
  /** Canonical era bars. */
  era: string;
  /**
   * Personal era bars — your life, your schooling, other people's.
   *
   * Not the selection hue, which is what they used to be. Yellow already means
   * "this is selected" and "this arc is being drawn"; a third meaning made the
   * band under the axis look permanently half-selected, and made a genuinely
   * selected personal era indistinguishable from an idle one. A warm neutral
   * instead: still legibly *yours* against the grey of canonical eras, without
   * claiming to be lit up.
   */
  eraPersonal: string;
}

export const DARK_THEME: TimelineTheme = {
  surface: '#1a1a19',
  grid: '#2c2c2a',
  gridMajor: '#383835',
  axis: '#383835',
  muted: '#898781',
  ink: '#ffffff',
  inkSecondary: '#c3c2b7',
  mass: '#3987e5',
  massEdge: '#86b6ef',
  mark: '#86b6ef',
  connection: '#c3c2b7',
  selection: '#ffd43b',
  era: '#6a6a64',
  eraPersonal: '#a08a6c',
};

const AXIS_HEIGHT = 30;
/**
 * Clear space above the mass.
 *
 * Enough that the tallest hill has somewhere to end. The filter bar sits
 * directly above the canvas, and a peak running into it reads as a peak that
 * has been cut off — which, before the scale was calibrated per width, is
 * exactly what it was.
 */
const TOP_PADDING = 36;
const MARK_HEIGHT = 14;
const LABEL_GAP = 14;
const LABEL_ROW_HEIGHT = 16;
const MAX_LABEL_ROWS = 12;
/** A ceiling on text drawn per frame, so a dense corpus cannot stall the loop. */
const MAX_LABELS = 160;

/** Fraction of the space above the axis that the tallest arc may occupy. */
const ARC_BAND = 0.92;
/** How close the cursor must come to a mark to select it. */
const MARK_TOLERANCE = 7;
/** Height of one era row, including its gap. */
const LANE_HEIGHT = 18;
/** Rows of eras, before the layout starts dropping them. */
const MAX_LANES = 8;

/**
 * Drawn width, in pixels, at which an event stops being a hairline and becomes
 * a bar.
 *
 * Two bandwidths. Below it the kernel is wider than the event, so the density
 * beneath shows one hill however the event was entered, and a bar would claim a
 * resolution the mass does not have. Above it the trapezoid starts to beat the
 * kernel and the two layers agree: an interval becomes an interval in both at
 * the same zoom.
 */
const MARK_BAR_THRESHOLD = 2 * DEFAULT_BETA;

/** Thickness of the crossbar that carries an event's span. */
const MARK_BAR_THICKNESS = 3;

/** Ink for a label on a light bar — the chart surface, not black. */
const DARK_INK = '#1a1a19';

/**
 * Below this, a fitted label says nothing and is not drawn.
 *
 * `the Ro…`, `the…`, `t…` — three of those in a row read as a rendering fault
 * rather than as three eras, and none of them names anything. Silence is the
 * better answer: the name is one hover away, and the bar itself is still there
 * saying what it always said, which is *when*.
 */
const MIN_LABEL_GLYPHS = 5;
/** Pixels of bar interior below which fitting a label is not worth attempting. */
const MIN_LABEL_ROOM = 26;

/**
 * What the view frames when there is nothing at all to frame: a lifetime, plus
 * a little of the future.
 *
 * Stated rather than derived, because there is nothing to derive it from. The
 * alternative — the `{0, 1}` the caller used to fall back to — is a window one
 * day wide at the epoch, and `clamp` then caps the widest zoom at three days,
 * so a first-run timeline could not be zoomed out far enough to find the "my
 * life" era sitting nineteen thousand days away.
 *
 * Exported because the depth view frames the same corpus and had the same hole
 * in it — two views disagreeing about what "nothing to show" looks like would be
 * a difference with no meaning behind it.
 */
export function DEFAULT_FRAME(now: Date = new Date()): { start: Days; end: Days } {
  const year = now.getFullYear();
  return { start: fromGregorian(year - 100, 1, 1), end: fromGregorian(year + 2, 1, 1) };
}

interface Mark {
  /** `when.b` — the sort key and the binary-search key. */
  start: Days;
  /** Where a hairline, a selection ring and an arc endpoint go. */
  mid: Days;
  event: TimelineEvent;
}

/**
 * What was actually drawn for one event this frame, kept for hit-testing.
 *
 * Against the drawing rather than against the data, for the reason the arcs
 * already are: recomputing a layout to answer "what is under the cursor" both
 * wastes work and invites the bug where the hit target has drifted a frame from
 * what the user can see. It is also the only way hit-testing can respect the
 * per-column crossfade — a mark dissolved into the mass is not a target.
 */
interface MarkLayout {
  event: TimelineEvent;
  /** Mid-point, for the selection ring and the label's leader line. */
  x: number;
  /** Drawn extent, ramps included. Equal to `x` for a hairline. */
  left: number;
  right: number;
  /** How resolved this column is: 0 is pure mass, 1 is a fully drawn mark. */
  alpha: number;
}

/** What the cursor is over. */
export type Target =
  | { kind: 'event'; id: Id; event: TimelineEvent }
  | { kind: 'connection'; id: Id; connection: Connection }
  | { kind: 'era'; id: Id; era: Era };

export interface Selection {
  eventId?: Id | null;
  connectionId?: Id | null;
  eraId?: Id | null;
  /** First endpoint of a connection being drawn; the second follows the cursor. */
  connectFrom?: Id | null;
}

/** Everything the renderer draws, in one argument. */
export interface TimelineData {
  /** What passes the filter — this is what gets drawn. */
  events: readonly TimelineEvent[];
  connections?: readonly Connection[];
  tags?: readonly Tag[];
  eras?: readonly Era[];
  /**
   * The **unfiltered** events, for calibrating the mass scale and the extent.
   *
   * This is what makes a tag filter mean something (§3.5). Recalibrating on the
   * filtered subset would redraw "history of ideas" at the same height as
   * everything, so filtering would change the shape of the curve but never its
   * weight — and weight is the whole claim of the view. Calibrated against the
   * whole corpus, filtering to a tenth of it visibly leaves a tenth of the mass,
   * and the semantic-zoom crossfade resolves what is left into marks rather than
   * letting it become an unreadable smear.
   *
   * It also keeps the pannable extent still while filters change under it.
   */
  calibration?: readonly TimelineEvent[];
}

export class TimelineRenderer {
  private theme: TimelineTheme;
  private events: readonly TimelineEvent[] = [];
  private marks: Mark[] = [];
  private viewport: Viewport = { start: 0, end: 1, width: 1 };
  private hoverX: number | null = null;
  private hoverY: number | null = null;

  private eventsById: Map<Id, TimelineEvent> = new Map();
  /** Connections reduced to times and colours, rebuilt only when the data changes. */
  private arcIndex: ArcSource[] = [];
  private eras: readonly Era[] = [];
  private tagColours: Map<Id, string> = new Map();
  private selection: Selection = {};
  /** The unfiltered corpus. Sets the mass scale and the extent — see `TimelineData`. */
  private calibrationEvents: readonly TimelineEvent[] = [];

  /** The mass redistribution animation (§3.5), shared with the depth view. */
  private readonly transition = new MassTransition();
  /**
   * The same animation for the user's own share of the mass.
   *
   * Two curves rather than one, because `mine / mine + packs` as a toggle is not
   * enough: with a pack installed and the toggle on, a wall of canonical events
   * reads as knowledge. Drawing your own share solid *inside* the total, with the
   * pack's contribution as a ghost behind it, says what the toggle only implies —
   * that the density stops meaning "what I know" the moment content arrives
   * pre-loaded (§5).
   */
  private readonly mineTransition = new MassTransition();
  private mineSpecs: TimeSpec[] = [];
  private hasPackEvents = false;
  private mineCache: { key: string; density: DensityResult } | null = null;

  /**
   * The arcs of the last frame, kept so hit-testing runs against exactly what is
   * on screen. Recomputing a layout to answer "what is under the cursor" is both
   * wasteful and a source of the classic bug where the hit target has drifted a
   * frame away from the thing the user can see.
   */
  private arcs: ArcLayout[] = [];
  private lanes: LaneLayout = { bars: [], laneCount: 0, dropped: 0 };
  private markLayout: MarkLayout[] = [];
  /**
   * Share of the visible events that resolved into marks this frame.
   *
   * The frame-wide "how near are we" signal, now that the crossfade is per
   * column (D50). `farViewOpacity(lambdaMax)` cannot serve: it answers with the
   * busiest column, so one dense century says the whole frame is far even when
   * everything else on it has long since resolved.
   */
  private resolvedShare = 0;
  private baselineY = 0;
  private laneTop = 0;

  /**
   * The corpus peak in events per **day**, calibrated once per corpus (§3.4).
   *
   * A rate rather than a λ. λ counts events in a pixel column, so it scales
   * with `span / width`: a λ_ref calibrated at one canvas size is simply the
   * wrong number at another, and the version of this that fixed the
   * calibration at 1600 px drew eleven columns clipped flat at 1100 px and
   * seventeen at 390 px — different centuries at identical heights, which is
   * the one thing the far view exists to prevent. `lambdaRefFor` turns the rate
   * back into a λ for whatever width the frame turns out to be.
   */
  private rateRef = 0;
  /** What the view frames and may pan over — see `getFrame`. */
  private frame: { start: Days; end: Days } = DEFAULT_FRAME();

  private cache: { key: string; density: DensityResult } | null = null;
  /**
   * Bumped whenever the data changes.
   *
   * The cache key used to carry `events.length`, which cannot tell "one event
   * edited" from "nothing happened" — an edited time then kept the previous
   * frame's density until the viewport moved.
   */
  private dataVersion = 0;
  /** Every visible event's `when`, hoisted out of the per-frame cache miss. */
  private specs: TimeSpec[] = [];
  /**
   * Truncated titles, by title. `fitText` binary-searches with `measureText`,
   * which is the single most expensive call in the label pass, and the same
   * titles come back every frame.
   */
  private fitCache = new Map<string, string>();
  /** Prefix maximum of `when.d` over `marks`, for the backward visibility scan. */
  private maxEnd = new Float64Array(0);

  constructor(theme: TimelineTheme = DARK_THEME) {
    this.theme = theme;
  }

  setData(data: TimelineData): void {
    const { events, connections = [], tags = [], eras = [] } = data;
    const calibration = data.calibration ?? events;
    const recalibrate = calibration !== this.calibrationEvents;

    this.events = events;
    // The documented sort key, `b → a → title → id` (§1): fully deterministic,
    // so draw order never flickers between frames. Sorting by the midpoint —
    // which is what this did — reorders `1914–1918` against `1916` for no
    // reason a reader could name.
    this.marks = events
      .map((event) => ({ start: event.when.b, mid: midpoint(event.when), event }))
      .sort(
        (x, y) =>
          compareTime(x.event.when, y.event.when) ||
          compareStrings(x.event.title, y.event.title) ||
          compareStrings(x.event.id, y.event.id),
      );
    // Prefix maximum of `d`, so the backward scan for events that begin before
    // the window but reach into it has somewhere to stop. Without it a bar is
    // simply missing whenever you zoom inside a long interval.
    this.maxEnd = new Float64Array(this.marks.length);
    let reach = -Infinity;
    for (let i = 0; i < this.marks.length; i++) {
      reach = Math.max(reach, (this.marks[i] as Mark).event.when.d);
      this.maxEnd[i] = reach;
    }
    this.specs = events.map((event) => event.when);
    this.eventsById = new Map(events.map((event) => [event.id, event]));
    // Split once, so the mass can be drawn in two layers (§5).
    this.mineSpecs = events.filter((event) => event.pack === undefined).map((event) => event.when);
    this.hasPackEvents = this.mineSpecs.length !== events.length;
    this.tagColours = new Map(
      tags.flatMap((tag) => (tag.color ? [[tag.id, tag.color] as const] : [])),
    );
    this.arcIndex = buildArcIndex(
      connections,
      this.eventsById,
      (event) => midpoint(event.when),
      this.tagColours,
      this.theme.connection,
    );
    this.eras = eras;
    this.calibrationEvents = calibration;

    // The old grid is still in the cache; the next draw compares it with the new
    // one and animates between them if the viewport has not moved.
    this.transition.begin();
    this.mineTransition.begin();
    this.cache = null;
    this.mineCache = null;
    this.fitCache.clear();
    this.markLayout = [];
    this.dataVersion += 1;
    this.frame = this.computeFrame();
    // Only when the corpus itself changed. Doing it on every filter change is
    // exactly the renormalisation `TimelineData.calibration` exists to prevent.
    if (recalibrate) this.rateRef = this.calibrate();
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  setHover(x: number | null, y: number | null = null): void {
    this.hoverX = x;
    this.hoverY = y;
  }

  setSelection(selection: Selection): void {
    this.selection = selection;
  }

  /**
   * What is under a point: a mark first, then an arc.
   *
   * Marks win ties because they are the smaller target and the one the user is
   * usually reaching for — an arc is wide and forgiving, a mark is a hairline,
   * and having the arc steal a click near the axis makes events near a busy
   * bundle unselectable.
   */
  hitTest(x: number, y: number): Target | null {
    // Below the axis is era territory and nothing else lives there, so it is
    // checked first and cheaply.
    if (y >= this.laneTop) {
      const bar = hitTestLanes(this.lanes, x, y, this.laneTop, LANE_HEIGHT);
      return bar ? { kind: 'era', id: bar.era.id, era: bar.era } : null;
    }

    const event = this.eventAt(x, y);
    if (event) return { kind: 'event', id: event.id, event };

    const arc = hitTestArc(this.arcs, x, y, this.baselineY);
    return arc ? { kind: 'connection', id: arc.connection.id, connection: arc.connection } : null;
  }

  /**
   * The event drawn under `x`, if the point is in the mark band.
   *
   * Against the **span**, not the distance to a midpoint. `1914–1918` is drawn
   * as a bar four years wide, and asking the user to click its mean because
   * that is where the old hairline used to be would be a hit target that
   * disagrees with the picture.
   *
   * Tolerance scales with how resolved the mark is, so a mark still dissolved
   * into the mass is not a target: clicking empty-looking canvas used to select
   * whatever invisible event happened to be nearest.
   */
  eventAt(x: number, y: number): TimelineEvent | null {
    // Generous above the marks and below the axis: the tick is 14px tall and
    // aiming at a hairline is not a reasonable thing to ask of anyone.
    if (y < this.baselineY - MARK_HEIGHT - 8 || y > this.baselineY + 10) return null;
    return pickSpan(this.markLayout, x, MARK_TOLERANCE)?.event ?? null;
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  /**
   * Full extent of the corpus, for the initial view and the pan bounds.
   *
   * Of the *unfiltered* corpus: the range you can pan over should not shrink
   * because you filtered to art history, or the view would jump every time a
   * filter changed.
   */
  getExtent(): { start: Days; end: Days } | null {
    const source = this.calibrationEvents.length > 0 ? this.calibrationEvents : this.events;
    if (source.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const event of source) {
      if (event.when.a < min) min = event.when.a;
      if (event.when.d > max) max = event.when.d;
    }
    return { start: min, end: max };
  }

  /**
   * The range the view frames and may pan over: events **and eras**, or a
   * stated default when there is neither.
   *
   * Eras belong in it because personal eras always show (D22), and a range
   * computed from events alone leaves "my life" nineteen thousand days
   * off-screen on a timeline that has no events yet — with the pan bounds so
   * narrow that `clamp` capped the widest span at three days and the user could
   * not zoom out to look for it.
   */
  getFrame(): { start: Days; end: Days } {
    return this.frame;
  }

  /**
   * The window that would bring `[from, to]` into view, or `null` when it is
   * already there (§6.1).
   *
   * The decision lives here rather than in the view because the bounds it has
   * to respect come from the frame, which is this object's business; the view
   * owns only the animation to the answer.
   */
  revealTime(from: Days, to: Days): Viewport | null {
    return revealWindow(this.viewport, from, to, frameBounds(this.frame));
  }

  /** Recomputed on a data change only: every frame reads it to scale the mass. */
  private computeFrame(): { start: Days; end: Days } {
    const extent = this.getExtent();
    let min = extent ? extent.start : Infinity;
    let max = extent ? extent.end : -Infinity;

    for (const era of this.eras) {
      if (era.deleted_at) continue;
      if (era.when.a < min) min = era.when.a;
      if (era.when.d > max) max = era.when.d;
    }

    if (!(min < max)) return DEFAULT_FRAME();
    return { start: min, end: max };
  }

  private calibrate(): number {
    const source = this.calibrationEvents.length > 0 ? this.calibrationEvents : this.events;
    return calibrateRate(
      source.map((event) => event.when),
      this.frame,
    );
  }

  /** λ that counts as full height on the canvas this frame is being drawn at. */
  private lambdaRef(width: number): number {
    return lambdaRefFor(this.rateRef, this.frame.end - this.frame.start, width);
  }

  private viewportKey(): string {
    const { start, end, width } = this.viewport;
    return `${start}:${end}:${width}`;
  }

  private density(): DensityResult {
    const key = `${this.viewportKey()}:${this.dataVersion}`;
    if (this.cache && this.cache.key === key) return this.cache.density;

    const density = computeDensity(this.specs, this.viewport);
    this.cache = { key, density };
    return density;
  }

  /** The same grid over the user's own events only. */
  private mineDensity(): DensityResult {
    const key = `${this.viewportKey()}:${this.dataVersion}`;
    if (this.mineCache && this.mineCache.key === key) return this.mineCache.density;
    const density = computeDensity(this.mineSpecs, this.viewport);
    this.mineCache = { key, density };
    return density;
  }

  private displayDensity(now: number): { density: DensityResult; animating: boolean } {
    return this.transition.resolve(this.density(), this.viewportKey(), now);
  }

  /** First mark whose likely start is at or after `t`. */
  private lowerBound(t: Days): number {
    let lo = 0;
    let hi = this.marks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.marks[mid] as Mark).start < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * First mark that can reach into the window starting at `t`.
   *
   * Marks are ordered by their likely start, so `lowerBound` misses everything
   * that began earlier and is still going — which, once events are drawn as
   * bars, is exactly the interval you zoomed into the middle of. The prefix
   * maximum of `d` bounds how far back that walk has to go.
   */
  private firstVisible(t: Days): number {
    let i = this.lowerBound(t);
    while (i > 0 && (this.maxEnd[i - 1] as number) >= t) i -= 1;
    return i;
  }

  /**
   * Paints one frame. Returns whether an animation is still running, so the
   * host knows to schedule another.
   */
  draw(ctx: CanvasRenderingContext2D, size: CanvasSize): boolean {
    const { width, height } = size;
    const theme = this.theme;

    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, width, height);

    if (height < AXIS_HEIGHT + 40 || width < 40) return false;

    const vp = { ...this.viewport, width };
    this.viewport = vp;

    // Lanes first, because how many rows the eras need decides where the axis
    // sits. They depend only on x positions, so there is no circularity.
    this.lanes = this.layoutEraLanes(ctx, vp, height);
    const eraBand = this.lanes.laneCount * LANE_HEIGHT;

    const baselineY = height - AXIS_HEIGHT - eraBand;
    const massTop = TOP_PADDING;
    const massHeight = baselineY - massTop;
    this.baselineY = baselineY;
    this.laneTop = baselineY + AXIS_HEIGHT;

    const ticks = generateTicks(vp);
    this.drawGrid(ctx, ticks, massTop, baselineY);

    const now = performance.now();
    const { density, animating } = this.displayDensity(now);
    const lambdaRef = this.lambdaRef(width);
    const massAlpha = farViewOpacity(density.lambdaMax);

    if (massAlpha > 0) {
      if (this.hasPackEvents) {
        // The total first, desaturated — the pack's contribution is whatever is
        // visible outside the solid curve drawn over it.
        this.drawMass(ctx, density, density, baselineY, massHeight, lambdaRef, 0.55, true);
        const mine = this.mineTransition.resolve(this.mineDensity(), this.viewportKey(), now);
        this.drawMass(ctx, mine.density, density, baselineY, massHeight, lambdaRef, 1, false);
      } else {
        this.drawMass(ctx, density, density, baselineY, massHeight, lambdaRef, 1, false);
      }
    }

    // Arcs over the mass and under the marks. The mass is the ground — what you
    // know — and the connections are the figure on it, which is the reading the
    // concept asks for: zoomed out, the connection structure should be the most
    // visually striking thing on screen.
    this.arcs = this.layout(vp, baselineY, massHeight);
    this.drawArcs(ctx, baselineY);

    // Always: the crossfade is per column now (D50), so a lone event in 400 BC
    // resolves into a mark while the twentieth century is still solid mass.
    this.drawMarks(ctx, vp, density, baselineY);
    this.drawLabels(ctx, vp, massTop, baselineY);

    this.drawSelection(ctx, vp, baselineY, massTop);
    this.drawPendingArc(ctx, vp, baselineY, massHeight);
    this.drawAxis(ctx, ticks, vp, baselineY, width, height);
    this.drawEras(ctx, this.laneTop);
    this.drawEmptyNote(ctx, vp, density, massTop, baselineY);
    this.drawCrosshair(ctx, vp, massTop, baselineY);

    return animating;
  }

  private layoutEraLanes(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    height: number,
  ): LaneLayout {
    if (this.eras.length === 0) return { bars: [], laneCount: 0, dropped: 0 };
    // Never let the eras crowd out the timeline itself: at most a third of the
    // canvas, whatever the corpus does.
    const affordable = Math.floor((height * 0.33) / LANE_HEIGHT);

    ctx.save();
    ctx.font = LABEL_FONT;
    const layout = layoutLanes(this.eras, (t) => linearScale.toPx(t, vp), vp.width, {
      maxLanes: Math.max(1, Math.min(MAX_LANES, affordable)),
      tagColours: this.tagColours,
      canonicalColour: this.theme.era,
      personalColour: this.theme.eraPersonal,
      labelWidth: (era) => Math.min(LABEL_WIDTH.era, ctx.measureText(era.name).width),
    });
    ctx.restore();
    return layout;
  }

  /**
   * Era bars below the axis.
   *
   * The uncertain flanks are drawn as gradients rather than as edges, which is
   * the only honest way to render "the years I was reading Russian novels" — an
   * era whose `a`≠`b` has no first day, and a crisp edge would claim it does.
   */
  private drawEras(ctx: CanvasRenderingContext2D, top: number): void {
    if (this.lanes.bars.length === 0 && this.lanes.dropped === 0) return;
    const selected = this.selection.eraId ?? null;

    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';

    for (const bar of this.lanes.bars) {
      const y = top + bar.lane * LANE_HEIGHT;
      const barY = y + 2;
      const barHeight = LANE_HEIGHT - 5;
      const isSelected = bar.era.id === selected;

      const left = bar.x1 - bar.fadeLeft;
      const right = bar.x2 + bar.fadeRight;
      if (right - left < 1) continue;

      const alpha = isSelected ? 0.85 : 0.5;
      ctx.fillStyle = this.spanGradient(ctx, bar, bar.colour, alpha);
      ctx.beginPath();
      ctx.roundRect(left, barY, right - left, barHeight, 2);
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = bar.colour;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      this.drawEraLabel(ctx, bar, barY + barHeight / 2 + 0.5, alpha, isSelected);
    }

    // Dropped eras are counted and never drawn, so the count is the only thing
    // that can say the band is incomplete. Nonzero means the view is lying.
    if (this.lanes.dropped > 0) {
      const note = `+${this.lanes.dropped} era${this.lanes.dropped === 1 ? '' : 's'}`;
      ctx.fillStyle = this.theme.muted;
      ctx.textAlign = 'right';
      ctx.fillText(note, this.viewport.width - 4, top + 2 + (LANE_HEIGHT - 5) / 2);
      ctx.textAlign = 'left';
    }

    // The hovered era, named in full over everything else. Layers (a) and (b)
    // between them cover most bars; this covers the rest, and is the only way
    // to read a sliver twelve pixels wide.
    const hovered =
      this.hoverX !== null && this.hoverY !== null
        ? hitTestLanes(this.lanes, this.hoverX, this.hoverY, top, LANE_HEIGHT)
        : null;
    if (hovered) this.drawChip(ctx, hovered.era.name, this.hoverX ?? 0, top - 4);

    ctx.restore();
  }

  /**
   * An era's name: inside its bar, beside it, or not at all.
   *
   * Never by widening the bar. A bar's width is a claim about how long
   * something lasted, and stretching it to hold six more glyphs is a lie about
   * the world — so a name too long for its bar is set to the right of it with a
   * leader, in the bar's own colour, and `layoutLanes` has already reserved the
   * room. Below about four glyphs nothing is drawn at all: `the Ro…` and
   * `the…` name nothing, and three of them in a row read as a rendering fault
   * rather than as eras.
   */
  private drawEraLabel(
    ctx: CanvasRenderingContext2D,
    bar: EraBar,
    centreY: number,
    alpha: number,
    isSelected: boolean,
  ): void {
    if (bar.labelWidth <= 0) return;
    const width = this.viewport.width;

    if (bar.labelOutside) {
      const x = Math.min(bar.x2 + bar.fadeRight, width) + LABEL_LEAD;
      const room = Math.min(LABEL_WIDTH.era, width - x - 4);
      if (room < MIN_LABEL_ROOM) return;
      const text = this.fit(ctx, bar.era.name, room);
      if (text.length < MIN_LABEL_GLYPHS) return;

      ctx.strokeStyle = withAlpha(bar.colour, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - LABEL_LEAD + 2, centreY);
      ctx.lineTo(x - 3, centreY);
      ctx.stroke();

      // Tinted with the bar, mixed toward the secondary ink so a dark tag
      // colour is still legible on the dark surface.
      ctx.fillStyle = mix(bar.colour, this.theme.inkSecondary, isSelected ? 0.7 : 0.45);
      ctx.fillText(text, x, centreY);
      return;
    }

    // Inside: against the visible part of the bar, not its true start, so an
    // era running off the left edge stays named.
    const left = Math.max(bar.x1 - bar.fadeLeft, 4);
    const right = Math.min(bar.x2 + bar.fadeRight, width - 4);
    const room = right - left - LABEL_INSET;
    if (room < MIN_LABEL_ROOM) return;

    const text = this.fit(ctx, bar.era.name, room);
    if (text.length < MIN_LABEL_GLYPHS) return;

    ctx.fillStyle = isSelected
      ? this.theme.ink
      : inkOn(composite(bar.colour, this.theme.surface, alpha), DARK_INK, this.theme.inkSecondary);
    ctx.fillText(text, left + LABEL_INSET / 2, centreY);
  }

  /** A one-line note in a chip of the surface colour, centred on `x`. */
  private drawChip(ctx: CanvasRenderingContext2D, text: string, x: number, bottomY: number): void {
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const label = this.fit(ctx, text, LABEL_WIDTH.arcNote);
    const width = ctx.measureText(label).width;
    const boxX = Math.min(Math.max(x - width / 2 - 6, 2), this.viewport.width - width - 14);

    ctx.fillStyle = this.theme.surface;
    ctx.globalAlpha = 0.94;
    ctx.beginPath();
    ctx.roundRect(boxX, bottomY - 17, width + 12, 17, 3);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.ink;
    ctx.fillText(label, boxX + 6, bottomY - 8.5);
    ctx.restore();
  }

  private layout(vp: Viewport, baselineY: number, massHeight: number): ArcLayout[] {
    if (this.arcIndex.length === 0) return [];
    return layoutArcs(this.arcIndex, (t) => linearScale.toPx(t, vp), vp.width, {
      baselineY,
      maxApex: massHeight * ARC_BAND,
    });
  }

  /**
   * Strokes the arcs additively.
   *
   * `lighter` is what makes a bundle of connections read as structure rather
   * than as one thick line: where several arcs cross, the crossing brightens in
   * proportion to how many, so the busiest regions of someone's thinking show up
   * without anything having to count them. Normal alpha compositing saturates
   * after three or four overlaps and the information is gone.
   */
  private drawArcs(ctx: CanvasRenderingContext2D, baselineY: number): void {
    if (this.arcs.length === 0) return;

    const selected = this.selection.connectionId ?? null;
    const hovered =
      this.hoverX !== null && this.hoverY !== null
        ? hitTestArc(this.arcs, this.hoverX, this.hoverY, baselineY)
        : null;

    // Only an event that has arcs is worth dimming the others for. Selecting an
    // unconnected event would otherwise blank the whole structure to emphasise
    // nothing at all, which is how the canvas looked before this line existed.
    const candidate = this.selection.eventId ?? null;
    const focus =
      candidate !== null &&
      this.arcs.some((arc) => arc.connection.from === candidate || arc.connection.to === candidate)
        ? candidate
        : null;

    /*
     * Additive compositing has no ceiling — which is the property that makes a
     * bundle read as structure, and also what turns two thousand arcs over the
     * modern peak into a flat white slab where two hundred crossings and two
     * thousand look identical. Ink per stroke falls as the count grows, so the
     * total still rises and a busier region still reads as busier.
     */
    const ink = arcInkScale(this.arcs.length);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const arc of this.arcs) {
      const touchesFocus =
        focus !== null && (arc.connection.from === focus || arc.connection.to === focus);
      const emphasised = arc.connection.id === selected || arc === hovered;

      // Selecting an event dims everything it does not touch, which turns the
      // canvas into an answer to "what does this connect to" without a mode.
      ctx.globalAlpha = emphasised || touchesFocus
        ? 0.95
        : (focus !== null ? 0.12 : arc.whole ? 0.5 : 0.28) * ink;
      ctx.lineWidth = emphasised ? 2.4 : touchesFocus ? 1.8 : 1.1;
      ctx.strokeStyle = arc.connection.id === selected ? this.theme.selection : arc.colour;

      ctx.beginPath();
      ctx.moveTo(arc.x1, baselineY);
      ctx.quadraticCurveTo(arc.cx, arc.cy, arc.x2, baselineY);
      ctx.stroke();
    }

    ctx.restore();

    // The note at the apex, for the one arc under the cursor. A connection whose
    // reasoning is invisible until you click it is just an edge, and the whole
    // claim of the project is that the reasoning is the content.
    const labelled = hovered ?? this.arcs.find((arc) => arc.connection.id === selected) ?? null;
    if (labelled) this.drawArcNote(ctx, labelled, baselineY);
  }

  private drawArcNote(ctx: CanvasRenderingContext2D, arc: ArcLayout, baselineY: number): void {
    const note = arc.connection.note.trim();
    if (note.length === 0) return;

    const apex = arcPointAt(arc, 0.5, baselineY);
    ctx.save();
    ctx.font = LABEL_FONT;
    const text = fitText(ctx, firstLine(note), LABEL_WIDTH.arcNote);
    const width = ctx.measureText(text).width;
    const x = Math.min(Math.max(apex.x - width / 2, 6), this.viewport.width - width - 6);
    const y = Math.max(12, apex.y - 8);

    ctx.fillStyle = this.theme.surface;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.roundRect(x - 5, y - 11, width + 10, 16, 3);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.ink;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** The arc being drawn: from the first endpoint to wherever the cursor is. */
  private drawPendingArc(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    baselineY: number,
    massHeight: number,
  ): void {
    const from = this.selection.connectFrom;
    if (!from || this.hoverX === null) return;
    const source = this.eventsById.get(from);
    if (!source) return;

    const x1 = linearScale.toPx(midpoint(source.when), vp);
    const x2 = this.hoverX;
    const apex = Math.min(massHeight * ARC_BAND, 10 + Math.sqrt(Math.abs(x2 - x1)) * 6);

    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = this.theme.selection;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, baselineY);
    ctx.quadraticCurveTo((x1 + x2) / 2, baselineY - 2 * apex, x2, baselineY);
    ctx.stroke();
    ctx.restore();
  }

  /** A ring on the selected event's mark, so the pane and the canvas agree. */
  private drawSelection(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    baselineY: number,
    top: number,
  ): void {
    const id = this.selection.eventId;
    if (!id) return;
    const event = this.eventsById.get(id);
    if (!event) return;

    const x = linearScale.toPx(midpoint(event.when), vp);
    if (x < -20 || x > vp.width + 20) return;

    ctx.save();
    ctx.strokeStyle = this.theme.selection;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, baselineY);
    ctx.lineTo(Math.round(x) + 0.5, top);
    ctx.globalAlpha = 0.35;
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, baselineY - MARK_HEIGHT, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.selection;
    ctx.fill();
    ctx.restore();
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    ticks: ReturnType<typeof generateTicks>,
    top: number,
    bottom: number,
  ): void {
    ctx.lineWidth = 1;
    for (const tick of ticks) {
      // Half-pixel offset keeps a one-pixel rule crisp rather than smeared
      // across two rows of device pixels.
      const x = Math.round(linearScale.toPx(tick.t, this.viewport)) + 0.5;
      ctx.strokeStyle = tick.major ? this.theme.gridMajor : this.theme.grid;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
  }

  /**
   * The density field, faded **per column** (D50).
   *
   * `crossfade` is the total density, which is what decides how resolved a
   * column is; `density` is the layer being drawn, which may be only the user's
   * own share of it (§5). One number for the whole frame — `farViewOpacity` of
   * the busiest column — was the old rule, and it says the frame is dense
   * because its busiest part is: with the twentieth century on screen, an
   * isolated event in 400 BC never resolved into anything, at any zoom short of
   * panning the modern peak off the edge.
   *
   * The fade is a horizontal gradient rather than a per-column fill, which also
   * costs the vertical ramp the fill used to have — a canvas gradient runs in
   * one direction only. The height of the curve stands in for it: tall columns
   * take the bright end, shallow ones the dim end, so a peak still reads as
   * denser ink and not merely as a taller silhouette.
   */
  private drawMass(
    ctx: CanvasRenderingContext2D,
    density: DensityResult,
    crossfade: DensityResult,
    baselineY: number,
    massHeight: number,
    lambdaRef: number,
    alpha: number,
    muted: boolean,
  ): void {
    const { lambda } = density;
    const n = lambda.length;
    if (n === 0) return;

    const fractionAt = (i: number) => heightFraction(lambda[i] as number, lambdaRef);
    const yAt = (i: number) => baselineY - fractionAt(i) * massHeight;

    const fill = muted ? this.theme.muted : this.theme.mass;
    const edge = muted ? this.theme.muted : this.theme.massEdge;
    const dim = muted ? 0.14 : 0.2;
    const bright = muted ? 0.36 : 0.62;

    const fillGradient = ctx.createLinearGradient(0, 0, n, 0);
    const edgeGradient = ctx.createLinearGradient(0, 0, n, 0);
    // Every ~16 px is fine enough that the eye reads a gradient rather than a
    // ladder, and coarse enough that a 2000 px canvas costs 125 stops.
    const step = Math.max(1, Math.round(n / Math.max(1, Math.ceil(n / 16))));
    for (let i = 0; i < n; i += step) {
      const resolved = farViewOpacity(crossfade.lambda[i] as number);
      const stop = clamp01(i / Math.max(1, n - 1));
      const ink = resolved * (dim + (bright - dim) * fractionAt(i));
      fillGradient.addColorStop(stop, withAlpha(fill, ink));
      edgeGradient.addColorStop(stop, withAlpha(edge, resolved));
    }
    const last = n - 1;
    const lastResolved = farViewOpacity(crossfade.lambda[last] as number);
    fillGradient.addColorStop(
      1,
      withAlpha(fill, lastResolved * (dim + (bright - dim) * fractionAt(last))),
    );
    edgeGradient.addColorStop(1, withAlpha(edge, lastResolved));

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    for (let i = 0; i < n; i++) ctx.lineTo(i, yAt(i));
    ctx.lineTo(n - 1, baselineY);
    ctx.closePath();
    ctx.fillStyle = fillGradient;
    ctx.fill();

    // A thin bright edge is what makes the shape legible; the fill alone reads
    // as a smudge at the shallow end.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(i, yAt(i));
      else ctx.lineTo(i, yAt(i));
    }
    ctx.strokeStyle = edgeGradient;
    ctx.lineWidth = muted ? 1 : 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Events along the baseline — each one its own trapezoid (D49).
   *
   * An event is drawn the same way an era is: solid between `b` and `c`, ramps
   * to transparent over `a`→`b` and `c`→`d`. A hairline at the mean is what
   * this used to do, and it made `1914–1918` and a single day in 1916
   * indistinguishable — while the mass underneath plainly disagreed, drawing
   * one as a four-year plateau and the other as a spike. Between a quarter and
   * two fifths of a real corpus is non-instant, so this was not an edge case.
   *
   * It collapses back to the hairline below `MARK_BAR_THRESHOLD`, which is the
   * zoom at which the trapezoid starts to beat the kernel in the density — so
   * the two layers agree about when an interval becomes an interval.
   */
  private drawMarks(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    crossfade: DensityResult,
    baselineY: number,
  ): void {
    const toPx = (t: Days) => linearScale.toPx(t, vp);
    const from = this.firstVisible(vp.start);
    const layout: MarkLayout[] = [];
    let visible = 0;

    ctx.save();
    ctx.lineWidth = 1;

    for (let i = from; i < this.marks.length; i++) {
      const mark = this.marks[i] as Mark;
      if (mark.start > vp.end) break;

      // The event's own column decides how resolved it is. Its midpoint, not
      // its span: a wide fuzzy event has no single column, and the middle is
      // where the reader looks for it.
      //
      // Tested before the geometry, and that ordering is the whole cost model
      // at 50k events: zoomed out, almost every mark is dissolved into the mass,
      // and this leaves the loop as arithmetic with nothing allocated in it.
      const x = toPx(mark.mid);
      const resolved = 1 - farViewOpacity(this.lambdaAt(crossfade, x));
      const drawn = resolved >= 0.03;

      const bar = drawn ? this.barFor(mark.event.when, toPx, vp.width) : null;
      const left = bar ? bar.x1 - bar.fadeLeft : x;
      const right = bar ? bar.x2 + bar.fadeRight : x;
      if (right < -8 || left > vp.width + 8) continue;
      visible += 1;
      if (!drawn) continue;

      /*
       * Pack events are drawn dimmer and shorter (§5). The distinction is not
       * decoration: if installed content looks like your own, the density plot
       * stops meaning "what I know", which is the semantic problem the whole
       * pack design is arranged around. Shorter as well as dimmer, because
       * colour alone is not a distinction everyone can see.
       */
      const fromPack = mark.event.pack !== undefined;
      const alpha = resolved * (fromPack ? 0.4 : 1);
      const height = fromPack ? MARK_HEIGHT * 0.6 : MARK_HEIGHT;
      const hue = fromPack ? this.theme.muted : this.theme.mark;

      layout.push({ event: mark.event, x, left, right, alpha: resolved });

      ctx.globalAlpha = alpha;
      // The stem: every event has one, at its likely middle, and it is what the
      // selection ring, the arcs and the label's leader all attach to.
      ctx.strokeStyle = hue;
      ctx.beginPath();
      const stem = Math.round(x) + 0.5;
      ctx.moveTo(stem, baselineY);
      ctx.lineTo(stem, baselineY - height);
      ctx.stroke();

      if (bar) {
        /*
         * The span, as a crossbar over the stem.
         *
         * The era band's shape, but a ribbon rather than a block. Filled to the
         * full height of the mark it reads honestly for one event and becomes a
         * wall for thirty: this corpus has thirty-eight multi-year events
         * overlapping any given decade of the twentieth century, and thirty-eight
         * translucent blocks are a solid strip at any alpha. Three pixels of
         * ribbon carry the same two facts — where it starts, where it stops —
         * and leave the stems underneath individually countable.
         */
        ctx.fillStyle = this.spanGradient(ctx, bar, hue, 0.6);
        ctx.fillRect(left, baselineY - height, right - left, MARK_BAR_THICKNESS);
        // Ticks down from the certain corners: `b`→`c` is where the event claims
        // to have definitely been happening, and the ramps are not.
        ctx.beginPath();
        for (const edge of [bar.x1, bar.x2]) {
          if (edge < -4 || edge > vp.width + 4) continue;
          const px = Math.round(edge) + 0.5;
          ctx.moveTo(px, baselineY - height);
          ctx.lineTo(px, baselineY - height + MARK_BAR_THICKNESS + 3);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
    this.markLayout = layout;
    this.resolvedShare = visible === 0 ? 0 : layout.filter((m) => m.alpha >= 0.6).length / visible;
  }

  /**
   * `fitText`, memoised per (text, width).
   *
   * The binary search inside it calls `measureText` a dozen times, which is the
   * most expensive thing the label pass does, and the same titles arrive every
   * frame. Cleared in `setData`, since that is the only thing that can change
   * the answer for a given width.
   */
  private fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    // Quantised, or panning would miss the cache on every frame.
    const bucket = Math.round(maxWidth / 4) * 4;
    const key = `${bucket}:${text}`;
    const hit = this.fitCache.get(key);
    if (hit !== undefined) return hit;

    const fitted = fitText(ctx, text, bucket);
    this.fitCache.set(key, fitted);
    return fitted;
  }

  /**
   * Bar geometry for an event, or `null` when it should stay a hairline.
   *
   * Two conditions, and `mode` is the interesting one. `1848` is stored as a
   * whole year — an instant "widened by granularity" (§2.2) — so its numbers
   * are shaped exactly like an interval's, and drawing every year-granularity
   * event as a year-wide bar turns a decade of a real corpus into one
   * continuous strip along the axis. `mode` is what separates them, and it is
   * in the model precisely because the numbers cannot: an instant claims *then*
   * and an interval claims *from-to*. The granularity of an instant is a
   * statement about precision, and the density's kernel is where it belongs.
   */
  private barFor(when: TimeSpec, toPx: (t: Days) => number, width: number): SpanBar | null {
    if (when.mode === 'instant') return null;
    if (spanWidth(when, toPx) < MARK_BAR_THRESHOLD) return null;
    return spanBar(when, toPx, width);
  }

  /** λ at the column `x` falls in, clamped to the grid. */
  private lambdaAt(density: DensityResult, x: number): number {
    const n = density.lambda.length;
    if (n === 0) return 0;
    const i = Math.min(n - 1, Math.max(0, Math.round(x)));
    return density.lambda[i] as number;
  }

  /**
   * The trapezoid as a gradient: solid across `b`→`c`, transparent at `a` and
   * `d`. Shared by era bars and event marks, since they are the same shape.
   */
  private spanGradient(
    ctx: CanvasRenderingContext2D,
    bar: SpanBar,
    colour: string,
    alpha: number,
  ): CanvasGradient | string {
    const left = bar.x1 - bar.fadeLeft;
    const right = bar.x2 + bar.fadeRight;
    if (!(right - left > 0)) return withAlpha(colour, alpha);

    const gradient = ctx.createLinearGradient(left, 0, right, 0);
    const solid = withAlpha(colour, alpha);
    const clear = withAlpha(colour, 0);
    // Stops at the trapezoid's own corners, so the ramp is the stated
    // uncertainty rather than a decorative fade of arbitrary width.
    gradient.addColorStop(0, bar.fadeLeft > 0 ? clear : solid);
    gradient.addColorStop(clamp01((bar.x1 - left) / (right - left)), solid);
    gradient.addColorStop(clamp01((bar.x2 - left) / (right - left)), solid);
    gradient.addColorStop(1, bar.fadeRight > 0 ? clear : solid);
    return gradient;
  }

  /**
   * Titles, where there is room for them.
   *
   * Gated on the mark, not on the frame. §6.1 always said labels appear on
   * "available label width without collision" and nothing else; the frame-wide
   * `farViewOpacity < 0.35` test bolted on top of that broke down as soon as
   * the crossfade went per column (D50), because a single busy century then
   * silenced every label on screen — including the ones on marks the same frame
   * had just resolved out of the mass. A label now fades in with its own mark.
   */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    top: number,
    baselineY: number,
  ): void {
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'alphabetic';

    // Greedy placement down a stack of rows: a label takes the first row where
    // it clears whatever was last placed there. Selective by construction — a
    // label appears only where one fits — but it fills the space the vanished
    // mass leaves behind, which two alternating rows did not.
    const available = baselineY - MARK_HEIGHT - 8 - top;
    const affordable = Math.max(
      1,
      Math.min(MAX_LABEL_ROWS, Math.floor(available / LABEL_ROW_HEIGHT)),
    );
    // How many of those rows are used depends on how near the view is. The far
    // view is meant to be the density and the arcs — "zoomed out, the connection
    // structure should be the most visually striking thing on screen" (§6.1) —
    // and forty titles over it is not that. One row at full extent still names
    // the handful of events with a whole millennium to themselves.
    const rowCount = Math.max(1, Math.round(affordable * this.resolvedShare ** 3));
    const rowRight = new Array<number>(rowCount).fill(-Infinity);

    const placements: {
      x: number;
      textX: number;
      y: number;
      text: string;
      width: number;
      pack: boolean;
      alpha: number;
    }[] = [];

    // The rows in play, cheapest first: a label whose mark sits left of every
    // row's last placement cannot go anywhere, and finding that out before
    // measuring the text is what keeps a dense frame off the hot path.
    let earliestFree = -Infinity;

    for (const mark of this.markLayout) {
      if (placements.length >= MAX_LABELS) break;
      // A mark still dissolved into the mass does not get a name.
      if (mark.alpha < 0.6) continue;

      const x = mark.x;
      if (x < earliestFree + LABEL_GAP) continue;

      const text = this.fit(ctx, mark.event.title, LABEL_WIDTH.mark);
      const width = ctx.measureText(text).width;

      // Labels run to the right of their mark, and fall back to the left when
      // the right edge is too close. Without that fallback the events nearest
      // "now" silently lose their labels at every zoom — which is precisely
      // where a personal timeline is densest and least wants to go quiet.
      const fitsRight = x + width + 6 <= vp.width;
      const fitsLeft = x - width - 6 >= 0;

      let row = -1;
      let textX = 0;
      for (let r = 0; r < rowCount; r++) {
        const free = (rowRight[r] as number) + LABEL_GAP;
        if (fitsRight && x >= free) {
          row = r;
          textX = x + 4;
          break;
        }
        if (!fitsRight && fitsLeft && x - width - 4 >= free) {
          row = r;
          textX = x - width - 4;
          break;
        }
      }
      if (row === -1) continue;

      rowRight[row] = textX + width;
      earliestFree = Math.min(...rowRight);
      placements.push({
        x,
        textX,
        y: baselineY - MARK_HEIGHT - 8 - row * LABEL_ROW_HEIGHT,
        text,
        width,
        pack: mark.event.pack !== undefined,
        alpha: Math.min(1, mark.alpha),
      });
    }

    // Two passes. Leader lines from later marks would otherwise be drawn over
    // the text of labels already placed on lower rows, and a hairline through
    // the middle of a word is the difference between a chart and a mess.
    ctx.strokeStyle = this.theme.mark;
    ctx.lineWidth = 1;
    for (const p of placements) {
      ctx.globalAlpha = p.alpha * 0.45;
      ctx.beginPath();
      const x = Math.round(p.x) + 0.5;
      ctx.moveTo(x, baselineY - MARK_HEIGHT);
      ctx.lineTo(x, p.y + 3);
      ctx.stroke();
    }

    for (const p of placements) {
      ctx.globalAlpha = p.alpha;
      // A chip of the surface colour keeps the text legible where a leader line
      // from somewhere else crosses behind it.
      ctx.fillStyle = this.theme.surface;
      ctx.fillRect(p.textX - 2, p.y - 9, p.width + 4, 12);
      ctx.fillStyle = p.pack ? this.theme.muted : this.theme.inkSecondary;
      ctx.fillText(p.text, p.textX, p.y);
    }

    ctx.restore();
  }

  private drawAxis(
    ctx: CanvasRenderingContext2D,
    ticks: ReturnType<typeof generateTicks>,
    vp: Viewport,
    baselineY: number,
    width: number,
    _height: number,
  ): void {
    ctx.strokeStyle = this.theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baselineY + 0.5);
    ctx.lineTo(width, baselineY + 0.5);
    ctx.stroke();

    ctx.font = LABEL_FONT;
    ctx.fillStyle = this.theme.muted;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    /*
     * Edge labels are aligned, not culled.
     *
     * Dropping every tick within 18 px of an edge is what left a 390 px canvas
     * with one label on it and an 800 px canvas with three: at those widths the
     * outermost ticks are most of the ticks, and the first and last are the two
     * a reader most wants — they say what range is on screen. Sliding them
     * inward costs a couple of pixels of registration against their own rule,
     * which is a far smaller lie than not saying which century this is.
     */
    for (const tick of ticks) {
      const x = linearScale.toPx(tick.t, vp);
      if (x < -20 || x > width + 20) continue;
      const half = ctx.measureText(tick.label).width / 2 + 2;
      ctx.fillText(tick.label, Math.min(Math.max(x, half), width - half), baselineY + 9);
    }

    ctx.textAlign = 'left';
  }

  /**
   * A line of prose when the canvas would otherwise be blank.
   *
   * Two cases, and they are different statements. With nothing in the store at
   * all, an empty canvas is indistinguishable from a broken one, and the thing
   * to say is how to put something in it. With a corpus but a window outside
   * it, the canvas is honestly empty and the useful thing to say is *where the
   * corpus is* — otherwise panning into the far future looks like the data has
   * gone.
   */
  private drawEmptyNote(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    density: DensityResult,
    top: number,
    baselineY: number,
  ): void {
    const message = this.emptyMessage(vp, density);
    if (message === null) return;

    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.fillStyle = this.theme.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, vp.width / 2, (top + baselineY) / 2);
    ctx.restore();
  }

  private emptyMessage(vp: Viewport, density: DensityResult): string | null {
    if (this.calibrationEvents.length === 0 && this.events.length === 0) {
      return 'nothing yet — type an event above, like “battle of lepanto 1571 #europe #war”';
    }
    if (this.markLayout.length > 0 || density.total > 0.01) return null;

    const extent = this.getExtent();
    if (!extent) return null;
    if (vp.start > extent.end) {
      return `nothing here — the timeline ends in ${formatYear(toGregorian(extent.end).year)}`;
    }
    if (vp.end < extent.start) {
      const first = formatYear(toGregorian(extent.start).year);
      return `nothing here — the timeline begins in ${first}`;
    }
    return null;
  }

  private drawCrosshair(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    top: number,
    baselineY: number,
  ): void {
    if (this.hoverX === null) return;
    const x = Math.round(this.hoverX) + 0.5;
    if (x < 0 || x > vp.width) return;

    ctx.save();
    ctx.strokeStyle = this.theme.inkSecondary;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top - 8);
    ctx.lineTo(x, baselineY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const label = formatMoment(linearScale.toTime(this.hoverX, vp), vp.end - vp.start);
    ctx.font = LABEL_FONT;
    const textWidth = ctx.measureText(label).width;
    const boxWidth = textWidth + 14;
    const boxX = Math.min(Math.max(x - boxWidth / 2, 2), vp.width - boxWidth - 2);
    const boxY = top - 22;

    ctx.fillStyle = this.theme.gridMajor;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, 18, 4);
    ctx.fill();

    ctx.fillStyle = this.theme.ink;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(label, boxX + boxWidth / 2, boxY + 9);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}


/**
 * The first meaningful line of a Markdown note, for the arc label.
 *
 * Deliberately not the Markdown renderer: this wants one line of plain text for
 * a canvas, and pulling `renderMarkdown` in here to then strip its tags would be
 * both slower and a worse answer.
 */
function firstLine(note: string): string {
  for (const line of note.split('\n')) {
    const plain = line.replace(/^[\s>#*+-]+/, '').replace(/[*_`]/g, '').trim();
    if (plain.length > 0) return plain;
  }
  return '';
}

/**
 * Code-unit order, not `localeCompare`.
 *
 * Locale collation depends on the host's ICU data, so the same timeline would
 * sort differently on two machines — which is exactly the flicker the
 * documented sort key exists to prevent (§1).
 */
function compareStrings(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

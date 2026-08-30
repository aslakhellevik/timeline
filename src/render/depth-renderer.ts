/**
 * The depth view (docs/design.md §6.7) — time running *into* the screen.
 *
 * You stand at the newest moment in the window and look back down a corridor.
 * The past recedes to a horizon, and screen space is allocated as `1/z`, which
 * is roughly how a personal corpus thins with age: most of what anyone knows is
 * recent, and near means large means room for it.
 *
 * Framework-agnostic by rule (D11), like the flat renderer, and it shares that
 * renderer's machinery wherever the two genuinely agree — `buildArcIndex` for
 * connection colours, `layoutLanes` for era rows, `MassTransition` for the
 * filter animation, `computeDensity` for the mass. What differs is only where
 * things are drawn.
 *
 * ## Mass is width, not height
 *
 * The corridor holds a river whose half-width is the density. A river's width is
 * a property of the river, not of where you stand, so it is measured in **events
 * per unit time** and then shrunk by the projection like everything else. That
 * conversion is the one piece of arithmetic this view cannot skip: the density
 * grid counts events per *pixel row*, and rows near the horizon cover far more
 * time than rows at your feet — by a factor of `z²`. Drawing the raw grid would
 * make a compressed stretch of antiquity as wide as a genuinely dense century,
 * which is the opposite of the truth.
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
import { DEFAULT_BETA, computeDensity, farViewOpacity, heightFraction } from '../core/density';
import type { DensityResult } from '../core/density';
import { midpoint, toGregorian } from '../core/time';
import { arcInkScale, buildArcIndex } from './arcs';
import type { ArcSource } from './arcs';
import { layoutLanes } from './lanes';
import type { EraBar, LaneLayout } from './lanes';
import { MassTransition, clamp01 } from './mass-transition';
import { DepthProjection, depthGeometry } from './projection';
import { spanBar, spanWidth } from './span-bar';
import type { SpanBar } from './span-bar';
import { generateTicks, formatYear } from './ticks';
import type { CanvasSize } from './canvas-host';
import { LABEL_FONT, LABEL_WIDTH, fitText, formatMoment } from './text';
import { withAlpha } from './colour';
import { DARK_THEME, DEFAULT_FRAME } from './timeline-renderer';
import type { Selection, Target, TimelineData, TimelineTheme } from './timeline-renderer';
import { frameBounds, revealWindow } from './viewport';

const TOP_PADDING = 12;
/**
 * Where a revealed event is placed in the window, as a fraction from its start.
 *
 * Not the middle. `y = horizon + depth/z` with `z` running 1 → 9 linearly in
 * time puts the vertical middle of the corridor at `z = 1.8`, which is a tenth
 * of the window from its newest edge — so an event centred in time is at the
 * horizon. `0.85` sits it a little below the middle of the picture, where the
 * corridor is wide enough to read.
 */
const DEPTH_REVEAL_PLACE = 0.85;
/** Widest the river gets, in lateral units (1 = the corridor's half-width). */
const MAX_RIVER = 0.5;
/** Where the innermost era lane begins, clear of the river at full width. */
const LANE_INNER = 0.6;
const LANE_STEP = 0.13;
const MAX_LANES = 3;
/** Fraction of a lane's step the bar itself occupies; the rest is the gap. */
const LANE_FILL = 0.8;
/**
 * Slack around a lane, in lateral units, so its edge is still clickable.
 *
 * Deliberately less than half the gap between two lanes: the gap has to survive
 * as a gap, or the fix for the off-by-a-third hit target is just a wider version
 * of the same lie.
 */
const LANE_TOLERANCE = 0.01;
/**
 * Vertical pixels a label needs to itself.
 *
 * Eighteen, not fifteen: the chip behind a label is fourteen pixels tall, so
 * fifteen left one pixel between two of them and they read as a single block of
 * text with no gap in it.
 */
const LABEL_PITCH = 18;
const MAX_LABELS = 26;
/**
 * Where a label's text begins, in lateral units — clear of the outermost lane.
 *
 * Labels used to be anchored just outside the river, which near the ground is
 * *inside* the era band by construction: the river reaches 0.5 and the lanes
 * start at 0.6. So an event title near your feet was drawn straight through the
 * era bars and their names, and the two said nothing legible between them.
 */
const LABEL_LATERAL = 1.02;
/** Clear space kept at the canvas edge. */
const EDGE_PADDING = 4;
/**
 * Narrowest a fitted label may be before it is not drawn at all.
 *
 * The same judgement as the flat view's era names: below about eight glyphs a
 * truncation names nothing, and a column of `Thurmen ta…` reads as a rendering
 * fault rather than as a list of events.
 */
const MIN_LABEL_ROOM = 56;
/** Shortest an arc gets, so a connection between neighbours is still a vault. */
const MIN_ARC = 12;
/** Below this on-screen scale, text is unreadable and marks are sub-pixel. */
const LEGIBLE_SCALE = 0.16;
/** Drawn corridor-length below which an interval mark stays a bare cross-line. */
const MARK_BAR_THRESHOLD = 2 * DEFAULT_BETA;
/** Thickness of the ribbon that carries an event's span, in pixels. */
const MARK_BAR_THICKNESS = 3;

interface Mark {
  t: Days;
  event: TimelineEvent;
}

interface ArcShape {
  connection: Connection;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
  colour: string;
  /** Exact bounds of the curve, so hit-testing can reject without sampling. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A rectangle of the canvas that already has text in it. */
interface LabelBox {
  y: number;
  x1: number;
  x2: number;
}

/** Where one event label ended up, once a side was found that would take it. */
interface LabelPlacement {
  side: -1 | 1;
  text: string;
  textX: number;
  width: number;
}

/**
 * What the margins beside the corridor already say.
 *
 * Three separate label systems write into the same two strips of canvas — the
 * year rail, the era names, and the event titles — and until this existed none
 * of them knew the others were there. The result was exactly what you would
 * predict: `1000` set inside an event title, and *Elsa Hovden resigns* laid
 * across *the long nineteenth century*.
 *
 * Kept per side, since nothing ever straddles the centre line, which keeps each
 * scan to the handful of boxes that could possibly overlap. Order is priority:
 * the year rail claims first because it is the frame of reference the whole
 * projection is read against, then era names, then event titles — the most
 * numerous and the most droppable, and the ones a hover can still recover.
 */
class LabelSpace {
  private readonly left: LabelBox[] = [];
  private readonly right: LabelBox[] = [];

  private of(side: -1 | 1): LabelBox[] {
    return side < 0 ? this.left : this.right;
  }

  fits(side: -1 | 1, y: number, x1: number, x2: number, pitch = LABEL_PITCH): boolean {
    for (const box of this.of(side)) {
      if (Math.abs(box.y - y) >= pitch) continue;
      if (x2 < box.x1 - 4 || x1 > box.x2 + 4) continue;
      return false;
    }
    return true;
  }

  claim(side: -1 | 1, y: number, x1: number, x2: number): void {
    this.of(side).push({ y, x1, x2 });
  }
}

export class DepthRenderer {
  private theme: TimelineTheme;
  private events: readonly TimelineEvent[] = [];
  private marks: Mark[] = [];
  private eventsById: Map<Id, TimelineEvent> = new Map();
  private arcIndex: ArcSource[] = [];
  private eras: readonly Era[] = [];
  private tagColours: Map<Id, string> = new Map();
  private calibrationEvents: readonly TimelineEvent[] = [];

  private viewport: Viewport = { start: 0, end: 1, width: 1 };
  /** What the view frames and may pan over — see `getFrame`. */
  private frame: { start: Days; end: Days } = DEFAULT_FRAME();
  private hover: { x: number; y: number } | null = null;
  private selection: Selection = {};

  private readonly transition = new MassTransition();
  private cache: { key: string; density: DensityResult } | null = null;
  /**
   * The same, over the user's own events only.
   *
   * The river is drawn twice: the total desaturated, and your own share solid
   * inside it. With a pack installed, a wall of canonical events otherwise reads
   * as knowledge — and the density stops meaning "what I know", which is the
   * problem the whole pack design is arranged around (§5).
   */
  private readonly mineTransition = new MassTransition();
  private mineCache: { key: string; density: DensityResult } | null = null;
  /** Every visible event's `when`, hoisted out of the per-frame cache miss. */
  private specs: TimeSpec[] = [];
  private mineSpecs: TimeSpec[] = [];
  private hasPackEvents = false;

  /** Events per day at which the river reaches its full width. */
  private rateRef = 1;

  /** The last frame's geometry, so hit-testing runs against what is on screen. */
  private projection: DepthProjection | null = null;
  private arcs: ArcShape[] = [];
  private lanes: { personal: LaneLayout; canonical: LaneLayout } | null = null;
  private riverAt: Float64Array | null = null;
  /**
   * The river's two banks, in screen x, reused between frames.
   *
   * A four-hundred-row corridor drawn twice a frame allocated some two thousand
   * four hundred two-element arrays per frame purely to hand them straight to
   * `lineTo`. The y of row `i` is `baseY + i`, so only x has to be stored.
   */
  private banks: { left: Float64Array; right: Float64Array } | null = null;

  constructor(theme: TimelineTheme = DARK_THEME) {
    this.theme = theme;
  }

  setData(data: TimelineData): void {
    const { events, connections = [], tags = [], eras = [] } = data;
    const calibration = data.calibration ?? events;
    const recalibrate = calibration !== this.calibrationEvents;

    this.events = events;
    this.marks = events
      .map((event) => ({ t: midpoint(event.when), event }))
      .sort((a, b) => a.t - b.t);
    this.eventsById = new Map(events.map((event) => [event.id, event]));
    this.specs = events.map((event) => event.when);
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
    this.frame = this.computeFrame();

    this.transition.begin();
    this.mineTransition.begin();
    this.cache = null;
    this.mineCache = null;
    if (recalibrate) this.rateRef = this.calibrate();
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  setHover(x: number | null, y: number | null): void {
    this.hover = x === null || y === null ? null : { x, y };
  }

  setSelection(selection: Selection): void {
    this.selection = selection;
  }

  /** Full extent of the *unfiltered* corpus, so filters do not move the frame. */
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
   * The range the corridor frames and may pan over: events **and eras**, or a
   * stated default when there is neither (D52).
   *
   * The same hole the flat view had, and worse here. `DepthView` fell back to
   * `{0, 1}` when there were no events, which is a one-day window at the epoch;
   * `clamp` then read that as a three-day zoom limit, so on a first-run timeline
   * the corridor ran from 1 January to 2 January of year one and the "my life"
   * era D26 had just created — nineteen thousand days away — could not be
   * reached at any zoom.
   */
  getFrame(): { start: Days; end: Days } {
    return this.frame;
  }

  /**
   * The window that would bring `[from, to]` into view, or `null` when it is
   * already there (§6.1).
   *
   * The same function as the flat view's, with one argument different, which is
   * the whole of what the projection changes. The window is placed so the event
   * sits in the *near* part of it rather than the middle: the corridor spends
   * half its screen height on the newest tenth of the window (`1/z`), so an
   * event centred in time lands at the horizon, drawn two pixels tall. Placed
   * this way it arrives at eye level with its past receding behind it, which is
   * what the view is for.
   */
  revealTime(from: Days, to: Days): Viewport | null {
    return revealWindow(this.viewport, from, to, frameBounds(this.frame), DEPTH_REVEAL_PLACE);
  }

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

  /** The projection of the last drawn frame, for callers that need the inverse. */
  getProjection(): DepthProjection | null {
    return this.projection;
  }

  /**
   * Events per day at the densest point of the whole corpus.
   *
   * Computed from a linear grid, because a rate is a property of the data and
   * not of any projection — `λ` per column divided by the days a column covers.
   * Calibrating on the unfiltered corpus is what makes a filter remove weight
   * rather than renormalise it (D31).
   */
  private calibrate(): number {
    const extent = this.getExtent();
    if (!extent) return 1;
    const span = extent.end - extent.start;
    if (!(span > 0)) return 1;

    const source = this.calibrationEvents.length > 0 ? this.calibrationEvents : this.events;
    const width = 1600;
    const { lambdaMax } = computeDensity(
      source.map((event) => event.when),
      { ...extent, width },
    );
    const rate = (lambdaMax * width) / span;
    return rate > 0 ? rate * 1.15 : 1;
  }

  private density(projection: DepthProjection): DensityResult {
    const { start, end } = this.viewport;
    const rows = projection.depthPixels;
    const key = `${start}:${end}:${rows}:${this.events.length}`;
    if (this.cache && this.cache.key === key) return this.cache.density;

    const density = computeDensity(this.specs, { start, end, width: rows }, {
      toPixel: (t) => projection.pixelAt(t),
    });
    this.cache = { key, density };
    return density;
  }

  /** First mark at or after `t`. */
  private lowerBound(t: Days): number {
    let lo = 0;
    let hi = this.marks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.marks[mid] as Mark).t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  draw(ctx: CanvasRenderingContext2D, size: CanvasSize): boolean {
    const { width, height } = size;
    ctx.fillStyle = this.theme.surface;
    ctx.fillRect(0, 0, width, height);
    if (width < 80 || height < 160) return false;

    const vp = { ...this.viewport, width };
    this.viewport = vp;

    const geometry = depthGeometry(width, height);
    const projection = new DepthProjection(vp, geometry);
    this.projection = projection;

    const rows = projection.depthPixels;
    const { density, animating } = this.transition.resolve(
      this.density(projection),
      `${vp.start}:${vp.end}:${rows}`,
      performance.now(),
    );

    this.riverAt = this.riverWidths(projection, density, rows);
    const mineAt = this.hasPackEvents
      ? this.riverWidths(
          projection,
          this.mineTransition.resolve(this.mineDensity(projection), `${vp.start}:${vp.end}:${rows}`, performance.now())
            .density,
          rows,
        )
      : null;

    /*
     * One occupancy for all three label systems, filled in priority order:
     * the year rail, then the era names, then the event titles.
     */
    const labels = new LabelSpace();

    this.drawSky(ctx, geometry);
    this.drawGround(ctx, projection, geometry, vp, labels);
    this.lanes = this.layoutEras(projection, rows);
    this.drawRiver(ctx, projection, geometry, rows, this.riverAt, mineAt !== null);
    if (mineAt) this.drawRiver(ctx, projection, geometry, rows, mineAt, false);

    // Arcs over the mass and under the marks, as §6.1 says and as the flat view
    // does. Drawn last, with `lighter`, they added their brightness to the label
    // chips and the era names instead of to each other.
    this.arcs = this.layoutArcs(projection, geometry);
    this.drawArcs(ctx);

    this.drawEras(ctx, projection, labels);

    /*
     * The semantic zoom is **spatial here, not global**.
     *
     * The flat view crossfades on one number for the whole frame, because every
     * column of it covers the same span of time. A corridor does not: a row at
     * your feet covers a day and a row near the horizon covers eighty, so a
     * single λ for the frame is always dominated by the far end and marks would
     * never appear at any zoom. Testing each event against the density at *its*
     * row instead means individual events resolve as they come towards you and
     * dissolve back into mass as they recede — which is what the projection was
     * for.
     */
    this.drawMarks(ctx, projection, density, rows);
    this.drawLabels(ctx, projection, geometry, density, labels);

    this.drawPendingArc(ctx, projection);
    this.drawHover(ctx, projection, geometry);

    return animating;
  }

  // -------------------------------------------------------------------------
  // The river
  // -------------------------------------------------------------------------

  /**
   * Half-width, in lateral units, for every row of the corridor.
   *
   * `lambda` counts events per row; `rowsPerTime` converts that to events per
   * day. Without the conversion the far end of the corridor — where a row spans
   * `z²` times as much time — would read as dense purely because it is squashed.
   */
  private riverWidths(
    projection: DepthProjection,
    density: DensityResult,
    rows: number,
  ): Float64Array {
    const widths = new Float64Array(rows);
    for (let i = 0; i < rows; i++) {
      const t = projection.timeAtPixel(i);
      const perRow = density.lambda[i] ?? 0;
      const rate = perRow * projection.rowsPerTime(t);
      widths[i] = MAX_RIVER * heightFraction(rate, this.rateRef);
    }
    return widths;
  }

  /** The corridor grid over the user's own events only. */
  private mineDensity(projection: DepthProjection): DensityResult {
    const { start, end } = this.viewport;
    const rows = projection.depthPixels;
    const key = `${start}:${end}:${rows}:${this.mineSpecs.length}`;
    if (this.mineCache && this.mineCache.key === key) return this.mineCache.density;

    const density = computeDensity(this.mineSpecs, { start, end, width: rows }, {
      toPixel: (t) => projection.pixelAt(t),
    });
    this.mineCache = { key, density };
    return density;
  }

  private drawRiver(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    geometry: DepthGeometryLike,
    rows: number,
    widths: Float64Array | null,
    muted: boolean,
  ): void {
    if (!widths || rows < 2) return;

    const baseY = projection.yAt(this.viewport.start);
    if (!this.banks || this.banks.left.length < rows) {
      this.banks = { left: new Float64Array(rows), right: new Float64Array(rows) };
    }
    const { left, right } = this.banks;

    for (let i = 0; i < rows; i++) {
      const t = projection.timeAtY(baseY + i);
      const w = widths[i] as number;
      // A hairline even where there is nothing, so the corridor stays readable
      // as a continuous path through periods you know nothing about.
      const lateral = Math.max(w, 0.006);
      left[i] = projection.xAt(t, -lateral);
      right[i] = projection.xAt(t, lateral);
    }

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < rows; i++) ctx.lineTo(left[i] as number, baseY + i);
    for (let i = rows - 1; i >= 0; i--) ctx.lineTo(right[i] as number, baseY + i);
    ctx.closePath();

    // Brighter towards you: the near end is both what you know most about and
    // what the eye should land on first.
    const hue = muted ? this.theme.muted : this.theme.mass;
    const fill = ctx.createLinearGradient(0, geometry.horizonY, 0, geometry.groundY);
    fill.addColorStop(0, withAlpha(hue, muted ? 0.12 : 0.22));
    fill.addColorStop(1, withAlpha(hue, muted ? 0.4 : 0.75));
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = muted ? this.theme.muted : this.theme.massEdge;
    ctx.lineWidth = muted ? 1 : 1.25;
    ctx.globalAlpha = muted ? 0.5 : 0.85;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < rows; i++) ctx.lineTo(left[i] as number, baseY + i);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < rows; i++) ctx.lineTo(right[i] as number, baseY + i);
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Ground, sky and the year rings
  // -------------------------------------------------------------------------

  /**
   * A cold wash above the horizon, so the corridor reads as a space rather than
   * a shape on a flat background.
   *
   * The gradient ends **at** the horizon and a separate band carries it down
   * into the ground. It used to run forty pixels past it, which put the
   * brightest stop below the horizon and then stopped dead: a hard-edged
   * rectangle across the full width of the canvas, forty pixels down in the
   * ground plane, saying nothing at all about the scene. The band below fades to
   * fully transparent instead, which is the glow the original was reaching for.
   */
  private drawSky(ctx: CanvasRenderingContext2D, geometry: DepthGeometryLike): void {
    const sky = ctx.createLinearGradient(0, 0, 0, geometry.horizonY);
    sky.addColorStop(0, this.theme.surface);
    sky.addColorStop(1, withAlpha(this.theme.mass, 0.1));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, geometry.width, geometry.horizonY);

    const glow = ctx.createLinearGradient(0, geometry.horizonY, 0, geometry.horizonY + 56);
    glow.addColorStop(0, withAlpha(this.theme.mass, 0.1));
    glow.addColorStop(1, withAlpha(this.theme.mass, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, geometry.horizonY, geometry.width, 56);

    // Barely there: the horizon is where the corridor's own lines converge, and
    // a stroke firm enough to be noticed reads as a drawn edge instead.
    ctx.strokeStyle = withAlpha(this.theme.massEdge, 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, geometry.horizonY + 0.5);
    ctx.lineTo(geometry.width, geometry.horizonY + 0.5);
    ctx.stroke();
  }

  /**
   * Year rings across the corridor, plus the rails.
   *
   * The rings are what make the projection legible: evenly spaced years arriving
   * closer and closer together is the clearest possible statement that distance
   * means time.
   */
  private drawGround(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    geometry: DepthGeometryLike,
    vp: Viewport,
    labels: LabelSpace,
  ): void {
    ctx.save();
    ctx.lineWidth = 1;

    for (const lateral of [-1, -LANE_INNER, LANE_INNER, 1]) {
      ctx.strokeStyle = this.theme.grid;
      ctx.beginPath();
      ctx.moveTo(projection.xAt(vp.start, lateral), projection.yAt(vp.start));
      ctx.lineTo(projection.xAt(vp.end, lateral), projection.yAt(vp.end));
      ctx.stroke();
    }

    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    let lastLabelY = -Infinity;

    for (const tick of generateTicks(vp)) {
      const y = projection.yAt(tick.t);
      if (y < geometry.horizonY + 2 || y > geometry.groundY) continue;
      const scale = projection.scaleAt(tick.t);

      ctx.strokeStyle = tick.major ? this.theme.gridMajor : this.theme.grid;
      ctx.globalAlpha = Math.min(1, 0.25 + scale);
      ctx.beginPath();
      ctx.moveTo(projection.xAt(tick.t, -1), y);
      ctx.lineTo(projection.xAt(tick.t, 1), y);
      ctx.stroke();

      // Labels thin out towards the horizon on measured spacing rather than a
      // zoom rule — the rings bunch up nonlinearly, so no fixed step works.
      if (y - lastLabelY < 13 || scale < LEGIBLE_SCALE) continue;

      /*
       * One rail, not two.
       *
       * The ring already crosses the whole corridor, so the year at each end of
       * it was the same fact written twice — and it was written into the two
       * strips of canvas the era names and the event titles have to share. One
       * rail halves the text on screen and loses nothing.
       */
      const edge = projection.xAt(tick.t, -1) - 6;
      const width = ctx.measureText(tick.label).width;
      if (edge - width < EDGE_PADDING) continue;

      lastLabelY = y;
      ctx.globalAlpha = Math.min(1, 0.35 + scale);
      ctx.fillStyle = this.theme.muted;
      ctx.textAlign = 'right';
      ctx.fillText(tick.label, edge, y);
      ctx.textAlign = 'left';
      labels.claim(-1, y, edge - width, edge);
    }

    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Eras
  // -------------------------------------------------------------------------

  /**
   * Era lanes, personal to the left and canonical to the right.
   *
   * The corridor has two sides and the flat view has only one, so this is the
   * one place the depth view can say something the flat view cannot: your own
   * frame of reference and the canonical one sit opposite each other rather than
   * competing for rows.
   */
  private layoutEras(
    projection: DepthProjection,
    rows: number,
  ): { personal: LaneLayout; canonical: LaneLayout } {
    const toPx = (t: Days) => projection.pixelAt(t);
    const options = {
      maxLanes: MAX_LANES,
      gap: 4,
      tagColours: this.tagColours,
      canonicalColour: this.theme.era,
      // The personal hue, not the selection yellow this used to pass. Yellow
      // already means "selected" and "this arc is being drawn"; a third meaning
      // made the left flank of the corridor look permanently half-selected.
      personalColour: this.theme.eraPersonal,
    };
    return {
      personal: layoutLanes(
        this.eras.filter((era) => era.kind === 'personal'),
        toPx,
        rows,
        options,
      ),
      canonical: layoutLanes(
        this.eras.filter((era) => era.kind !== 'personal'),
        toPx,
        rows,
        options,
      ),
    };
  }

  private drawEras(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    labels: LabelSpace,
  ): void {
    if (!this.lanes) return;
    const selected = this.selection.eraId ?? null;
    const baseY = projection.yAt(this.viewport.start);

    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';

    for (const [side, layout] of [
      [-1, this.lanes.personal],
      [1, this.lanes.canonical],
    ] as const) {
      for (const bar of layout.bars) {
        const inner = laneInner(bar.lane);
        const outer = laneOuter(bar.lane);
        this.drawEraBar(
          ctx,
          projection,
          bar,
          side,
          inner,
          outer,
          baseY,
          bar.era.id === selected,
          labels,
        );
      }
    }

    ctx.restore();
  }

  private drawEraBar(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    bar: EraBar,
    side: -1 | 1,
    inner: number,
    outer: number,
    baseY: number,
    selected: boolean,
    labels: LabelSpace,
  ): void {
    const from = baseY + Math.min(bar.x1 - bar.fadeLeft, bar.x2 + bar.fadeRight);
    const to = baseY + Math.max(bar.x1 - bar.fadeLeft, bar.x2 + bar.fadeRight);
    const top = Math.max(from, projection.geometry.horizonY + 1);
    const bottom = Math.min(to, projection.geometry.groundY);
    if (bottom - top < 1.5) return;

    ctx.beginPath();
    const step = Math.max(1, (bottom - top) / 40);
    for (let y = top; y <= bottom; y += step) {
      const t = projection.timeAtY(y);
      ctx.lineTo(projection.xAt(t, side * inner), y);
    }
    for (let y = bottom; y >= top; y -= step) {
      const t = projection.timeAtY(y);
      ctx.lineTo(projection.xAt(t, side * outer), y);
    }
    ctx.closePath();

    // The uncertain flanks fade, exactly as in the flat view: an era whose `a`
    // differs from `b` has no first day, and a hard edge would claim it does.
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    const solid = withAlpha(bar.colour, selected ? 0.9 : 0.55);
    const clear = withAlpha(bar.colour, 0);
    const total = bottom - top || 1;
    const fadeFar = clamp01((baseY + bar.x1 - top) / total);
    const fadeNear = clamp01((baseY + bar.x2 - top) / total);
    gradient.addColorStop(0, bar.fadeLeft > 0 ? clear : solid);
    gradient.addColorStop(clamp01(Math.min(fadeFar, fadeNear)), solid);
    gradient.addColorStop(clamp01(Math.max(fadeFar, fadeNear)), solid);
    gradient.addColorStop(1, bar.fadeRight > 0 ? clear : solid);
    ctx.fillStyle = gradient;
    ctx.fill();

    /*
     * Named at the near end, where the corridor is widest and there is room.
     *
     * What is left unnamed here — a bar too short along the corridor to hold a
     * name, which on the personal flank is most of them — is named on hover
     * instead, exactly as the flat view's slivers are (§6.1).
     */
    const labelY = bottom - 8;
    if (bottom - top < 26) return;
    const t = projection.timeAtY(labelY);
    if (projection.scaleAt(t) < LEGIBLE_SCALE) return;

    const anchorX = projection.xAt(t, side * outer) + side * 6;
    // The room actually there, rather than a fixed width: a name at the near
    // plane on a wide canvas used to be set straight off the edge, since nothing
    // measured it against anything.
    const room =
      side < 0 ? anchorX - EDGE_PADDING : projection.geometry.width - EDGE_PADDING - anchorX;
    if (room < MIN_LABEL_ROOM) return;

    const text = fitText(ctx, bar.era.name, Math.min(LABEL_WIDTH.era, room));
    const width = ctx.measureText(text).width;
    const x1 = side < 0 ? anchorX - width : anchorX;
    if (!labels.fits(side, labelY, x1, x1 + width)) return;

    ctx.fillStyle = selected ? this.theme.ink : this.theme.inkSecondary;
    ctx.textAlign = side < 0 ? 'right' : 'left';
    ctx.fillText(text, anchorX, labelY);
    ctx.textAlign = 'left';
    labels.claim(side, labelY, x1, x1 + width);
  }

  // -------------------------------------------------------------------------
  // Marks, labels and arcs
  // -------------------------------------------------------------------------

  /** Density at the row an event sits on, for the per-row crossfade. */
  private localLambda(projection: DepthProjection, density: DensityResult, t: Days): number {
    const row = Math.round(projection.pixelAt(t));
    if (row < 0 || row >= density.lambda.length) return Infinity;
    return density.lambda[row] as number;
  }

  /**
   * Events across the corridor — a cross-line at the likely middle, and for an
   * interval a ribbon along each bank carrying its span (D49).
   *
   * The flat view draws the same two facts as a stem and a crossbar; here the
   * axis has turned through ninety degrees, so the stem runs across the corridor
   * and the span runs *along* it, down the river's edges. `spanBar` needs no
   * changes for that: it works in whatever pixel coordinate it is handed, and
   * the corridor's is `pixelAt`, which is already what the era lanes are laid
   * out in. Both layers therefore agree about when an interval is an interval,
   * in this view as in the other.
   */
  private drawMarks(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    density: DensityResult,
    rows: number,
  ): void {
    const from = this.lowerBound(this.viewport.start);
    const toPx = (t: Days) => projection.pixelAt(t);
    const baseY = projection.yAt(this.viewport.start);
    ctx.save();
    ctx.lineWidth = 1;

    for (let i = from; i < this.marks.length; i++) {
      const mark = this.marks[i] as Mark;
      if (mark.t > this.viewport.end) break;
      const scale = projection.scaleAt(mark.t);
      if (scale < 0.06) continue;
      const resolved = 1 - farViewOpacity(this.localLambda(projection, density, mark.t));
      if (resolved < 0.03) continue;

      // Pack events are drawn dimmer and shorter (§5). If installed content
      // looks like your own, the density stops meaning "what I know".
      const fromPack = mark.event.pack !== undefined;
      const y = projection.yAt(mark.t);
      const reach = this.riverLateralAt(projection, mark.t) + (fromPack ? 0.02 : 0.05);
      const hue = fromPack ? this.theme.muted : this.theme.mark;

      ctx.strokeStyle = hue;
      ctx.globalAlpha = resolved * Math.min(1, 0.25 + scale * 1.6) * (fromPack ? 0.45 : 1);
      ctx.beginPath();
      ctx.moveTo(projection.xAt(mark.t, -reach), y);
      ctx.lineTo(projection.xAt(mark.t, reach), y);
      ctx.stroke();

      const bar = this.barFor(mark.event.when, toPx, rows);
      if (bar) this.drawMarkSpan(ctx, projection, bar, baseY, reach, hue);
      ctx.lineWidth = 1;
    }

    ctx.restore();
  }

  /** The trapezoid for an interval event, or `null` where a hairline says it all. */
  private barFor(when: TimeSpec, toPx: (t: Days) => number, rows: number): SpanBar | null {
    // `mode`, not the numbers: `1848` is stored as a whole year — an instant
    // widened by its granularity — and drawing every year-granularity event as a
    // year-long bar turns a decade of the corridor into one continuous strip.
    if (when.mode === 'instant') return null;
    if (spanWidth(when, toPx) < MARK_BAR_THRESHOLD) return null;
    return spanBar(when, toPx, rows);
  }

  /**
   * The span, as a ribbon down each bank of the river.
   *
   * A ribbon rather than a filled block, for the reason the flat view's crossbar
   * is one: thirty-eight multi-year events overlapping a decade are a solid slab
   * at any alpha, and the marks underneath stop being countable. Following the
   * banks rather than the centre line keeps it off the river itself, which is
   * the one part of the corridor that already means something.
   */
  private drawMarkSpan(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    bar: SpanBar,
    baseY: number,
    reach: number,
    hue: string,
  ): void {
    const { horizonY, groundY } = projection.geometry;
    const top = Math.max(baseY + bar.x1 - bar.fadeLeft, horizonY + 1);
    const bottom = Math.min(baseY + bar.x2 + bar.fadeRight, groundY);
    if (bottom - top < 2) return;

    // The uncertain flanks fade, as everywhere else: an event whose `a` differs
    // from `b` has no first day, and a crisp end would claim it does.
    const total = bottom - top;
    const solid = withAlpha(hue, 0.6);
    const clear = withAlpha(hue, 0);
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, bar.fadeLeft > 0 ? clear : solid);
    gradient.addColorStop(clamp01((baseY + bar.x1 - top) / total), solid);
    gradient.addColorStop(clamp01((baseY + bar.x2 - top) / total), solid);
    gradient.addColorStop(1, bar.fadeRight > 0 ? clear : solid);

    ctx.strokeStyle = gradient;
    ctx.lineWidth = MARK_BAR_THICKNESS;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(projection.xAt(projection.timeAtY(top), side * reach), top);
      ctx.lineTo(projection.xAt(projection.timeAtY(bottom), side * reach), bottom);
      ctx.stroke();
    }
  }

  /**
   * Labels for the nearest events, alternating sides.
   *
   * Near-first rather than the flat view's left-to-right: the depth view has a
   * privileged end, and text near the horizon is unreadable however clever the
   * placement. Anything that does not fit simply is not labelled, which the
   * receding perspective makes feel like distance rather than omission.
   */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    geometry: DepthGeometryLike,
    density: DensityResult,
    labels: LabelSpace,
  ): void {
    const from = this.lowerBound(this.viewport.start);
    const visible: Mark[] = [];
    for (let i = from; i < this.marks.length; i++) {
      const mark = this.marks[i] as Mark;
      if (mark.t > this.viewport.end) break;
      visible.push(mark);
    }

    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';

    let placed = 0;
    /** Which side to try first. A plain number, so it is never narrowed to a literal. */
    let preferred = 1;

    for (let i = visible.length - 1; i >= 0 && placed < MAX_LABELS; i--) {
      const mark = visible[i] as Mark;
      const scale = projection.scaleAt(mark.t);
      if (scale < LEGIBLE_SCALE) break;
      const alpha = 1 - farViewOpacity(this.localLambda(projection, density, mark.t));
      if (alpha < 0.15) continue;

      const y = projection.yAt(mark.t);
      if (y < geometry.horizonY + TOP_PADDING) break;

      /*
       * Both sides are tried, and the preference only advances when a label is
       * actually drawn. It used to be flipped *before* the second test and then
       * left flipped when that test failed too, so a run of rejected labels
       * walked the side back and forth and the two columns arrived in clumps
       * rather than alternating.
       */
      const first: -1 | 1 = preferred < 0 ? -1 : 1;
      const second: -1 | 1 = first === 1 ? -1 : 1;
      const spot: LabelPlacement | null =
        this.placeLabel(ctx, projection, geometry, labels, mark, y, first) ??
        this.placeLabel(ctx, projection, geometry, labels, mark, y, second);
      if (!spot) continue;

      const { side, text, textX, width } = spot;
      // The leader runs from the river's own edge, since the corridor's flank is
      // where the mark ends and the label now begins well outside the era lanes.
      const reach = this.riverLateralAt(projection, mark.t) + 0.05;
      ctx.strokeStyle = this.theme.mark;
      ctx.globalAlpha = alpha * 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(projection.xAt(mark.t, side * reach), y);
      ctx.lineTo(side < 0 ? textX + width + 3 : textX - 3, y);
      ctx.stroke();

      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.theme.surface;
      ctx.fillRect(textX - 2, y - 7, width + 4, 14);
      ctx.fillStyle =
        mark.event.id === this.selection.eventId
          ? this.theme.selection
          : mark.event.pack !== undefined
            ? this.theme.muted
            : this.theme.inkSecondary;
      ctx.fillText(text, textX, y);

      labels.claim(side, y, textX - 2, textX + width + 2);
      preferred = -side;
      placed++;
    }

    ctx.restore();
  }

  /**
   * Where one label would go on one side, or `null` if it cannot go there.
   *
   * Fitted to the room actually available rather than to a fixed width. Near the
   * ground the corridor is at its widest and the margin outside the lanes is at
   * its narrowest, which is the price of anchoring outside them — a title there
   * is cut short rather than laid over the era band, and below eight glyphs it
   * is not drawn at all.
   */
  private placeLabel(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    geometry: DepthGeometryLike,
    labels: LabelSpace,
    mark: Mark,
    y: number,
    side: -1 | 1,
  ): LabelPlacement | null {
    const anchorX = projection.xAt(mark.t, side * LABEL_LATERAL);
    const room =
      side < 0 ? anchorX - 8 - EDGE_PADDING : geometry.width - EDGE_PADDING - (anchorX + 8);
    if (room < MIN_LABEL_ROOM) return null;

    const text = fitText(ctx, mark.event.title, Math.min(LABEL_WIDTH.depthMark, room));
    const width = ctx.measureText(text).width;
    const textX = side < 0 ? anchorX - 8 - width : anchorX + 8;
    if (!labels.fits(side, y, textX - 2, textX + width + 2)) return null;

    return { side, text, textX, width };
  }

  /**
   * Arcs vaulting over the corridor.
   *
   * Height comes from **how much of the window the connection spans**, not from
   * how far apart its ends look on screen. Those are the same thing in the flat
   * view and wildly different here: two events a century apart are four hundred
   * pixels apart at your feet and four near the horizon, so screen distance
   * would flatten every ancient connection into a scratch on the ground.
   *
   * They are allowed above the horizon and into the sky. In a scene with a
   * ground plane, tall things project above the horizon — and it is the one
   * region of the canvas with room to spare, which is what lets seven hundred
   * connections rooted on a single centre line separate into a canopy instead of
   * a knot.
   */
  private layoutArcs(projection: DepthProjection, geometry: DepthGeometryLike): ArcShape[] {
    const shapes: ArcShape[] = [];
    const { start, end } = this.viewport;
    const rows = Math.max(1, projection.depthPixels);
    const maxArcs = Math.round(Math.min(400, Math.max(40, rows / 2.5)));

    for (const source of this.arcIndex) {
      const lo = Math.min(source.t1, source.t2);
      const hi = Math.max(source.t1, source.t2);
      if (hi < start || lo > end) continue;

      // Clamped into the window before projecting. Beyond the far plane the
      // depth approaches zero and the projection explodes, so an unclamped
      // endpoint a millennium off-screen turns its arc into a straight line
      // slashing across the sky — which is what this used to draw.
      const t1 = clampTime(source.t1, start, end);
      const t2 = clampTime(source.t2, start, end);

      const y1 = projection.yAt(t1);
      const y2 = projection.yAt(t2);
      const x1 = projection.xAt(t1, 0);
      const x2 = projection.xAt(t2, 0);

      const midY = (y1 + y2) / 2;
      const reach = clamp01(Math.abs(projection.pixelAt(t1) - projection.pixelAt(t2)) / rows);
      // The curve peaks at `midY - apex`, half way to the control point, so the
      // apex is capped by the whole room above the midpoint and the control
      // point itself is allowed off the top of the canvas.
      const room = Math.max(16, midY - TOP_PADDING);
      // A gentler curve than the flat view’s square root. Reach here is measured
            // against the whole window, and even a long connection rarely spans a
            // quarter of it, so a square root would leave the sky empty and the whole
            // canopy pressed flat against the ground.
            const apex = MIN_ARC + (room - MIN_ARC) * Math.pow(reach, 0.35);
      const scale = (projection.scaleAt(t1) + projection.scaleAt(t2)) / 2;

      // Swept out to the side in proportion to reach. Every arc in this view is
      // rooted on the same centre line — the corridor has only one — so without
      // a lateral spread they collapse into a single braided rope. Long
      // connections swing wide and become the visible structure; local ones
      // stay a thread down the middle, which is the right emphasis anyway.
      const cx =
        (x1 + x2) / 2 +
        scale * geometry.halfWidth * (0.2 + 1.1 * Math.sqrt(reach)) * bowDirection(source);
      const cy = midY - 2 * apex;
      const [minX, maxX] = quadraticBounds(x1, cx, x2);
      const [minY, maxY] = quadraticBounds(y1, cy, y2);

      shapes.push({
        connection: source.connection,
        x1,
        y1,
        cx,
        cy,
        x2,
        y2,
        colour: source.colour,
        minX,
        maxX,
        minY,
        maxY,
      });

      // The corridor is a few hundred pixels long where the flat view has more
      // than a thousand, so the same corpus needs a tighter cap. The index is
      // ordered longest-first, so this keeps the arcs that carry the structure.
      if (shapes.length >= maxArcs) break;
    }

    // Tallest first, so long arcs are laid down before the short ones and the
    // short ones read as detail on top.
    shapes.sort((a, b) => a.cy - b.cy);
    return shapes;
  }

  private drawArcs(ctx: CanvasRenderingContext2D): void {
    if (this.arcs.length === 0) return;
    const focusId = this.selection.eventId ?? null;
    const focus =
      focusId !== null &&
      this.arcs.some((arc) => arc.connection.from === focusId || arc.connection.to === focusId)
        ? focusId
        : null;
    const selected = this.selection.connectionId ?? null;

    // Additive compositing has no ceiling, and a few hundred arcs rooted on one
    // centre line pile up over the near end until it is white (§6.1).
    const ink = arcInkScale(this.arcs.length);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const arc of this.arcs) {
      const touches =
        focus !== null && (arc.connection.from === focus || arc.connection.to === focus);
      const isSelected = arc.connection.id === selected;
      ctx.globalAlpha =
        isSelected || touches ? 0.95 : (focus !== null ? 0.1 : 0.3) * ink;
      ctx.lineWidth = isSelected ? 2.2 : touches ? 1.7 : 0.9;
      ctx.strokeStyle = isSelected ? this.theme.selection : arc.colour;

      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      ctx.quadraticCurveTo(arc.cx, arc.cy, arc.x2, arc.y2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * The connection being drawn, from its first endpoint to the cursor (§6.4).
   *
   * `Selection` has carried `connectFrom` all along and this view ignored it, so
   * arming a connection and switching here showed nothing at all — while the
   * next click completed it regardless. A gesture with no feedback and a real
   * effect is the worst of both.
   */
  private drawPendingArc(ctx: CanvasRenderingContext2D, projection: DepthProjection): void {
    const from = this.selection.connectFrom;
    if (!from || !this.hover) return;
    const source = this.eventsById.get(from);
    if (!source) return;

    const { start, end } = this.viewport;
    const t = clampTime(midpoint(source.when), start, end);
    const x1 = projection.xAt(t, 0);
    const y1 = projection.yAt(t);
    const { x: x2, y: y2 } = this.hover;

    // The same vault the laid-down arcs take, so the gesture looks like what it
    // is about to become rather than like a stray line across the corridor.
    const apex = Math.min(
      Math.max(MIN_ARC, Math.max(y1, y2) - TOP_PADDING),
      MIN_ARC + Math.hypot(x2 - x1, y2 - y1) * 0.35,
    );

    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = this.theme.selection;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 - 2 * apex, x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  private drawHover(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    geometry: DepthGeometryLike,
  ): void {
    if (!this.hover) return;
    const { x, y } = this.hover;
    if (y < geometry.horizonY || y > geometry.groundY) return;

    const t = projection.timeAtY(y);
    ctx.save();
    ctx.strokeStyle = this.theme.inkSecondary;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(projection.xAt(t, -1), y);
    ctx.lineTo(projection.xAt(t, 1), y);
    ctx.stroke();

    const label = formatMoment(t, this.viewport.end - this.viewport.start);
    ctx.font = LABEL_FONT;
    const width = ctx.measureText(label).width + 14;
    const boxX = Math.min(Math.max(x - width / 2, 4), geometry.width - width - 4);

    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.gridMajor;
    ctx.beginPath();
    ctx.roundRect(boxX, y - 22, width, 18, 4);
    ctx.fill();
    ctx.fillStyle = this.theme.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, boxX + width / 2, y - 13);

    /*
     * The era under the cursor, named in full.
     *
     * Most of them have no other name on screen. A bar has to run 26 pixels down
     * the corridor before there is room to set one beside it, and a personal
     * era — a life, a schooling, the years spent reading Russian novels — is a
     * short interval in a window that usually spans millennia, so on the left
     * flank almost nothing qualified. This is the same answer the flat view
     * gives its twelve-pixel slivers: the name is one hover away.
     */
    const era = this.eraAt(projection, x, y);
    if (era) {
      const name = fitText(ctx, era.name, LABEL_WIDTH.era);
      const nameWidth = ctx.measureText(name).width + 14;
      const nameX = Math.min(Math.max(x - nameWidth / 2, 4), geometry.width - nameWidth - 4);
      ctx.fillStyle = this.theme.gridMajor;
      ctx.beginPath();
      ctx.roundRect(nameX, y + 6, nameWidth, 18, 4);
      ctx.fill();
      ctx.fillStyle = this.theme.ink;
      ctx.fillText(name, nameX + nameWidth / 2, y + 15);
    }

    ctx.textAlign = 'left';
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Hit-testing
  // -------------------------------------------------------------------------

  /** The river's half-width at `t`, in lateral units. */
  private riverLateralAt(projection: DepthProjection, t: Days): number {
    const widths = this.riverAt;
    if (!widths || widths.length === 0) return 0.02;
    const index = Math.round(projection.pixelAt(t));
    return Math.max(widths[Math.min(widths.length - 1, Math.max(0, index))] ?? 0, 0.02);
  }

  hitTest(x: number, y: number): Target | null {
    const projection = this.projection;
    if (!projection) return null;
    const { horizonY, groundY } = projection.geometry;
    if (y < horizonY || y > groundY + 4) return null;

    const event = this.eventAt(projection, x, y);
    if (event) return { kind: 'event', id: event.id, event };

    const era = this.eraAt(projection, x, y);
    if (era) return { kind: 'era', id: era.id, era };

    const arc = this.arcAt(x, y);
    return arc ? { kind: 'connection', id: arc.connection.id, connection: arc.connection } : null;
  }

  /**
   * The nearest event to a point.
   *
   * The tolerance is in *pixels* and therefore widens automatically towards you,
   * which is right: near the horizon a year is half a pixel tall and nothing
   * there is a fair click target anyway.
   */
  private eventAt(projection: DepthProjection, x: number, y: number): TimelineEvent | null {
    if (Math.abs(x - projection.geometry.centreX) > projection.geometry.halfWidth * LANE_INNER) {
      return null;
    }

    const t = projection.timeAtY(y);
    const index = this.lowerBound(t);
    let best: TimelineEvent | null = null;
    let bestDistance = 7;

    for (const candidate of [this.marks[index - 1], this.marks[index]]) {
      if (!candidate) continue;
      const distance = Math.abs(projection.yAt(candidate.t) - y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = candidate.event;
      }
    }
    return best;
  }

  private eraAt(projection: DepthProjection, x: number, y: number): Era | null {
    if (!this.lanes) return null;
    const t = projection.timeAtY(y);
    const scale = projection.scaleAt(t);
    const lateral = (x - projection.geometry.centreX) / (scale * projection.geometry.halfWidth);
    const side = lateral < 0 ? -1 : 1;
    const lane = laneAtLateral(Math.abs(lateral));
    if (lane === null) return null;

    const layout = side < 0 ? this.lanes.personal : this.lanes.canonical;
    const pixel = projection.pixelAt(t);

    for (const bar of layout.bars) {
      if (bar.lane !== lane) continue;
      if (pixel >= bar.x1 - bar.fadeLeft && pixel <= bar.x2 + bar.fadeRight) return bar.era;
    }
    return null;
  }

  private arcAt(x: number, y: number): ArcShape | null {
    const tolerance = 6;
    let best: ArcShape | null = null;
    let bestDistance = tolerance * tolerance;

    for (const arc of this.arcs) {
      // The bounding box first. Every pointer move used to sample twenty-one
      // points on each of up to four hundred arcs — eight thousand square roots
      // avoided by four comparisons, and the box is exact rather than the
      // control hull, so nothing reachable is rejected.
      if (x < arc.minX - tolerance || x > arc.maxX + tolerance) continue;
      if (y < arc.minY - tolerance || y > arc.maxY + tolerance) continue;

      for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        const v = 1 - u;
        const px = v * v * arc.x1 + 2 * v * u * arc.cx + u * u * arc.x2;
        const py = v * v * arc.y1 + 2 * v * u * arc.cy + u * u * arc.y2;
        const distance = (px - x) ** 2 + (py - y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = arc;
        }
      }
    }
    return best;
  }
}

/** Inner edge of era lane `lane`, in lateral units. */
export function laneInner(lane: number): number {
  return LANE_INNER + lane * LANE_STEP;
}

/** Outer edge of the same, leaving the gap that keeps two lanes distinguishable. */
export function laneOuter(lane: number): number {
  return Math.min(1, laneInner(lane) + LANE_STEP * LANE_FILL);
}

/**
 * Which era lane a lateral magnitude falls in, or `null` for the gaps.
 *
 * `round` was the bug: a bar occupies four fifths of its lane's step, so
 * rounding claimed the *nearest* lane boundary and put the hit target a third of
 * a bar off the bar. The last fifth of every step is a deliberate gap — it is
 * what stops two eras in adjacent lanes reading as one — and clicking in it now
 * hits nothing, which is what a gap means.
 */
export function laneAtLateral(magnitude: number): number | null {
  const lane = Math.floor((magnitude - LANE_INNER + LANE_TOLERANCE) / LANE_STEP);
  if (lane < 0 || lane >= MAX_LANES) return null;
  if (magnitude < laneInner(lane) - LANE_TOLERANCE) return null;
  if (magnitude > laneOuter(lane) + LANE_TOLERANCE) return null;
  return lane;
}

/**
 * Exact extent of a quadratic Bézier along one axis.
 *
 * The convex hull of the control points would do as a rejection test, but the
 * control point of an arc in this view sits at twice its apex — often off the
 * top of the canvas — so the hull is roughly twice as tall as the curve, and
 * half the rejections it would make are given away. The stationary point is one
 * division.
 */
function quadraticBounds(p0: number, control: number, p1: number): [number, number] {
  let lo = Math.min(p0, p1);
  let hi = Math.max(p0, p1);
  const denominator = p0 - 2 * control + p1;
  if (denominator !== 0) {
    const t = (p0 - control) / denominator;
    if (t > 0 && t < 1) {
      const u = 1 - t;
      const value = u * u * p0 + 2 * u * t * control + t * t * p1;
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
  }
  return [lo, hi];
}

/** Keeps an off-screen endpoint just outside the window rather than at infinity. */
function clampTime(t: number, start: number, end: number): number {
  const margin = (end - start) * 0.02;
  return Math.min(end + margin, Math.max(start - margin, t));
}

/** Structural type, so this module does not import the geometry factory's shape. */
interface DepthGeometryLike {
  width: number;
  height: number;
  horizonY: number;
  groundY: number;
  centreX: number;
  halfWidth: number;
}

/**
 * Which way an arc bows out of the corridor.
 *
 * Deterministic from the connection's id, so it never changes between frames,
 * and roughly balanced between the two sides.
 */
function bowDirection(source: ArcSource): number {
  const id = source.connection.id;
  return id.charCodeAt(id.length - 1) % 2 === 0 ? 1 : -1;
}

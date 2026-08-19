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

import type { Connection, Days, Era, Id, Tag, TimelineEvent, Viewport } from '../core/model/types';
import { computeDensity, farViewOpacity, heightFraction } from '../core/density';
import type { DensityResult } from '../core/density';
import { midpoint, toGregorian } from '../core/time';
import { arcPointAt, buildArcIndex, hitTestArc, layoutArcs } from './arcs';
import type { ArcLayout, ArcSource } from './arcs';
import { hitTestLanes, layoutLanes } from './lanes';
import type { LaneLayout } from './lanes';
import { linearScale } from './scale';
import { generateTicks } from './ticks';
import { formatYear } from './ticks';
import type { CanvasSize } from './canvas-host';

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
  /** Canonical era bars; personal ones take the selection hue. */
  era: string;
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
};

const AXIS_HEIGHT = 30;
const TOP_PADDING = 24;
const MARK_HEIGHT = 14;
const LABEL_FONT = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const LABEL_GAP = 14;
const LABEL_ROW_HEIGHT = 16;
const MAX_LABEL_ROWS = 12;
/** A ceiling on text drawn per frame, so a dense corpus cannot stall the loop. */
const MAX_LABELS = 160;
/**
 * Titles run long ("Tomás Vela is awarded the Ashcombe prize for work on a
 * vaccine for cattle plague carried out twenty years earlier"), and one of those
 * occupies a whole row on its own. Truncated here; the full title belongs in the
 * detail view.
 */
const MAX_LABEL_WIDTH = 240;

/** Fraction of the space above the axis that the tallest arc may occupy. */
const ARC_BAND = 0.92;
/** How close the cursor must come to a mark to select it. */
const MARK_TOLERANCE = 7;
/** Height of one era row, including its gap. */
const LANE_HEIGHT = 18;
/** Rows of eras, before the layout starts dropping them. */
const MAX_LANES = 8;

interface Mark {
  t: Days;
  event: TimelineEvent;
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

/** How long the mass takes to redistribute when the filter changes (§3.5). */
const TRANSITION_MS = 300;

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

  /**
   * A mass redistribution in flight (§3.5).
   *
   * Interpolating the two density grids is what makes a filter read as weight
   * moving rather than as one picture being swapped for another. It is `W`
   * floats and costs nothing.
   */
  private transition: {
    from: Float64Array;
    fromMax: number;
    start: number;
    /** The viewport the grids were computed for; a pan or zoom invalidates it. */
    key: string;
  } | null = null;
  /** Set by `setData`, consumed by the next draw, which has the grids to compare. */
  private pendingTransition = false;
  /** What the last frame actually put on screen — the start point of the next blend. */
  private lastDrawn: Float64Array | null = null;
  private lastDrawnMax = 0;

  /**
   * The arcs of the last frame, kept so hit-testing runs against exactly what is
   * on screen. Recomputing a layout to answer "what is under the cursor" is both
   * wasteful and a source of the classic bug where the hit target has drifted a
   * frame away from the thing the user can see.
   */
  private arcs: ArcLayout[] = [];
  private lanes: LaneLayout = { bars: [], laneCount: 0, dropped: 0 };
  private baselineY = 0;
  private laneTop = 0;

  /**
   * Events per pixel that counts as full height, calibrated once per corpus
   * rather than fixed (§3.4 leaves the constant open).
   *
   * A fixed value cannot serve both a timeline of fifty events and one of fifty
   * thousand: the same number that keeps a sparse corpus visible clips a dense
   * one flat across its peaks. Calibrating at full extent means the densest
   * period fills the frame when zoomed out, and everything shrinks honestly
   * from there as you zoom in and events per pixel fall.
   */
  private lambdaRef = 8;

  private cache: { key: string; density: DensityResult } | null = null;

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
    this.pendingTransition = this.cache !== null;
    this.cache = null;
    // Only when the corpus itself changed. Doing it on every filter change is
    // exactly the renormalisation `TimelineData.calibration` exists to prevent.
    if (recalibrate) this.lambdaRef = this.calibrate();
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

  /** The nearest mark to `x`, if the point is in the mark band and close enough. */
  eventAt(x: number, y: number): TimelineEvent | null {
    // Generous above the marks and below the axis: the tick is 14px tall and
    // aiming at a hairline is not a reasonable thing to ask of anyone.
    if (y < this.baselineY - MARK_HEIGHT - 8 || y > this.baselineY + 10) return null;

    const t = linearScale.toTime(x, this.viewport);
    const index = this.lowerBound(t);
    let best: TimelineEvent | null = null;
    let bestDistance = MARK_TOLERANCE;

    for (const candidate of [this.marks[index - 1], this.marks[index]]) {
      if (!candidate) continue;
      const distance = Math.abs(linearScale.toPx(candidate.t, this.viewport) - x);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = candidate.event;
      }
    }
    return best;
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

  private calibrate(): number {
    const extent = this.getExtent();
    if (!extent) return 8;
    const source = this.calibrationEvents.length > 0 ? this.calibrationEvents : this.events;
    const { lambdaMax } = computeDensity(
      source.map((e) => e.when),
      { ...extent, width: 1600 },
    );
    // A little headroom, so the tallest peak does not sit flush against the top.
    return lambdaMax > 0 ? lambdaMax * 1.15 : 8;
  }

  private viewportKey(): string {
    const { start, end, width } = this.viewport;
    return `${start}:${end}:${width}`;
  }

  private density(): DensityResult {
    const key = `${this.viewportKey()}:${this.events.length}`;
    if (this.cache && this.cache.key === key) return this.cache.density;

    const density = computeDensity(
      this.events.map((e) => e.when),
      this.viewport,
    );
    this.cache = { key, density };
    return density;
  }

  /**
   * The grid to draw: the target, or a blend towards it while a filter change
   * is redistributing (§3.5).
   *
   * Returns whether another frame is needed, so the host keeps drawing without
   * the renderer owning a timer — it has no business scheduling frames, and a
   * timer it owned would keep running after the canvas was destroyed.
   */
  private displayDensity(now: number): { density: DensityResult; animating: boolean } {
    const target = this.density();
    const key = this.viewportKey();

    if (this.pendingTransition) {
      this.pendingTransition = false;
      const previous = this.transition;
      // Mid-transition, blend from where it currently *looks*, not from where it
      // started — otherwise a second filter change snaps back before moving on.
      const from = previous && previous.key === key
        ? blend(previous.from, target.lambda, eased((now - previous.start) / TRANSITION_MS))
        : this.lastDrawn;
      if (from && from.length === target.lambda.length) {
        this.transition = {
          from,
          fromMax: this.lastDrawnMax,
          start: now,
          key,
        };
      } else {
        this.transition = null;
      }
    }

    const active = this.transition;
    // A pan or zoom recomputes the grid against a different window, so there is
    // nothing meaningful to interpolate and the transition is abandoned.
    if (!active || active.key !== key) {
      this.transition = null;
      this.lastDrawn = target.lambda;
      this.lastDrawnMax = target.lambdaMax;
      return { density: target, animating: false };
    }

    const t = eased((now - active.start) / TRANSITION_MS);
    if (t >= 1) {
      this.transition = null;
      this.lastDrawn = target.lambda;
      this.lastDrawnMax = target.lambdaMax;
      return { density: target, animating: false };
    }

    const lambda = blend(active.from, target.lambda, t);
    const lambdaMax = active.fromMax + (target.lambdaMax - active.fromMax) * t;
    this.lastDrawn = lambda;
    this.lastDrawnMax = lambdaMax;
    return { density: { ...target, lambda, lambdaMax }, animating: true };
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
    this.lanes = this.layoutEraLanes(vp, height);
    const eraBand = this.lanes.laneCount * LANE_HEIGHT;

    const baselineY = height - AXIS_HEIGHT - eraBand;
    const massTop = TOP_PADDING;
    const massHeight = baselineY - massTop;
    this.baselineY = baselineY;
    this.laneTop = baselineY + AXIS_HEIGHT;

    const ticks = generateTicks(vp);
    this.drawGrid(ctx, ticks, massTop, baselineY);

    const { density, animating } = this.displayDensity(performance.now());
    const massAlpha = farViewOpacity(density.lambdaMax);

    if (massAlpha > 0) {
      this.drawMass(ctx, density, massTop, baselineY, massHeight, massAlpha);
    }

    // Arcs over the mass and under the marks. The mass is the ground — what you
    // know — and the connections are the figure on it, which is the reading the
    // concept asks for: zoomed out, the connection structure should be the most
    // visually striking thing on screen.
    this.arcs = this.layout(vp, baselineY, massHeight);
    this.drawArcs(ctx, baselineY);

    if (massAlpha < 1) {
      this.drawMarks(ctx, vp, baselineY, 1 - massAlpha);
    }
    if (massAlpha < 0.35) {
      this.drawLabels(ctx, vp, massTop, baselineY, 1 - massAlpha / 0.35);
    }

    this.drawSelection(ctx, vp, baselineY, massTop);
    this.drawPendingArc(ctx, vp, baselineY, massHeight);
    this.drawAxis(ctx, ticks, vp, baselineY, width, height);
    this.drawEras(ctx, this.laneTop);
    this.drawCrosshair(ctx, vp, massTop, baselineY);

    return animating;
  }

  private layoutEraLanes(vp: Viewport, height: number): LaneLayout {
    if (this.eras.length === 0) return { bars: [], laneCount: 0, dropped: 0 };
    // Never let the eras crowd out the timeline itself: at most a third of the
    // canvas, whatever the corpus does.
    const affordable = Math.floor((height * 0.33) / LANE_HEIGHT);
    return layoutLanes(this.eras, (t) => linearScale.toPx(t, vp), vp.width, {
      maxLanes: Math.max(1, Math.min(MAX_LANES, affordable)),
      tagColours: this.tagColours,
      canonicalColour: this.theme.era,
      personalColour: this.theme.selection,
    });
  }

  /**
   * Era bars below the axis.
   *
   * The uncertain flanks are drawn as gradients rather than as edges, which is
   * the only honest way to render "the years I was reading Russian novels" — an
   * era whose `a`≠`b` has no first day, and a crisp edge would claim it does.
   */
  private drawEras(ctx: CanvasRenderingContext2D, top: number): void {
    if (this.lanes.bars.length === 0) return;
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

      const gradient = ctx.createLinearGradient(left, 0, right, 0);
      const solid = withAlpha(bar.colour, isSelected ? 0.85 : 0.5);
      const clear = withAlpha(bar.colour, 0);
      // Stops at the trapezoid's own corners, so the ramp is the era's stated
      // uncertainty rather than a decorative fade of arbitrary width.
      gradient.addColorStop(0, bar.fadeLeft > 0 ? clear : solid);
      gradient.addColorStop(clamp01((bar.x1 - left) / (right - left)), solid);
      gradient.addColorStop(clamp01((bar.x2 - left) / (right - left)), solid);
      gradient.addColorStop(1, bar.fadeRight > 0 ? clear : solid);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(left, barY, right - left, barHeight, 2);
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = bar.colour;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // The label sits in the visible part of the bar, not at its true start,
      // so an era running off the left edge stays named.
      const visibleLeft = Math.max(left, 4);
      const visibleRight = Math.min(right, this.viewport.width - 4);
      const room = visibleRight - visibleLeft - 8;
      if (room < 24) continue;

      const text = fitText(ctx, bar.era.name, room);
      ctx.fillStyle = isSelected ? this.theme.ink : this.theme.inkSecondary;
      ctx.fillText(text, visibleLeft + 4, barY + barHeight / 2 + 0.5);
    }

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
        : focus !== null
          ? 0.12
          : arc.whole
            ? 0.5
            : 0.28;
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
    const text = fitText(ctx, firstLine(note), MAX_LABEL_WIDTH * 1.4);
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

  private drawMass(
    ctx: CanvasRenderingContext2D,
    density: DensityResult,
    top: number,
    baselineY: number,
    massHeight: number,
    alpha: number,
  ): void {
    const { lambda } = density;
    const n = lambda.length;
    if (n === 0) return;

    const yAt = (i: number) =>
      baselineY - heightFraction(lambda[i] as number, this.lambdaRef) * massHeight;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    for (let i = 0; i < n; i++) ctx.lineTo(i, yAt(i));
    ctx.lineTo(n - 1, baselineY);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, top, 0, baselineY);
    gradient.addColorStop(0, withAlpha(this.theme.mass, 0.62));
    gradient.addColorStop(1, withAlpha(this.theme.mass, 0.08));
    ctx.fillStyle = gradient;
    ctx.fill();

    // A thin bright edge is what makes the shape legible; the fill alone reads
    // as a smudge at the shallow end.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(i, yAt(i));
      else ctx.lineTo(i, yAt(i));
    }
    ctx.strokeStyle = this.theme.massEdge;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.restore();
  }

  private drawMarks(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    baselineY: number,
    alpha: number,
  ): void {
    const from = this.lowerBound(vp.start);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.theme.mark;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = from; i < this.marks.length; i++) {
      const mark = this.marks[i] as Mark;
      if (mark.t > vp.end) break;
      const x = Math.round(linearScale.toPx(mark.t, vp)) + 0.5;
      ctx.moveTo(x, baselineY);
      ctx.lineTo(x, baselineY - MARK_HEIGHT);
    }

    ctx.stroke();
    ctx.restore();
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    top: number,
    baselineY: number,
    alpha: number,
  ): void {
    const from = this.lowerBound(vp.start);
    const opacity = Math.min(1, alpha);

    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'alphabetic';

    // Greedy placement down a stack of rows: a label takes the first row where
    // it clears whatever was last placed there. Selective by construction — a
    // label appears only where one fits — but it fills the space the vanished
    // mass leaves behind, which two alternating rows did not.
    const available = baselineY - MARK_HEIGHT - 8 - top;
    const rowCount = Math.max(1, Math.min(MAX_LABEL_ROWS, Math.floor(available / LABEL_ROW_HEIGHT)));
    const rowRight = new Array<number>(rowCount).fill(-Infinity);

    const placements: { x: number; textX: number; y: number; text: string; width: number }[] = [];

    for (let i = from; i < this.marks.length && placements.length < MAX_LABELS; i++) {
      const mark = this.marks[i] as Mark;
      if (mark.t > vp.end) break;

      const x = linearScale.toPx(mark.t, vp);
      const text = fitText(ctx, mark.event.title, MAX_LABEL_WIDTH);
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
      placements.push({
        x,
        textX,
        y: baselineY - MARK_HEIGHT - 8 - row * LABEL_ROW_HEIGHT,
        text,
        width,
      });
    }

    // Two passes. Leader lines from later marks would otherwise be drawn over
    // the text of labels already placed on lower rows, and a hairline through
    // the middle of a word is the difference between a chart and a mess.
    ctx.globalAlpha = opacity * 0.45;
    ctx.strokeStyle = this.theme.mark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of placements) {
      const x = Math.round(p.x) + 0.5;
      ctx.moveTo(x, baselineY - MARK_HEIGHT);
      ctx.lineTo(x, p.y + 3);
    }
    ctx.stroke();

    ctx.globalAlpha = opacity;
    for (const p of placements) {
      // A chip of the surface colour keeps the text legible where a leader line
      // from somewhere else crosses behind it.
      ctx.fillStyle = this.theme.surface;
      ctx.fillRect(p.textX - 2, p.y - 9, p.width + 4, 12);
      ctx.fillStyle = this.theme.inkSecondary;
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

    for (const tick of ticks) {
      const x = linearScale.toPx(tick.t, vp);
      if (x < 18 || x > width - 18) continue;
      ctx.fillText(tick.label, x, baselineY + 9);
    }

    ctx.textAlign = 'left';
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

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Date under the cursor, at a precision the current zoom can actually justify. */
export function formatMoment(t: Days, spanDays: number): string {
  const { year, month, day } = toGregorian(t);
  const spanYears = spanDays / 365.2425;
  if (spanYears > 24) return formatYear(year);
  if (spanYears > 2) return `${MONTHS[month - 1]} ${formatYear(year)}`;
  return `${day} ${MONTHS[month - 1]} ${formatYear(year)}`;
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

/** Truncates to `maxWidth`, appending an ellipsis only when it actually cuts. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Ease-in-out on the transition clock.
 *
 * Linear interpolation between two density grids reads as a mechanical wipe;
 * easing the ends makes the same arithmetic read as weight settling.
 */
function eased(t: number): number {
  const clamped = clamp01(t);
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - (-2 * clamped + 2) ** 2 / 2;
}

/** Linear blend of two density grids of equal length. */
function blend(from: Float64Array, to: Float64Array, t: number): Float64Array {
  const out = new Float64Array(from.length);
  for (let i = 0; i < out.length; i++) {
    const a = from[i] as number;
    out[i] = a + ((to[i] as number) - a) * t;
  }
  return out;
}

/** Hex to rgba, so one palette entry can serve both the fill ramp and the edge. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

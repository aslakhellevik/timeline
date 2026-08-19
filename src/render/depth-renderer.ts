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

import type { Connection, Days, Era, Id, Tag, TimelineEvent, Viewport } from '../core/model/types';
import { computeDensity, farViewOpacity, heightFraction } from '../core/density';
import type { DensityResult } from '../core/density';
import { midpoint, toGregorian } from '../core/time';
import { buildArcIndex } from './arcs';
import type { ArcSource } from './arcs';
import { layoutLanes } from './lanes';
import type { EraBar, LaneLayout } from './lanes';
import { MassTransition, clamp01 } from './mass-transition';
import { DepthProjection, depthGeometry } from './projection';
import { generateTicks, formatYear } from './ticks';
import type { CanvasSize } from './canvas-host';
import { DARK_THEME } from './timeline-renderer';
import type { Selection, Target, TimelineData, TimelineTheme } from './timeline-renderer';

const LABEL_FONT = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const TOP_PADDING = 12;
/** Widest the river gets, in lateral units (1 = the corridor's half-width). */
const MAX_RIVER = 0.5;
/** Where the innermost era lane begins, clear of the river at full width. */
const LANE_INNER = 0.6;
const LANE_STEP = 0.13;
const MAX_LANES = 3;
/** Vertical pixels a label needs to itself. */
const LABEL_PITCH = 15;
const MAX_LABELS = 26;
/** Shortest an arc gets, so a connection between neighbours is still a vault. */
const MIN_ARC = 12;
/** Below this on-screen scale, text is unreadable and marks are sub-pixel. */
const LEGIBLE_SCALE = 0.16;

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
  private hover: { x: number; y: number } | null = null;
  private selection: Selection = {};

  private readonly transition = new MassTransition();
  private cache: { key: string; density: DensityResult } | null = null;

  /** Events per day at which the river reaches its full width. */
  private rateRef = 1;

  /** The last frame's geometry, so hit-testing runs against what is on screen. */
  private projection: DepthProjection | null = null;
  private arcs: ArcShape[] = [];
  private lanes: { personal: LaneLayout; canonical: LaneLayout } | null = null;
  private riverAt: Float64Array | null = null;

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

    this.transition.begin();
    this.cache = null;
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

    const density = computeDensity(
      this.events.map((event) => event.when),
      { start, end, width: rows },
      { toPixel: (t) => projection.pixelAt(t) },
    );
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

    this.drawSky(ctx, geometry);
    this.drawGround(ctx, projection, geometry, vp);
    this.lanes = this.layoutEras(projection, rows);
    this.drawEras(ctx, projection);
    this.drawRiver(ctx, projection, geometry, rows);

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
    this.drawMarks(ctx, projection, density);
    this.drawLabels(ctx, projection, geometry, density);

    this.arcs = this.layoutArcs(projection, geometry);
    this.drawArcs(ctx);
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

  private drawRiver(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    geometry: DepthGeometryLike,
    rows: number,
  ): void {
    const widths = this.riverAt;
    if (!widths || rows < 2) return;

    const baseY = projection.yAt(this.viewport.start);
    const left: [number, number][] = [];
    const right: [number, number][] = [];

    for (let i = 0; i < rows; i++) {
      const y = baseY + i;
      const t = projection.timeAtY(y);
      const w = widths[i] as number;
      // A hairline even where there is nothing, so the corridor stays readable
      // as a continuous path through periods you know nothing about.
      const lateral = Math.max(w, 0.006);
      left.push([projection.xAt(t, -lateral), y]);
      right.push([projection.xAt(t, lateral), y]);
    }

    ctx.save();
    ctx.beginPath();
    for (const [x, y] of left) ctx.lineTo(x, y);
    for (let i = right.length - 1; i >= 0; i--) {
      const point = right[i] as [number, number];
      ctx.lineTo(point[0], point[1]);
    }
    ctx.closePath();

    // Brighter towards you: the near end is both what you know most about and
    // what the eye should land on first.
    const fill = ctx.createLinearGradient(0, geometry.horizonY, 0, geometry.groundY);
    fill.addColorStop(0, withAlpha(this.theme.mass, 0.22));
    fill.addColorStop(1, withAlpha(this.theme.mass, 0.75));
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = this.theme.massEdge;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = 0.85;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [x, y] of left) ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    for (const [x, y] of right) ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Ground, sky and the year rings
  // -------------------------------------------------------------------------

  private drawSky(ctx: CanvasRenderingContext2D, geometry: DepthGeometryLike): void {
    // A cold wash above the horizon, so the corridor reads as a space rather
    // than a shape on a flat background.
    const sky = ctx.createLinearGradient(0, 0, 0, geometry.horizonY + 40);
    sky.addColorStop(0, this.theme.surface);
    sky.addColorStop(1, withAlpha(this.theme.mass, 0.1));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, geometry.width, geometry.horizonY + 40);

    ctx.strokeStyle = withAlpha(this.theme.massEdge, 0.25);
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
      lastLabelY = y;
      ctx.globalAlpha = Math.min(1, 0.35 + scale);
      ctx.fillStyle = this.theme.muted;
      ctx.textAlign = 'right';
      ctx.fillText(tick.label, projection.xAt(tick.t, -1) - 6, y);
      ctx.textAlign = 'left';
      ctx.fillText(tick.label, projection.xAt(tick.t, 1) + 6, y);
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
      personalColour: this.theme.selection,
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

  private drawEras(ctx: CanvasRenderingContext2D, projection: DepthProjection): void {
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
        const inner = LANE_INNER + bar.lane * LANE_STEP;
        const outer = Math.min(1, inner + LANE_STEP * 0.8);
        this.drawEraBar(ctx, projection, bar, side, inner, outer, baseY, bar.era.id === selected);
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

    // Named at the near end, where the corridor is widest and there is room.
    const labelY = bottom - 8;
    if (bottom - top < 26) return;
    const t = projection.timeAtY(labelY);
    if (projection.scaleAt(t) < LEGIBLE_SCALE) return;

    const text = fitText(ctx, bar.era.name, 150);
    ctx.fillStyle = selected ? this.theme.ink : this.theme.inkSecondary;
    ctx.textAlign = side < 0 ? 'right' : 'left';
    ctx.fillText(text, projection.xAt(t, side * outer) + side * 6, labelY);
    ctx.textAlign = 'left';
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

  private drawMarks(
    ctx: CanvasRenderingContext2D,
    projection: DepthProjection,
    density: DensityResult,
  ): void {
    const from = this.lowerBound(this.viewport.start);
    ctx.save();
    ctx.strokeStyle = this.theme.mark;
    ctx.lineWidth = 1;

    for (let i = from; i < this.marks.length; i++) {
      const mark = this.marks[i] as Mark;
      if (mark.t > this.viewport.end) break;
      const scale = projection.scaleAt(mark.t);
      if (scale < 0.06) continue;
      const resolved = 1 - farViewOpacity(this.localLambda(projection, density, mark.t));
      if (resolved < 0.03) continue;

      const y = projection.yAt(mark.t);
      const w = this.riverLateralAt(projection, mark.t);
      ctx.globalAlpha = resolved * Math.min(1, 0.25 + scale * 1.6);
      ctx.beginPath();
      ctx.moveTo(projection.xAt(mark.t, -(w + 0.05)), y);
      ctx.lineTo(projection.xAt(mark.t, w + 0.05), y);
      ctx.stroke();
    }

    ctx.restore();
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
    let side: -1 | 1 = 1;
    const lastY: Record<string, number> = { '-1': Infinity, '1': Infinity };

    for (let i = visible.length - 1; i >= 0 && placed < MAX_LABELS; i--) {
      const mark = visible[i] as Mark;
      const scale = projection.scaleAt(mark.t);
      if (scale < LEGIBLE_SCALE) break;
      const alpha = 1 - farViewOpacity(this.localLambda(projection, density, mark.t));
      if (alpha < 0.15) continue;

      const y = projection.yAt(mark.t);
      if (y < geometry.horizonY + TOP_PADDING) break;
      if ((lastY[String(side)] as number) - y < LABEL_PITCH) {
        side = side === 1 ? -1 : 1;
        if ((lastY[String(side)] as number) - y < LABEL_PITCH) continue;
      }

      const w = this.riverLateralAt(projection, mark.t);
      const anchorX = projection.xAt(mark.t, side * (w + 0.08));
      const text = fitText(ctx, mark.event.title, 190);
      const width = ctx.measureText(text).width;
      const textX = side < 0 ? anchorX - 8 - width : anchorX + 8;
      if (textX < 4 || textX + width > geometry.width - 4) continue;

      ctx.strokeStyle = this.theme.mark;
      ctx.globalAlpha = alpha * 0.35;
      ctx.beginPath();
      ctx.moveTo(anchorX, y);
      ctx.lineTo(side < 0 ? textX + width + 3 : textX - 3, y);
      ctx.stroke();

      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.theme.surface;
      ctx.fillRect(textX - 2, y - 7, width + 4, 14);
      ctx.fillStyle =
        mark.event.id === this.selection.eventId ? this.theme.selection : this.theme.inkSecondary;
      ctx.fillText(text, textX, y);

      lastY[String(side)] = y;
      side = side === 1 ? -1 : 1;
      placed++;
    }

    ctx.restore();
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

      shapes.push({
        connection: source.connection,
        x1,
        y1,
        // Swept out to the side in proportion to reach. Every arc in this view is
        // rooted on the same centre line — the corridor has only one — so without
        // a lateral spread they collapse into a single braided rope. Long
        // connections swing wide and become the visible structure; local ones
        // stay a thread down the middle, which is the right emphasis anyway.
        cx:
          (x1 + x2) / 2 +
          scale * geometry.halfWidth * (0.2 + 1.1 * Math.sqrt(reach)) * bowDirection(source),
        cy: midY - 2 * apex,
        x2,
        y2,
        colour: source.colour,
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

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const arc of this.arcs) {
      const touches =
        focus !== null && (arc.connection.from === focus || arc.connection.to === focus);
      const isSelected = arc.connection.id === selected;
      ctx.globalAlpha = isSelected || touches ? 0.95 : focus !== null ? 0.1 : 0.3;
      ctx.lineWidth = isSelected ? 2.2 : touches ? 1.7 : 0.9;
      ctx.strokeStyle = isSelected ? this.theme.selection : arc.colour;

      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      ctx.quadraticCurveTo(arc.cx, arc.cy, arc.x2, arc.y2);
      ctx.stroke();
    }

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
    const magnitude = Math.abs(lateral);
    if (magnitude < LANE_INNER - 0.04 || magnitude > 1.08) return null;

    const layout = side < 0 ? this.lanes.personal : this.lanes.canonical;
    const lane = Math.round((magnitude - LANE_INNER) / LANE_STEP);
    const pixel = projection.pixelAt(t);

    for (const bar of layout.bars) {
      if (bar.lane !== lane) continue;
      if (pixel >= bar.x1 - bar.fadeLeft && pixel <= bar.x2 + bar.fadeRight) return bar.era;
    }
    return null;
  }

  private arcAt(x: number, y: number): ArcShape | null {
    let best: ArcShape | null = null;
    let bestDistance = 36;

    for (const arc of this.arcs) {
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

function formatMoment(t: Days, spanDays: number): string {
  const { year, month, day } = toGregorian(t);
  const spanYears = spanDays / 365.2425;
  if (spanYears > 24) return formatYear(year);
  if (spanYears > 2) return `${MONTHS[month - 1]} ${formatYear(year)}`;
  return `${day} ${MONTHS[month - 1]} ${formatYear(year)}`;
}

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

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

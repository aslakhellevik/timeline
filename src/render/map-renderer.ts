/**
 * The spatial view (docs/design.md §11, D17) — where the things you know
 * happened.
 *
 * Framework-agnostic by rule (D11), like the other two renderers, and it shares
 * their machinery where the two genuinely agree: `computeDensity` drives the
 * scrubber strip, and the tag palette is the same one the arcs and era bars use.
 *
 * ## Coupled to time, which is the whole point
 *
 * A static map of everything is a poor picture of a personal corpus — it says
 * where you have read about, not what happened when. So the map draws only what
 * falls inside the current time window, and carries a scrubber along the bottom:
 * drag it and the dots fill in and drain away. The window is the same
 * `(start, end)` the timeline views use, so switching views keeps your place.
 *
 * ## Vagueness is drawn, not hidden
 *
 * Most events are placed by their region tag rather than by coordinates, so most
 * dots are claims about a continent. Each is drawn with a halo at its true
 * radius — an event tagged only *Asia* is a soft disc two thousand kilometres
 * across, because that is what is actually known about it. Rendering it as a
 * neat dot would be the same lie the time model refuses to tell about dates.
 */

import type { Days, Id, Tag, TimelineEvent, Viewport } from '../core/model/types';
import { computeDensity } from '../core/density';
import {
  PROJECTED_HALF_HEIGHT,
  PROJECTED_HALF_WIDTH,
  clusterEvents,
  landRings,
  locate,
  project,
  unproject,
} from '../core/geo';
import type { Cluster } from '../core/geo';
import { formatYear } from './ticks';
import { toGregorian } from '../core/time';
import type { CanvasSize } from './canvas-host';
import { DARK_THEME } from './timeline-renderer';
import type { TimelineTheme } from './timeline-renderer';
import { LABEL_FONT, fitText } from './text';
import { withAlpha } from './colour';
import { revealWindow } from './viewport';

/** Height of the time scrubber along the bottom. */
const SCRUB_HEIGHT = 54;
const PADDING = 16;
/** Radius of a one-event dot; a cluster grows as the square root of its count. */
const DOT_BASE = 3.4;
/**
 * Widest a dot gets, whatever it holds.
 *
 * Area proportional to count is the right encoding and the cap is where it stops
 * being drawable: a Europe of 497 events wants a radius of 76 px, which is a
 * 150 px disc over a continent 300 px wide. But the old cap of 26 saturated at
 * 59 events, so 497 and 61 were the same dot — the encoding was gone across most
 * of the range that matters. Forty saturates at 138, and above that the count
 * label carries what the area no longer can.
 */
const MAX_DOT = 40;
/** How close two dots may be before they merge, in pixels. */
const CLUSTER_RADIUS = 22;
/** Kilometres per degree of latitude, for turning a vagueness radius into pixels. */
const KM_PER_DEGREE = 111.32;
/** Derived from the same constant, so the halo and a click agree about scale. */
const EARTH_RADIUS_KM = (KM_PER_DEGREE * 180) / Math.PI;

/** What the cursor is over. */
export type MapTarget =
  | { kind: 'cluster'; cluster: Cluster }
  | { kind: 'scrubber' };

/** Pan and zoom over the projected world. */
export interface MapCamera {
  /** Centre of the view, in projected units. */
  cx: number;
  cy: number;
  /** Pixels per projected unit. */
  k: number;
}

export interface MapData {
  /** Events passing the filter — what the map may draw. */
  events: readonly TimelineEvent[];
  tags?: readonly Tag[];
  /** The unfiltered corpus, for the scrubber's density (D31). */
  calibration?: readonly TimelineEvent[];
}

export class MapRenderer {
  private theme: TimelineTheme;
  private events: readonly TimelineEvent[] = [];
  private calibrationEvents: readonly TimelineEvent[] = [];
  private tagColours: Map<Id, string> = new Map();

  private viewport: Viewport = { start: 0, end: 1, width: 1 };
  private extent: { start: number; end: number } = { start: 0, end: 1 };
  private camera: MapCamera = { cx: 0, cy: 0, k: 1 };
  private cameraSet = false;
  private hover: { x: number; y: number } | null = null;
  private selectedId: Id | null = null;
  private connectFrom: Id | null = null;

  /** The last frame's clusters, so hit-testing runs against what is on screen. */
  private clusters: Cluster[] = [];
  private mapHeight = 0;
  private size: CanvasSize = { width: 0, height: 0, dpr: 1 };
  /**
   * The scrubber's density strip, kept between frames.
   *
   * It is computed over the **whole corpus** at the **whole extent**, neither of
   * which changes when the window moves — but it was being recomputed inside the
   * draw, and `MapView` asks for a draw on every `pointermove`. At fifty
   * thousand events that is a nineteen-millisecond kernel evaluation per mouse
   * move, for a shape that is pixel-for-pixel identical to the last one.
   */
  private stripCache: { key: string; lambda: Float64Array; lambdaMax: number } | null = null;

  constructor(theme: TimelineTheme = DARK_THEME) {
    this.theme = theme;
  }

  setData(data: MapData): void {
    this.events = data.events;
    this.calibrationEvents = data.calibration ?? data.events;
    this.tagColours = new Map(
      (data.tags ?? []).flatMap((tag) => (tag.color ? [[tag.id, tag.color] as const] : [])),
    );
    this.extent = this.computeExtent();
    this.stripCache = null;
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

  setSelection(id: Id | null): void {
    this.selectedId = id;
  }

  /** The first endpoint of a connection being made, or `null` when none is armed. */
  setConnectFrom(id: Id | null): void {
    this.connectFrom = id;
  }

  getCamera(): MapCamera {
    return this.camera;
  }

  setCamera(camera: MapCamera): void {
    // Clamped so the world cannot be thrown off screen or shrunk to a speck.
    const minK = Math.max(1, this.size.width) / (PROJECTED_HALF_WIDTH * 2.6);
    const k = Math.min(minK * 40, Math.max(minK, camera.k));
    this.camera = {
      k,
      cx: Math.min(PROJECTED_HALF_WIDTH, Math.max(-PROJECTED_HALF_WIDTH, camera.cx)),
      cy: Math.min(PROJECTED_HALF_HEIGHT, Math.max(-PROJECTED_HALF_HEIGHT, camera.cy)),
    };
    this.cameraSet = true;
  }

  /** Height of the map area, above the scrubber. */
  getMapHeight(): number {
    return this.mapHeight;
  }

  private computeExtent(): { start: number; end: number } {
    const source =
      this.calibrationEvents.length > 0 ? this.calibrationEvents : this.events;
    if (source.length === 0) return { start: 0, end: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const event of source) {
      if (event.when.a < min) min = event.when.a;
      if (event.when.d > max) max = event.when.d;
    }
    return max > min ? { start: min, end: max } : { start: min, end: min + 1 };
  }

  /** Projected units to screen pixels. */
  private toScreen = (lon: number, lat: number): { x: number; y: number } => {
    const p = project(lon, lat);
    return {
      x: (p.x - this.camera.cx) * this.camera.k + this.size.width / 2,
      y: -(p.y - this.camera.cy) * this.camera.k + this.mapHeight / 2,
    };
  };

  /**
   * Kilometres per screen pixel at the current zoom.
   *
   * Exact enough to be worth having: Equal Earth is equal-*area*, and its `x`
   * is radians of longitude at the equator, so one projected unit is one Earth
   * radius of arc however the local shape is stretched. What it is for is
   * turning a click into a **precision** — a click on a world map cannot mean a
   * street corner, and D43 says the map must draw how vague a location really
   * is rather than flatter it into a neat dot.
   */
  kmPerPixel(): number {
    return EARTH_RADIUS_KM / Math.max(this.camera.k, 1e-9);
  }

  /** Screen pixels back to the globe. */
  screenToLonLat(x: number, y: number): { lon: number; lat: number } {
    const px = (x - this.size.width / 2) / this.camera.k + this.camera.cx;
    const py = -(y - this.mapHeight / 2) / this.camera.k + this.camera.cy;
    return unproject(px, py);
  }

  /** Events whose span overlaps the current window. */
  private inWindow(): TimelineEvent[] {
    const { start, end } = this.viewport;
    // Overlap rather than midpoint: the Second World War belongs on the map for
    // every year of it, not only for 1942.
    return this.events.filter((event) => event.when.a <= end && event.when.d >= start);
  }

  draw(ctx: CanvasRenderingContext2D, size: CanvasSize): boolean {
    this.size = size;
    const { width, height } = size;
    ctx.fillStyle = this.theme.surface;
    ctx.fillRect(0, 0, width, height);
    if (width < 80 || height < 120) return false;

    this.mapHeight = height - SCRUB_HEIGHT;
    if (!this.cameraSet) this.fitWorld();

    const vp = { ...this.viewport, width };
    this.viewport = vp;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, this.mapHeight);
    ctx.clip();

    this.drawOcean(ctx, width);
    this.drawGraticule(ctx);
    this.drawLand(ctx);

    this.clusters = clusterEvents(this.inWindow(), this.toScreen, CLUSTER_RADIUS, dotRadius);
    this.drawHalos(ctx);
    this.drawClusters(ctx);
    this.drawPending(ctx);

    ctx.restore();

    this.drawScrubber(ctx, vp, width, height);
    this.drawReadout(ctx, width);
    return false;
  }

  /**
   * Frames the whole world.
   *
   * Fitted to **both** axes, not just the width: on a wide canvas the width fit
   * pushes the Arctic and Antarctic off the top and bottom, and the first thing
   * that disappears is northern Europe — where a European user's corpus mostly
   * is.
   */
  fitWorld(): void {
    const byWidth = (this.size.width - PADDING * 2) / (PROJECTED_HALF_WIDTH * 2);
    const byHeight = (this.mapHeight - PADDING * 2) / (PROJECTED_HALF_HEIGHT * 2);
    this.camera = { cx: 0, cy: 0, k: Math.max(0.0001, Math.min(byWidth, byHeight)) };
    this.cameraSet = true;
  }

  private drawOcean(ctx: CanvasRenderingContext2D, width: number): void {
    // The sea is the surface colour with a wash of the mass hue, so the map
    // reads as part of the same picture as the timeline rather than a new one.
    const gradient = ctx.createLinearGradient(0, 0, 0, this.mapHeight);
    gradient.addColorStop(0, this.theme.surface);
    gradient.addColorStop(1, withAlpha(this.theme.mass, 0.09));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, this.mapHeight);
  }

  private drawGraticule(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;

    for (let lon = -180; lon <= 180; lon += 30) {
      ctx.beginPath();
      for (let lat = -90; lat <= 90; lat += 3) {
        const { x, y } = this.toScreen(lon, lat);
        if (lat === -90) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 5) {
        const { x, y } = this.toScreen(lon, lat);
        if (lon === -180) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // The equator, slightly stronger — the one line that is not arbitrary.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.theme.gridMajor;
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 5) {
      const { x, y } = this.toScreen(lon, 0);
      if (lon === -180) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawLand(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.beginPath();
    for (const ring of landRings()) {
      for (let i = 0; i < ring.length; i++) {
        const point = ring[i] as readonly [number, number];
        const { x, y } = this.toScreen(point[0], point[1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = this.theme.gridMajor;
    ctx.fill('evenodd');
    ctx.strokeStyle = this.theme.muted;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The vagueness halos, all of them, before any dot (D43).
   *
   * One pass rather than one per cluster, because interleaving them meant every
   * small cluster's halo was painted over the large dots already drawn — a wash
   * of translucent grey over precisely the dots the eye was meant to land on.
   *
   * And a **ring** rather than a filled disc. The claim a halo makes is "this is
   * known to within about here", which is a statement about an edge; a
   * continent-scale disc at world zoom is 125 px of flat translucency that
   * swamps the map without saying anything the outline does not. A hairline at
   * the true radius, with a very soft gradient inside it to keep it from reading
   * as a drawn boundary, states the size and leaves the map underneath legible.
   */
  private drawHalos(ctx: CanvasRenderingContext2D): void {
    if (this.clusters.length === 0) return;
    ctx.save();

    for (const cluster of this.clusters) {
      const radius = dotRadius(cluster.events.length);
      const halo = this.haloRadius(cluster);
      // Nothing to say when the halo is barely wider than the dot: the dot is
      // already the claim, and a ring hugging it reads as a rendering artefact.
      if (halo <= radius * 1.6) continue;

      const colour = this.colourOf(cluster);
      const glow = ctx.createRadialGradient(cluster.x, cluster.y, radius, cluster.x, cluster.y, halo);
      glow.addColorStop(0, withAlpha(colour, 0.05));
      glow.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cluster.x, cluster.y, halo, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = withAlpha(colour, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cluster.x, cluster.y, halo, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Dots, sized by how many events they hold.
   *
   * Area proportional to count, so the radius grows as the square root — the
   * standard encoding, and the one that stops a cluster of four hundred from
   * swallowing the continent it sits on.
   */
  private drawClusters(ctx: CanvasRenderingContext2D): void {
    if (this.clusters.length === 0) return;
    ctx.save();

    for (const cluster of this.clusters) {
      const colour = this.colourOf(cluster);
      const radius = dotRadius(cluster.events.length);
      const selected = cluster.events.some((event) => event.id === this.selectedId);

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(cluster.x, cluster.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = selected ? this.theme.selection : this.theme.surface;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();

      // A count, once the dot is big enough to hold one. Above the size cap it
      // is the only thing still saying how many, so it earns its place.
      if (cluster.events.length > 1 && radius >= 9) {
        ctx.font = LABEL_FONT;
        ctx.fillStyle = this.theme.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(cluster.events.length), cluster.x, cluster.y + 0.5);
        ctx.textAlign = 'left';
      }
    }

    ctx.restore();
  }

  /**
   * The connection being drawn, from its first endpoint to the cursor (§6.4).
   *
   * The other two views draw it and this one did not, which made the map the one
   * place where arming a connection and then clicking looked like nothing was
   * happening — even though the click completes it. An event with no place at
   * all cannot be drawn from, and the armed banner above the canvas is then the
   * only statement there is.
   */
  private drawPending(ctx: CanvasRenderingContext2D): void {
    const from = this.connectFrom;
    if (!from || !this.hover || this.hover.y > this.mapHeight) return;

    const source = this.clusters.find((cluster) =>
      cluster.events.some((event) => event.id === from),
    );
    if (!source) return;

    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = this.theme.selection;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(this.hover.x, this.hover.y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(source.x, source.y, dotRadius(source.events.length) + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** The cluster's stated vagueness, in pixels at the current zoom. */
  private haloRadius(cluster: Cluster): number {
    const degrees = cluster.precision / KM_PER_DEGREE;
    const north = this.toScreen(cluster.lon, Math.min(89, cluster.lat + degrees));
    return Math.min(260, Math.abs(north.y - cluster.y));
  }

  private colourOf(cluster: Cluster): string {
    for (const event of cluster.events) {
      for (const tag of event.tags) {
        const colour = this.tagColours.get(tag);
        if (colour) return colour;
      }
    }
    return this.theme.massEdge;
  }

  /** The whole-corpus density behind the scrubber, computed at most once per shape. */
  private strip(extent: { start: number; end: number; width: number }): {
    lambda: Float64Array;
    lambdaMax: number;
  } {
    const key = `${extent.start}:${extent.end}:${extent.width}`;
    if (this.stripCache && this.stripCache.key === key) return this.stripCache;

    const { lambda, lambdaMax } = computeDensity(
      (this.calibrationEvents.length > 0 ? this.calibrationEvents : this.events).map(
        (event) => event.when,
      ),
      extent,
    );
    this.stripCache = { key, lambda, lambdaMax };
    return this.stripCache;
  }

  /**
   * The time scrubber: the whole corpus as a density strip, with the current
   * window as a lit band. Dragging it is what makes the map fill in and drain.
   */
  private drawScrubber(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    width: number,
    height: number,
  ): void {
    const top = height - SCRUB_HEIGHT;
    ctx.save();
    ctx.fillStyle = this.theme.surface;
    ctx.fillRect(0, top, width, SCRUB_HEIGHT);
    ctx.strokeStyle = this.theme.gridMajor;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(width, top + 0.5);
    ctx.stroke();

    const strip = { start: this.extent.start, end: this.extent.end, width };
    const { lambda, lambdaMax } = this.strip(strip);

    // The strip is a shape, not a measurement — normalised to its own peak so it
    // is legible whatever the corpus size.
    const barTop = top + 10;
    const barHeight = SCRUB_HEIGHT - 26;
    if (lambdaMax > 0) {
      ctx.beginPath();
      ctx.moveTo(0, top + SCRUB_HEIGHT - 16);
      for (let i = 0; i < lambda.length; i++) {
        const value = (lambda[i] as number) / lambdaMax;
        ctx.lineTo(i, barTop + barHeight * (1 - Math.sqrt(value)));
      }
      ctx.lineTo(lambda.length - 1, top + SCRUB_HEIGHT - 16);
      ctx.closePath();
      ctx.fillStyle = withAlpha(this.theme.massEdge, 0.5);
      ctx.fill();
    }

    const from = ((vp.start - strip.start) / (strip.end - strip.start)) * width;
    const to = ((vp.end - strip.start) / (strip.end - strip.start)) * width;
    const left = Math.max(0, Math.min(width, from));
    const right = Math.max(0, Math.min(width, to));

    ctx.fillStyle = withAlpha(this.theme.selection, 0.1);
    ctx.fillRect(left, top + 4, Math.max(2, right - left), SCRUB_HEIGHT - 20);
    ctx.strokeStyle = this.theme.selection;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;
    ctx.strokeRect(left + 0.5, top + 4.5, Math.max(2, right - left) - 1, SCRUB_HEIGHT - 21);

    ctx.globalAlpha = 1;
    ctx.font = LABEL_FONT;
    ctx.fillStyle = this.theme.muted;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(yearOf(strip.start), 4, height - 4);
    ctx.textAlign = 'right';
    ctx.fillText(yearOf(strip.end), width - 4, height - 4);
    ctx.textAlign = 'center';
    ctx.fillStyle = this.theme.inkSecondary;
    ctx.fillText(
      `${yearOf(vp.start)} – ${yearOf(vp.end)}`,
      Math.min(width - 60, Math.max(60, (left + right) / 2)),
      height - 4,
    );
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /** What is under the cursor, named. */
  private drawReadout(ctx: CanvasRenderingContext2D, width: number): void {
    if (!this.hover || this.hover.y > this.mapHeight) return;
    const target = this.hitTest(this.hover.x, this.hover.y);
    if (target?.kind !== 'cluster') return;

    const { cluster } = target;
    const lines = cluster.events.slice(0, 4).map((event) => event.title);
    if (cluster.events.length > lines.length) {
      lines.push(`and ${cluster.events.length - lines.length} more`);
    }

    ctx.save();
    ctx.font = LABEL_FONT;
    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const boxWidth = Math.min(280, textWidth + 16);
    const boxHeight = lines.length * 15 + 10;
    const x = Math.min(width - boxWidth - 6, Math.max(6, cluster.x + 14));
    const y = Math.max(6, cluster.y - boxHeight - 10);

    ctx.fillStyle = this.theme.gridMajor;
    ctx.globalAlpha = 0.96;
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, 4);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.ink;
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
      ctx.fillText(fitText(ctx, line, boxWidth - 16), x + 8, y + 6 + index * 15);
    });
    ctx.restore();
  }

  hitTest(x: number, y: number): MapTarget | null {
    if (y > this.mapHeight) return { kind: 'scrubber' };

    // Smallest first, so a one-event dot sitting on a large cluster stays
    // reachable — the same reasoning as marks winning over arcs in the flat view.
    let best: Cluster | null = null;
    let bestSize = Infinity;
    for (const cluster of this.clusters) {
      const reach = Math.max(dotRadius(cluster.events.length), 7);
      if ((cluster.x - x) ** 2 + (cluster.y - y) ** 2 > reach * reach) continue;
      if (cluster.events.length < bestSize) {
        bestSize = cluster.events.length;
        best = cluster;
      }
    }
    return best ? { kind: 'cluster', cluster: best } : null;
  }

  /** Time at a horizontal position on the scrubber. */
  timeAtScrubber(x: number): number {
    const fraction = Math.max(0, Math.min(1, x / Math.max(1, this.size.width)));
    return this.extent.start + fraction * (this.extent.end - this.extent.start);
  }

  getExtent(): { start: number; end: number } {
    return this.extent;
  }

  /**
   * The time window that would bring `[from, to]` into view, or `null` when it
   * is already there (§6.1).
   *
   * The map needs it as much as the timelines do and for a sharper reason: an
   * event outside the window is not drawn *at all* here, so selecting one from
   * the list would otherwise leave the map showing nothing to look at. Bounds
   * are the corpus extent, which is also what the scrubber spans.
   */
  revealTime(from: Days, to: Days): Viewport | null {
    return revealWindow(this.viewport, from, to, { min: this.extent.start, max: this.extent.end });
  }

  /**
   * Recentres the camera on the event's cluster, if it is off screen.
   *
   * Only if: at world zoom every dot is already visible, and sliding the globe
   * sideways to put Europe in the middle would move the picture without showing
   * anything new. Returns whether it moved, so the caller knows whether a redraw
   * is owed.
   *
   * The camera jumps rather than eases, unlike the time window. A pan across the
   * Atlantic and a zoom of the time axis are different motions, and animating
   * this one would need a second interpolator for something the selection ring
   * already explains.
   */
  revealEvent(id: Id): boolean {
    // Nothing has been drawn yet: the camera is about to be fitted to the whole
    // world by `draw`, which shows everything there is to reveal.
    if (this.size.width === 0 || this.mapHeight === 0) return false;

    const event = this.events.find((candidate) => candidate.id === id);
    const placed = event ? locate(event.place, event.tags) : null;
    if (!placed) return false;

    const { x, y } = this.toScreen(placed.lon, placed.lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const margin = MAX_DOT + PADDING;
    if (x > margin && x < this.size.width - margin && y > margin && y < this.mapHeight - margin) {
      return false;
    }

    const point = project(placed.lon, placed.lat);
    this.setCamera({ ...this.camera, cx: point.x, cy: point.y });
    return true;
  }
}

/**
 * Drawn radius of a dot holding `count` events.
 *
 * A free function rather than a method because `clusterEvents` needs it too —
 * whether two dots overlap is a question about how they are drawn, and the
 * clustering and the drawing disagreeing about that is what produced a stack of
 * five discs over France.
 */
function dotRadius(count: number): number {
  return Math.min(MAX_DOT, DOT_BASE * Math.sqrt(count));
}

function yearOf(days: number): string {
  return formatYear(toGregorian(days).year);
}

export const MAP_SCRUBBER_HEIGHT = SCRUB_HEIGHT;

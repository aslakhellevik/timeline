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

import type { Id, Tag, TimelineEvent, Viewport } from '../core/model/types';
import { computeDensity } from '../core/density';
import {
  PROJECTED_HALF_HEIGHT,
  PROJECTED_HALF_WIDTH,
  clusterEvents,
  landRings,
  project,
  unproject,
} from '../core/geo';
import type { Cluster } from '../core/geo';
import { formatYear } from './ticks';
import { toGregorian } from '../core/time';
import type { CanvasSize } from './canvas-host';
import { DARK_THEME } from './timeline-renderer';
import type { TimelineTheme } from './timeline-renderer';

const LABEL_FONT = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
/** Height of the time scrubber along the bottom. */
const SCRUB_HEIGHT = 54;
const PADDING = 16;
/** Radius of a one-event dot; a cluster grows as the square root of its count. */
const DOT_BASE = 3.4;
const MAX_DOT = 26;
/** How close two dots may be before they merge, in pixels. */
const CLUSTER_RADIUS = 22;
/** Kilometres per degree of latitude, for turning a vagueness radius into pixels. */
const KM_PER_DEGREE = 111.32;

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

  /** The last frame's clusters, so hit-testing runs against what is on screen. */
  private clusters: Cluster[] = [];
  private mapHeight = 0;
  private size: CanvasSize = { width: 0, height: 0, dpr: 1 };

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

    this.clusters = clusterEvents(this.inWindow(), this.toScreen, CLUSTER_RADIUS);
    this.drawClusters(ctx);

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
   * Dots, sized by how many events they hold and haloed by how vague they are.
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
      const radius = Math.min(MAX_DOT, DOT_BASE * Math.sqrt(cluster.events.length));
      const selected = cluster.events.some((event) => event.id === this.selectedId);

      // The vagueness halo, in real kilometres projected to pixels.
      const halo = this.haloRadius(cluster);
      if (halo > radius * 1.6) {
        // Faint: a continent-sized halo at any real opacity swamps the map it is
        // drawn on, and the point is to qualify the dot, not to replace it.
        ctx.globalAlpha = 0.055;
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(cluster.x, cluster.y, halo, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(cluster.x, cluster.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = selected ? this.theme.selection : this.theme.surface;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();

      // A count, once the dot is big enough to hold one.
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
    const { lambda, lambdaMax } = computeDensity(
      (this.calibrationEvents.length > 0 ? this.calibrationEvents : this.events).map(
        (event) => event.when,
      ),
      strip,
    );

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
      const radius = Math.min(MAX_DOT, DOT_BASE * Math.sqrt(cluster.events.length));
      const reach = Math.max(radius, 7);
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
}

function yearOf(days: number): string {
  return formatYear(toGregorian(days).year);
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

export const MAP_SCRUBBER_HEIGHT = SCRUB_HEIGHT;

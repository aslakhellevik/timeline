/**
 * Connection arcs (docs/design.md §6.1).
 *
 * Quadratic Béziers above the axis. Split out from the renderer because the
 * geometry is the part with decisions in it — how tall an arc gets, which ones
 * are worth drawing, which one the cursor is over — and all three are pure
 * functions of pixels that can be tested without a canvas.
 *
 * No framework imports, and no canvas either: this file computes a layout, and
 * the renderer strokes it.
 */

import type { Connection, Days, Id, TimelineEvent } from '../core/model/types';

/**
 * A connection reduced to what a frame needs: two times and a colour.
 *
 * Built once per data change by `buildArcIndex`. The point is that nothing on
 * the per-frame path touches the event store — resolving two events by id per
 * connection cost more than three milliseconds a frame at ten thousand
 * connections, most of it spent proving that arcs off-screen are off-screen.
 */
export interface ArcSource {
  connection: Connection;
  /** Endpoint positions on the time axis. */
  t1: Days;
  t2: Days;
  colour: string;
}

/** One arc, in device-independent pixels, ready to stroke. */
export interface ArcLayout {
  connection: Connection;
  x1: number;
  x2: number;
  /** Control point of the quadratic Bézier. */
  cx: number;
  cy: number;
  /** Height above the baseline at the top of the curve. */
  apex: number;
  colour: string;
  /** Both endpoints visible — a partially off-screen arc is drawn dimmer. */
  whole: boolean;
}

export interface ArcOptions {
  baselineY: number;
  /** Tallest an arc may reach above the baseline. */
  maxApex: number;
  /** Shortest, so a connection between neighbouring events is still an arc. */
  minApex?: number;
  /** A ceiling on arcs per frame, so a dense corpus cannot stall the loop. */
  limit?: number;
}

const DEFAULT_MIN_APEX = 10;
/**
 * The most arcs laid out in one frame.
 *
 * Not a nicety: culling cannot help here. An arc with one endpoint on each side
 * of the viewport crosses it however far you zoom in, so at ten thousand
 * connections a narrow window still contains thousands of them. The cap is what
 * bounds the frame.
 *
 * Because the index is ordered longest-first, the cap keeps the longest arcs —
 * the ones carrying the large-scale structure the far view exists to show. That
 * is also stable frame to frame, which matters more than which arcs are chosen:
 * a limit admitting a different subset each frame would flicker.
 */
export const DEFAULT_ARC_LIMIT = 2000;

/**
 * How far a coordinate may sit outside the viewport before it is clamped.
 *
 * An arc between events ten thousand years apart, viewed at a span of one day,
 * puts an endpoint billions of pixels away. The curve through that point is
 * indistinguishable on screen from the curve through a point eight screens away,
 * and only one of the two survives being flattened by the rasteriser.
 */
const OFFSCREEN_CLAMP = 8;

/**
 * Apex height from horizontal distance.
 *
 * Growth is as √distance and saturates at one viewport width, which is what the
 * design means by "capped so long arcs flatten rather than leaving the screen".
 * Sub-linear growth is the point: linear height would make a millennium-spanning
 * arc leave the top of the screen while a decade-spanning one stayed flat on the
 * axis, and the useful signal is the *ordering* of spans, not their ratio.
 */
export function arcApex(
  distance: number,
  width: number,
  maxApex: number,
  minApex: number = DEFAULT_MIN_APEX,
): number {
  if (width <= 0) return minApex;
  const t = Math.sqrt(Math.min(1, Math.abs(distance) / width));
  return minApex + (Math.max(maxApex, minApex) - minApex) * t;
}

/**
 * The connection's colour, in the order the concept cares about.
 *
 * A connection's own tags win, because tagging the connection is the explicit
 * statement about what kind of link it is. Failing that, a tag both endpoints
 * share is the next best evidence — a connection between two events both tagged
 * *philosophy* is a philosophy connection whether or not anyone said so — and
 * only then either endpoint alone.
 */
export function connectionColour(
  connection: Connection,
  from: TimelineEvent | undefined,
  to: TimelineEvent | undefined,
  tagColours: ReadonlyMap<Id, string>,
  fallback: string,
): string {
  const first = (tags: readonly Id[] | undefined): string | undefined => {
    for (const tag of tags ?? []) {
      const colour = tagColours.get(tag);
      if (colour) return colour;
    }
    return undefined;
  };

  const own = first(connection.tags);
  if (own) return own;

  if (from && to && from.tags.length > 0 && to.tags.length > 0) {
    for (const tag of from.tags) {
      if (!to.tags.includes(tag)) continue;
      const colour = tagColours.get(tag);
      if (colour) return colour;
    }
  }

  return first(from?.tags) ?? first(to?.tags) ?? fallback;
}

/**
 * Reduces the connections to what a frame needs, once per data change.
 *
 * A connection whose endpoint the filter has hidden is dropped here rather than
 * drawn — an arc terminating in nothing reads as a rendering bug, not a filter
 * (§3.5) — as is a tombstone.
 *
 * The result is ordered by span, longest first, which is what makes the frame
 * limit keep the arcs that carry the structure rather than an arbitrary subset.
 */
export function buildArcIndex(
  connections: readonly Connection[],
  events: ReadonlyMap<Id, TimelineEvent>,
  timeOf: (event: TimelineEvent) => Days,
  tagColours: ReadonlyMap<Id, string>,
  fallback: string,
): ArcSource[] {
  const index: ArcSource[] = [];

  for (const connection of connections) {
    if (connection.deleted_at) continue;
    const from = events.get(connection.from);
    const to = events.get(connection.to);
    if (!from || !to) continue;

    const t1 = timeOf(from);
    const t2 = timeOf(to);
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue;

    index.push({
      connection,
      t1,
      t2,
      colour: connectionColour(connection, from, to, tagColours, fallback),
    });
  }

  index.sort((a, b) => Math.abs(b.t2 - b.t1) - Math.abs(a.t2 - a.t1));
  return index;
}

/**
 * Lays out the arcs worth drawing for the current viewport.
 *
 * `toPx` is supplied rather than a viewport, so the caller keeps ownership of
 * the scale — a log or density-equalised axis (§2.4) changes where an endpoint
 * lands and nothing here needs to know that.
 */
export function layoutArcs(
  index: readonly ArcSource[],
  toPx: (t: Days) => number,
  width: number,
  options: ArcOptions,
): ArcLayout[] {
  const { baselineY, maxApex } = options;
  const minApex = options.minApex ?? DEFAULT_MIN_APEX;
  const limit = options.limit ?? DEFAULT_ARC_LIMIT;

  const lo = -OFFSCREEN_CLAMP * width;
  const hi = (1 + OFFSCREEN_CLAMP) * width;
  const layouts: ArcLayout[] = [];

  for (const source of index) {
    const rawFrom = toPx(source.t1);
    const rawTo = toPx(source.t2);

    // The convex hull of a quadratic Bézier contains the curve, and every
    // control point of a same-side arc is off the same side, so this cull is
    // exact rather than conservative.
    if ((rawFrom < 0 && rawTo < 0) || (rawFrom > width && rawTo > width)) continue;

    const x1 = Math.min(hi, Math.max(lo, rawFrom));
    const x2 = Math.min(hi, Math.max(lo, rawTo));
    const apex = arcApex(Math.abs(rawFrom - rawTo), width, maxApex, minApex);

    layouts.push({
      connection: source.connection,
      x1,
      x2,
      cx: (x1 + x2) / 2,
      // A quadratic Bézier reaches halfway to its control point at t = 0.5, so
      // the control sits at twice the height the curve is meant to reach.
      cy: baselineY - 2 * apex,
      apex,
      colour: source.colour,
      whole: rawFrom >= 0 && rawFrom <= width && rawTo >= 0 && rawTo <= width,
    });

    if (layouts.length >= limit) break;
  }

  // Tallest first, so the long arcs that carry the structure are laid down
  // before the short ones and the short ones read as detail on top. Already in
  // this order for a linear scale, since apex is monotone in span; the sort is
  // here for the projections that are not.
  layouts.sort((a, b) => b.apex - a.apex);
  return layouts;
}

/** A point on the arc. `t` runs 0 → 1 from `x1` to `x2`. */
export function arcPointAt(arc: ArcLayout, t: number, baselineY: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * arc.x1 + 2 * u * t * arc.cx + t * t * arc.x2,
    y: u * u * baselineY + 2 * u * t * arc.cy + t * t * baselineY,
  };
}

/**
 * The arc nearest a point, within `tolerance` pixels.
 *
 * Sampled rather than solved. The exact distance from a point to a quadratic
 * Bézier is a cubic root-find, and this runs over a few hundred visible arcs on
 * pointer move — sampling at a fixed resolution is both faster and, at a
 * tolerance of several pixels, indistinguishable.
 *
 * Ties go to the shorter arc: a short arc is harder to hit and sits underneath,
 * so preferring it is what makes the arcs beneath a bundle reachable at all.
 */
export function hitTestArc(
  arcs: readonly ArcLayout[],
  x: number,
  y: number,
  baselineY: number,
  tolerance = 6,
  samples = 24,
): ArcLayout | null {
  let best: ArcLayout | null = null;
  let bestDistance = tolerance * tolerance;

  for (const arc of arcs) {
    // Cheap rejection: the curve never rises above its apex nor falls below the
    // baseline, and never leaves the x-range of its endpoints.
    if (y > baselineY + tolerance || y < baselineY - arc.apex - tolerance) continue;
    const left = Math.min(arc.x1, arc.x2) - tolerance;
    const right = Math.max(arc.x1, arc.x2) + tolerance;
    if (x < left || x > right) continue;

    for (let i = 0; i <= samples; i++) {
      const point = arcPointAt(arc, i / samples, baselineY);
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < bestDistance || (distance === bestDistance && best && arc.apex < best.apex)) {
        bestDistance = distance;
        best = arc;
      }
    }
  }

  return best;
}

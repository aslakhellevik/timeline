/**
 * Grouping events into map dots (docs/design.md §11).
 *
 * Necessary rather than decorative: most events are placed by their region tag,
 * so every event tagged *Europe* lands on **exactly** the same coordinate. Drawn
 * naively that is one dot with four hundred events hidden under it, and no way
 * to tell it apart from a dot with one.
 *
 * Clustering happens in **screen space**, on the same reasoning as the density's
 * screen-space bandwidth (§3.1): what matters is whether two dots would overlap
 * where they are drawn, which depends on the zoom and not on the kilometres
 * between them. Zooming in therefore separates a cluster into its parts, exactly
 * as zooming the timeline resolves mass into events.
 */

import type { TimelineEvent } from '../model/types';
import type { Point } from './projection';
import { locate } from './regions';

export interface Cluster {
  /** Mean position of the members, in degrees. */
  lon: number;
  lat: number;
  /** Where that lands on screen. */
  x: number;
  y: number;
  events: TimelineEvent[];
  /**
   * Vagueness of the *best-placed* member, in kilometres.
   *
   * The minimum rather than the maximum: a cluster holding one precisely located
   * event and fifty tagged only *Asia* is anchored by the precise one, and
   * drawing the whole group as continent-sized would throw that away.
   */
  precision: number;
}

/** Passes of agglomeration over the grid. Three is enough to reach a fixed point. */
const MERGE_PASSES = 3;

/**
 * Groups events into clusters no closer than `radius` pixels, and no closer than
 * the sum of the radii they will be *drawn* at.
 *
 * A grid, then a few agglomerative passes over it. The grid alone is one pass
 * and no distance matrix, and it was what this did — but a grid does not deliver
 * the guarantee in the first line of this comment, and the guarantee is the
 * whole point. Two events a fifth of a pixel apart on either side of a cell
 * boundary land in different buckets and are drawn as two dots on top of each
 * other; at world zoom the region anchors of a European corpus sit nine to
 * twenty-nine pixels apart with fifty-pixel discs, which is how the map came to
 * show a stack of five overlapping counts over France and nothing legible in it.
 *
 * So the grid is now the cheap first cut and the passes finish the job: any two
 * clusters whose drawn discs would overlap become one. A few hundred clusters
 * makes that trivial, and a sweep in `x` keeps it near-linear rather than
 * quadratic on a corpus large enough to fill the grid.
 *
 * `radiusOf` is the *renderer's* dot radius, passed in rather than assumed here:
 * whether two dots overlap depends on how they are drawn, and this module does
 * not draw them. Omitting it falls back to the stated `radius` alone.
 *
 * The result is stable. The buckets are deterministic for a given viewport, and
 * the sweep is ordered by position, so dots do not swap places between frames.
 */
export function clusterEvents(
  events: readonly TimelineEvent[],
  toScreen: (lon: number, lat: number) => Point,
  radius: number,
  radiusOf: (count: number) => number = () => 0,
): Cluster[] {
  const cell = Math.max(1, radius);
  const buckets = new Map<string, { members: TimelineEvent[]; lon: number; lat: number; precision: number }>();

  for (const event of events) {
    const placed = locate(event.place, event.tags);
    if (!placed) continue;

    const screen = toScreen(placed.lon, placed.lat);
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;

    const key = `${Math.round(screen.x / cell)}:${Math.round(screen.y / cell)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.members.push(event);
      // Running mean, so a cluster sits at the centre of what it holds rather
      // than on whichever member happened to arrive first.
      const n = bucket.members.length;
      bucket.lon += (placed.lon - bucket.lon) / n;
      bucket.lat += (placed.lat - bucket.lat) / n;
      bucket.precision = Math.min(bucket.precision, placed.precision);
    } else {
      buckets.set(key, {
        members: [event],
        lon: placed.lon,
        lat: placed.lat,
        precision: placed.precision,
      });
    }
  }

  let clusters: Cluster[] = [];
  for (const bucket of buckets.values()) {
    const screen = toScreen(bucket.lon, bucket.lat);
    clusters.push({
      lon: bucket.lon,
      lat: bucket.lat,
      x: screen.x,
      y: screen.y,
      events: bucket.members,
      precision: bucket.precision,
    });
  }

  // Repeated until nothing more merges: absorbing a neighbour grows a disc, and
  // a grown disc can reach one the smaller version did not.
  for (let pass = 0; pass < MERGE_PASSES; pass++) {
    const next = mergePass(clusters, toScreen, radius, radiusOf);
    if (next.length === clusters.length) break;
    clusters = next;
  }

  // Largest first, so the small dots are drawn on top and stay clickable.
  clusters.sort((a, b) => b.events.length - a.events.length);
  return clusters;
}

/**
 * One agglomerative pass: a sweep in `x`, absorbing every cluster whose drawn
 * disc would overlap the one being built.
 *
 * Greedy and order-dependent, which is the price of not building a distance
 * matrix — and the order is a deterministic function of position, so the same
 * frame always produces the same grouping.
 */
function mergePass(
  clusters: readonly Cluster[],
  toScreen: (lon: number, lat: number) => Point,
  radius: number,
  radiusOf: (count: number) => number,
): Cluster[] {
  if (clusters.length < 2) return [...clusters];

  const order = [...clusters].sort(
    (a, b) => a.x - b.x || a.y - b.y || a.lon - b.lon || a.lat - b.lat,
  );
  const taken = new Uint8Array(order.length);

  // The widest any merge can reach: two of the largest discs there could be, or
  // the stated radius if that is more. Beyond it the sweep can stop looking.
  let widest = 0;
  for (const cluster of order) widest = Math.max(widest, radiusOf(cluster.events.length));
  const reach = Math.max(radius, widest * 2);

  const merged: Cluster[] = [];
  for (let i = 0; i < order.length; i++) {
    if (taken[i]) continue;
    const base = order[i] as Cluster;
    let { lon, lat, x, y, precision } = base;
    let members: TimelineEvent[] | null = null;
    let count = base.events.length;

    for (let j = i + 1; j < order.length; j++) {
      const other = order[j] as Cluster;
      // `order[j].x` only increases, so once it is out of reach of the cluster
      // being built, nothing after it can be in reach either.
      if (other.x - x > reach) break;
      if (taken[j]) continue;

      const overlap = Math.max(radius, radiusOf(count) + radiusOf(other.events.length));
      if (Math.hypot(other.x - x, other.y - y) >= overlap) continue;

      taken[j] = 1;
      if (!members) members = [...base.events];
      for (const event of other.events) members.push(event);

      // Weighted by count, so the merged dot sits at the centre of what it holds
      // rather than being dragged to whichever member was swept first.
      const total = count + other.events.length;
      lon += ((other.lon - lon) * other.events.length) / total;
      lat += ((other.lat - lat) * other.events.length) / total;
      precision = Math.min(precision, other.precision);
      count = total;

      const screen = toScreen(lon, lat);
      if (Number.isFinite(screen.x) && Number.isFinite(screen.y)) {
        x = screen.x;
        y = screen.y;
      }
    }

    merged.push(members ? { lon, lat, x, y, events: members, precision } : base);
  }

  return merged;
}

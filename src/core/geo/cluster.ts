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

import type { Id, TimelineEvent } from '../model/types';
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

/**
 * Buckets events into clusters no closer than `radius` pixels.
 *
 * A grid rather than a proper hierarchical clustering: one pass, no distance
 * matrix, and the result is stable — the same events always land in the same
 * bucket for a given viewport, so dots do not swap places between frames.
 */
export function clusterEvents(
  events: readonly TimelineEvent[],
  toScreen: (lon: number, lat: number) => Point,
  radius: number,
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

  const clusters: Cluster[] = [];
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

  // Largest first, so the small dots are drawn on top and stay clickable.
  clusters.sort((a, b) => b.events.length - a.events.length);
  return clusters;
}

/** Which placeable region tags a set of events actually uses, for the legend. */
export function usedRegions(events: readonly TimelineEvent[]): Set<Id> {
  const used = new Set<Id>();
  for (const event of events) {
    const placed = locate(event.place, event.tags);
    if (!placed) continue;
    for (const tag of event.tags) used.add(tag);
  }
  return used;
}

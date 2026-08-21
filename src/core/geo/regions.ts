/**
 * Where the built-in regions are (docs/design.md §11).
 *
 * The map's problem is that almost no event has coordinates. Asking users to
 * geocode everything they read about would make capture slow, and capture
 * friction is the project's stated top product risk — so the map falls back to
 * the geographic tag, which the README always intended: "driven by the
 * geographic tag or an explicit location".
 *
 * These are **representative points with a radius, not centroids**, and the
 * distinction is the honest part. "Europe" is not at 50°N 15°E; it is a region
 * about two thousand kilometres across, and the map draws it as such. An event
 * tagged only *Asia* should look vague, because it is.
 *
 * The values are eyeballed from the coastline data rather than computed: a
 * centroid of Europe's landmass sits in Belarus, which is a worse answer than a
 * point chosen to look right on the map.
 */

import type { Id } from '../model/types';
import {
  R_AFRICA,
  R_AMERICAS,
  R_ASIA,
  R_BRITAIN,
  R_CHINA,
  R_EUROPE,
  R_FRANCE,
  R_GERMANY,
  R_IBERIA,
  R_INDIA,
  R_ITALY,
  R_JAPAN,
  R_MEDITERRANEAN,
  R_NEAR_EAST,
  R_NORDICS,
  R_NORTH_AMERICA,
  R_NORWAY,
  R_OCEANIA,
  R_RUSSIA,
  R_SOUTH_AMERICA,
} from '../model/builtin-tags';

export interface RegionPlace {
  lon: number;
  lat: number;
  /** Rough radius in kilometres — how vague this location actually is. */
  precision: number;
}

export const REGION_PLACES: Readonly<Record<Id, RegionPlace>> = {
  [R_EUROPE]: { lon: 12, lat: 49, precision: 1600 },
  [R_BRITAIN]: { lon: -3.5, lat: 54, precision: 450 },
  [R_FRANCE]: { lon: 2.5, lat: 46.5, precision: 400 },
  [R_GERMANY]: { lon: 10.5, lat: 51, precision: 400 },
  [R_ITALY]: { lon: 12.5, lat: 42.5, precision: 400 },
  [R_IBERIA]: { lon: -4, lat: 40, precision: 400 },
  [R_NORDICS]: { lon: 16, lat: 62, precision: 700 },
  [R_NORWAY]: { lon: 9, lat: 61, precision: 500 },
  [R_RUSSIA]: { lon: 55, lat: 58, precision: 2200 },
  [R_MEDITERRANEAN]: { lon: 17, lat: 36, precision: 1400 },
  [R_NEAR_EAST]: { lon: 40, lat: 33, precision: 900 },
  [R_ASIA]: { lon: 95, lat: 38, precision: 2600 },
  [R_CHINA]: { lon: 105, lat: 35, precision: 1300 },
  [R_INDIA]: { lon: 79, lat: 22, precision: 1000 },
  [R_JAPAN]: { lon: 138, lat: 36, precision: 500 },
  [R_AFRICA]: { lon: 19, lat: 2, precision: 2600 },
  [R_AMERICAS]: { lon: -80, lat: 8, precision: 3000 },
  [R_NORTH_AMERICA]: { lon: -100, lat: 42, precision: 1800 },
  [R_SOUTH_AMERICA]: { lon: -58, lat: -14, precision: 1700 },
  [R_OCEANIA]: { lon: 140, lat: -25, precision: 1800 },
};

/**
 * Where an event is, and how confidently.
 *
 * An explicit `place` always wins — someone who typed coordinates meant them.
 * Failing that, the **most specific** region tag the event carries: an event
 * tagged both *Europe* and *Norway* belongs in Norway, and specificity is read
 * straight off the radius, so adding a region needs no ordering table.
 */
export function locate(
  place: { name?: string; lat?: number; lon?: number; precision?: number } | undefined,
  tags: readonly Id[],
): RegionPlace | null {
  if (place?.lat !== undefined && place?.lon !== undefined) {
    return { lon: place.lon, lat: place.lat, precision: place.precision ?? 25 };
  }

  let best: RegionPlace | null = null;
  for (const tag of tags) {
    const candidate = REGION_PLACES[tag];
    if (candidate && (best === null || candidate.precision < best.precision)) best = candidate;
  }
  return best;
}

/** Whether a tag is one the map knows how to place. */
export function isPlaceableTag(tag: Id): boolean {
  return tag in REGION_PLACES;
}

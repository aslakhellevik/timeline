import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '../model/types';
import { R_ASIA, R_EUROPE, R_JAPAN, R_NORWAY, T_WAR } from '../model/builtin-tags';
import { instant } from '../time';
import { clusterEvents } from './cluster';
import { landRings } from './land';
import {
  PROJECTED_HALF_HEIGHT,
  PROJECTED_HALF_WIDTH,
  distanceKm,
  lonDelta,
  project,
  unproject,
} from './projection';
import { locate } from './regions';

describe('Equal Earth projection', () => {
  it('puts the origin at the origin', () => {
    expect(project(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('is symmetric about both axes', () => {
    const ne = project(40, 30);
    expect(project(-40, 30).x).toBeCloseTo(-ne.x, 12);
    expect(project(40, -30).y).toBeCloseTo(-ne.y, 12);
  });

  it('round-trips to within a millimetre of a degree', () => {
    for (const lat of [-85, -60, -23.5, 0, 23.5, 45, 60, 83]) {
      for (const lon of [-180, -120, -45, 0, 12, 90, 179]) {
        const { x, y } = project(lon, lat);
        const back = unproject(x, y);
        expect(back.lon).toBeCloseTo(lon, 9);
        expect(back.lat).toBeCloseTo(lat, 9);
      }
    }
  });

  it('is monotone in both coordinates', () => {
    let previousX = -Infinity;
    for (let lon = -180; lon <= 180; lon += 10) {
      const { x } = project(lon, 0);
      expect(x).toBeGreaterThan(previousX);
      previousX = x;
    }
    let previousY = -Infinity;
    for (let lat = -89; lat <= 89; lat += 5) {
      const { y } = project(0, lat);
      expect(y).toBeGreaterThan(previousY);
      previousY = y;
    }
  });

  /**
   * The property the projection was chosen for. Two patches of equal area on the
   * globe must project to equal area on the map, or the view lies about
   * quantity — which is the only thing it is for.
   */
  it('preserves relative area between the tropics and high latitudes', () => {
    const patch = (lat: number) => {
      const d = 0.5;
      const a = project(0, lat);
      const b = project(d, lat);
      const c = project(0, lat + d);
      // Area of the projected cell, against the true area of the graticule cell,
      // which shrinks with the cosine of latitude.
      const projected = Math.abs((b.x - a.x) * (c.y - a.y));
      const actual = Math.cos(((lat + d / 2) * Math.PI) / 180) * d * d;
      return projected / actual;
    };

    const equator = patch(0);
    for (const lat of [20, 40, 55, 70]) {
      expect(patch(lat) / equator).toBeCloseTo(1, 2);
    }
  });

  it('reports the extent the renderer scales into pixels', () => {
    expect(PROJECTED_HALF_WIDTH).toBeGreaterThan(2);
    expect(PROJECTED_HALF_HEIGHT).toBeGreaterThan(1);
    expect(PROJECTED_HALF_WIDTH / PROJECTED_HALF_HEIGHT).toBeCloseTo(2.05, 1);
  });

  it('survives the poles rather than dividing by zero', () => {
    for (const lat of [90, -90]) {
      const { x, y } = project(30, lat);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

describe('lonDelta', () => {
  it('takes the short way round the date line', () => {
    expect(lonDelta(170, -170)).toBe(20);
    expect(lonDelta(-170, 170)).toBe(-20);
    expect(lonDelta(10, 20)).toBe(10);
  });
});

describe('distanceKm', () => {
  it('matches known distances to within a percent', () => {
    // Oslo to Paris, about 1340 km.
    const oslo = { lon: 10.75, lat: 59.91 };
    const paris = { lon: 2.35, lat: 48.86 };
    expect(distanceKm(oslo, paris)).toBeGreaterThan(1300);
    expect(distanceKm(oslo, paris)).toBeLessThan(1380);
  });

  it('is zero for a point against itself', () => {
    expect(distanceKm({ lon: 5, lat: 5 }, { lon: 5, lat: 5 })).toBeCloseTo(0);
  });
});

describe('coastlines', () => {
  const rings = landRings();

  it('decodes into a plausible number of closed rings', () => {
    expect(rings.length).toBeGreaterThan(50);
    expect(rings.length).toBeLessThan(500);
  });

  it('stays inside real longitude and latitude bounds', () => {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThanOrEqual(-180.001);
        expect(lon).toBeLessThanOrEqual(180.001);
        expect(lat).toBeGreaterThanOrEqual(-90.001);
        expect(lat).toBeLessThanOrEqual(90.001);
      }
    }
  });

  it('has land where land is and none where it is not', () => {
    // A crude but genuine check that the decode is not scrambled: the biggest
    // ring should be Eurasia-Africa, spanning most of the eastern hemisphere.
    const biggest = rings.reduce((a, b) => (a.length >= b.length ? a : b));
    const lons = biggest.map(([lon]) => lon);
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(180);
    expect(biggest.length).toBeGreaterThan(200);
  });

  it('caches, so opening the map twice decodes once', () => {
    expect(landRings()).toBe(rings);
  });
});

const STAMP = '2026-01-01T00:00:00+01:00';

function event(id: string, tags: string[], place?: TimelineEvent['place']): TimelineEvent {
  return {
    id,
    created_at: STAMP,
    updated_at: STAMP,
    title: id,
    when: instant(1900),
    tags,
    provenance: { kind: 'manual' },
    ...(place ? { place } : {}),
  };
}

describe('locate', () => {
  it('prefers an explicit place over any tag', () => {
    const placed = locate({ name: 'Oslo', lat: 59.91, lon: 10.75 }, [R_ASIA]);
    expect(placed?.lat).toBeCloseTo(59.91);
    expect(placed?.precision).toBe(25);
  });

  it('falls back to the most specific region tag', () => {
    // Tagged both Europe and Norway: Norway is the answer, read off the radius
    // rather than an ordering table.
    const placed = locate(undefined, [R_EUROPE, R_NORWAY]);
    expect(placed?.lat).toBeCloseTo(61);
  });

  it('returns null for an event with nothing to go on', () => {
    expect(locate(undefined, [T_WAR])).toBeNull();
    expect(locate(undefined, [])).toBeNull();
  });

  it('keeps a vague region vague', () => {
    const asia = locate(undefined, [R_ASIA]);
    const japan = locate(undefined, [R_JAPAN]);
    expect(asia?.precision).toBeGreaterThan(japan?.precision as number);
  });
});

describe('clusterEvents', () => {
  /** Degrees straight to pixels, so the tests talk in something legible. */
  const toScreen = (lon: number, lat: number) => ({ x: lon * 10, y: -lat * 10 });

  it('merges events that would overlap on screen', () => {
    const events = [event('a', [R_EUROPE]), event('b', [R_EUROPE]), event('c', [R_EUROPE])];
    const clusters = clusterEvents(events, toScreen, 20);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.events).toHaveLength(3);
  });

  it('keeps distant events apart', () => {
    const clusters = clusterEvents([event('a', [R_EUROPE]), event('b', [R_JAPAN])], toScreen, 20);
    expect(clusters).toHaveLength(2);
  });

  it('separates a cluster as the zoom grows', () => {
    const events = [
      event('a', [], { name: 'a', lat: 50, lon: 10 }),
      event('b', [], { name: 'b', lat: 50, lon: 12 }),
    ];
    expect(clusterEvents(events, toScreen, 100)).toHaveLength(1);
    expect(clusterEvents(events, (lon, lat) => ({ x: lon * 200, y: -lat * 200 }), 100)).toHaveLength(2);
  });

  it('drops events with no location at all', () => {
    const clusters = clusterEvents([event('a', [T_WAR]), event('b', [R_EUROPE])], toScreen, 20);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.events[0]?.id).toBe('b');
  });

  it('is anchored by its best-placed member', () => {
    // One precise event among many vague ones: the cluster is not continent-sized.
    const events = [
      event('precise', [R_ASIA], { name: 'Kyoto', lat: 35, lon: 135.7, precision: 10 }),
      event('vague', [R_ASIA]),
    ];
    const [cluster] = clusterEvents(events, toScreen, 10_000);
    expect(cluster?.precision).toBe(10);
  });

  it('orders largest first, so small dots stay on top and clickable', () => {
    const events = [
      event('a', [R_EUROPE]),
      event('b', [R_EUROPE]),
      event('c', [R_JAPAN]),
    ];
    const clusters = clusterEvents(events, toScreen, 20);
    expect(clusters[0]?.events).toHaveLength(2);
  });

  it('is stable — the same input gives the same buckets', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      event(`e${i}`, i % 2 === 0 ? [R_EUROPE] : [R_JAPAN]),
    );
    const first = clusterEvents(events, toScreen, 20).map((c) => c.events.length);
    const second = clusterEvents(events, toScreen, 20).map((c) => c.events.length);
    expect(second).toEqual(first);
  });
});

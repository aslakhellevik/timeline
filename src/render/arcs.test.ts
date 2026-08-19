import { describe, expect, it } from 'vitest';
import type { Connection, Id, TimelineEvent } from '../core/model/types';
import { interval } from '../core/time';
import { arcApex, arcPointAt, buildArcIndex, connectionColour, hitTestArc, layoutArcs } from './arcs';
import type { ArcOptions } from './arcs';

const BASELINE = 400;

/**
 * `day` is read straight back out as the pixel position by the `xOf` below, so
 * these tests talk in pixels and never involve the calendar.
 */
function event(id: string, day: number, tags: Id[] = []): TimelineEvent {
  return {
    id,
    created_at: '2026-01-01T00:00:00+01:00',
    updated_at: '2026-01-01T00:00:00+01:00',
    title: id,
    when: interval(day, day),
    tags,
    provenance: { kind: 'manual' },
  };
}

function connection(from: string, to: string, tags: Id[] = []): Connection {
  return {
    id: `${from}-${to}`,
    created_at: '2026-01-01T00:00:00+01:00',
    updated_at: '2026-01-01T00:00:00+01:00',
    from,
    to,
    note: '',
    tags,
    provenance: { kind: 'manual' },
  };
}

const OPTIONS: ArcOptions = { baselineY: BASELINE, maxApex: 200, minApex: 10 };

/**
 * Builds the index and lays it out in one step.
 *
 * `when.b` is used as both the time and the pixel position, so these tests talk
 * in pixels throughout and never involve the calendar or a scale.
 */
function layout(
  connections: readonly Connection[],
  events: readonly TimelineEvent[],
  width = 1000,
  options: Partial<ArcOptions> = {},
  tagColours: ReadonlyMap<Id, string> = new Map(),
) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const index = buildArcIndex(connections, byId, (e) => e.when.b, tagColours, '#888888');
  return layoutArcs(index, (t) => t, width, { ...OPTIONS, ...options });
}

describe('arcApex', () => {
  it('grows with distance and saturates at one viewport width', () => {
    expect(arcApex(0, 1000, 200, 10)).toBeCloseTo(10);
    expect(arcApex(1000, 1000, 200, 10)).toBeCloseTo(200);
    expect(arcApex(50_000, 1000, 200, 10)).toBeCloseTo(200);
  });

  it('grows as the square root, not linearly', () => {
    // Quadrupling the distance doubles the height above the floor.
    const short = arcApex(100, 1000, 210, 10) - 10;
    const long = arcApex(400, 1000, 210, 10) - 10;
    expect(long / short).toBeCloseTo(2, 6);
  });

  it('is monotone', () => {
    let previous = -Infinity;
    for (let d = 0; d <= 2000; d += 37) {
      const apex = arcApex(d, 1000, 200, 10);
      expect(apex).toBeGreaterThanOrEqual(previous);
      previous = apex;
    }
  });

  it('never returns less than the floor, whatever the caps say', () => {
    expect(arcApex(500, 1000, 4, 10)).toBeGreaterThanOrEqual(10);
    expect(arcApex(500, 0, 200, 10)).toBe(10);
  });
});

describe('layoutArcs', () => {
  it('places the control point at twice the apex, so the curve reaches the apex', () => {
    const [arc] = layout([connection('a', 'b')], [event('a', 100), event('b', 900)]);
    expect(arc).toBeDefined();
    const top = arcPointAt(arc as never, 0.5, BASELINE);
    expect(BASELINE - top.y).toBeCloseTo((arc as never as { apex: number }).apex, 6);
  });

  it('starts and ends on the baseline', () => {
    const [arc] = layout([connection('a', 'b')], [event('a', 100), event('b', 900)]);
    expect(arcPointAt(arc as never, 0, BASELINE)).toEqual({ x: 100, y: BASELINE });
    expect(arcPointAt(arc as never, 1, BASELINE)).toEqual({ x: 900, y: BASELINE });
  });

  it('culls arcs with both endpoints off the same side', () => {
    const events = [event('a', -500), event('b', -200), event('c', 1500), event('d', 1800)];
    expect(layout([connection('a', 'b')], events)).toHaveLength(0);
    expect(layout([connection('c', 'd')], events)).toHaveLength(0);
  });

  it('keeps an arc that spans the viewport with both endpoints outside it', () => {
    // The interesting case: nothing visible at either end, but the curve crosses
    // the whole screen. Culling on endpoint visibility alone would lose it.
    const arcs = layout([connection('a', 'b')], [event('a', -500), event('b', 1500)]);
    expect(arcs).toHaveLength(1);
    expect((arcs[0] as { whole: boolean }).whole).toBe(false);
  });

  it('clamps absurd coordinates while keeping the apex at its cap', () => {
    const arcs = layout([connection('a', 'b')], [event('a', -2e9), event('b', 500)]);
    expect(arcs).toHaveLength(1);
    const arc = arcs[0] as { x1: number; apex: number };
    expect(Number.isFinite(arc.x1)).toBe(true);
    expect(arc.x1).toBeGreaterThan(-1e5);
    expect(arc.apex).toBeCloseTo(200);
  });

  it('drops a connection whose endpoint the filter has hidden', () => {
    expect(layout([connection('a', 'gone')], [event('a', 100)])).toHaveLength(0);
  });

  it('drops tombstoned connections', () => {
    const dead = { ...connection('a', 'b'), deleted_at: '2026-02-01T00:00:00+01:00' };
    expect(layout([dead], [event('a', 100), event('b', 900)])).toHaveLength(0);
  });

  it('honours the per-frame limit', () => {
    const events = Array.from({ length: 200 }, (_, i) => event(`e${i}`, i * 5));
    const connections = Array.from({ length: 199 }, (_, i) => connection(`e${i}`, `e${i + 1}`));
    expect(layout(connections, events, 1000, { limit: 50 })).toHaveLength(50);
  });

  it('keeps the longest arcs when the limit bites', () => {
    // The limit has to drop something; dropping the short links rather than an
    // arbitrary slice is what keeps the large-scale structure legible.
    const events = [event('a', 0), event('b', 5), event('c', 500), event('d', 990)];
    const arcs = layout(
      [connection('a', 'b'), connection('a', 'd'), connection('a', 'c')],
      events,
      1000,
      { limit: 2 },
    );
    expect(arcs.map((arc) => arc.connection.id)).toEqual(['a-d', 'a-c']);
  });

  it('orders tallest first, so long arcs sit under the short ones', () => {
    const events = [event('a', 10), event('b', 60), event('c', 990)];
    const arcs = layout([connection('a', 'b'), connection('a', 'c')], events);
    const apexes = arcs.map((arc) => arc.apex);
    expect(apexes[0]).toBeGreaterThan(apexes[1] as number);
  });
});

describe('connectionColour', () => {
  const colours = new Map([
    ['war', '#e03131'],
    ['philosophy', '#7048e8'],
    ['europe', '#4c6ef5'],
  ]);

  it("prefers the connection's own tag", () => {
    const colour = connectionColour(
      connection('a', 'b', ['war']),
      event('a', 0, ['philosophy']),
      event('b', 0, ['philosophy']),
      colours,
      '#888888',
    );
    expect(colour).toBe('#e03131');
  });

  it('falls back to a tag both endpoints share', () => {
    const colour = connectionColour(
      connection('a', 'b'),
      event('a', 0, ['europe', 'philosophy']),
      event('b', 0, ['war', 'philosophy']),
      colours,
      '#888888',
    );
    expect(colour).toBe('#7048e8');
  });

  it('falls back to either endpoint, then to the default', () => {
    expect(
      connectionColour(connection('a', 'b'), event('a', 0), event('b', 0, ['war']), colours, '#888'),
    ).toBe('#e03131');
    expect(
      connectionColour(connection('a', 'b'), event('a', 0), event('b', 0), colours, '#888'),
    ).toBe('#888');
  });

  it('ignores a tag with no colour rather than returning undefined', () => {
    expect(
      connectionColour(connection('a', 'b', ['untagged']), undefined, undefined, colours, '#888'),
    ).toBe('#888');
  });
});

describe('hitTestArc', () => {
  const arcs = layout([connection('a', 'b')], [event('a', 100), event('b', 900)]);
  const arc = arcs[0] as NonNullable<(typeof arcs)[0]>;

  it('hits a point on the curve', () => {
    const top = arcPointAt(arc, 0.5, BASELINE);
    expect(hitTestArc(arcs, top.x, top.y, BASELINE)).toBe(arc);
  });

  it('misses a point well away from it', () => {
    expect(hitTestArc(arcs, 500, BASELINE - 5, BASELINE)).toBeNull();
    expect(hitTestArc(arcs, 20, BASELINE, BASELINE)).toBeNull();
  });

  it('respects the tolerance', () => {
    const top = arcPointAt(arc, 0.5, BASELINE);
    expect(hitTestArc(arcs, top.x, top.y - 4, BASELINE, 6)).toBe(arc);
    expect(hitTestArc(arcs, top.x, top.y - 20, BASELINE, 6)).toBeNull();
  });

  it('returns the nearest of several overlapping arcs', () => {
    const events = [event('a', 100), event('b', 900), event('c', 500)];
    const both = layout([connection('a', 'b'), connection('a', 'c')], events);
    const shorter = both.find((candidate) => candidate.connection.id === 'a-c');
    expect(shorter).toBeDefined();
    const point = arcPointAt(shorter as never, 0.5, BASELINE);
    expect(hitTestArc(both, point.x, point.y, BASELINE)).toBe(shorter);
  });

  it('rejects everything cheaply when the cursor is below the baseline', () => {
    expect(hitTestArc(arcs, 500, BASELINE + 50, BASELINE)).toBeNull();
  });
});

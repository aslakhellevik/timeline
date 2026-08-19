/**
 * Fixtures for the store tests. Test-only: nothing in `index.ts` re-exports it.
 *
 * Timestamps deliberately carry different offsets — `updated_at` is an ISO
 * instant *with* an offset, and the merge rule has to compare instants rather
 * than strings.
 */

import type { Connection, Era, Tag, Timeline, TimelineEvent, TimeSpec } from '../core/model/types';

/** Oldest to newest, as instants. */
export const T1 = '2026-01-01T10:00:00.000+01:00';
export const T2 = '2026-06-01T10:00:00.000+02:00';
export const T3 = '2026-08-15T10:00:00.000+02:00';

export function spec(year = 1571): TimeSpec {
  const day = (year - 1970) * 365.2425;
  return {
    mode: 'instant',
    calendar: 'gregorian',
    granularity: 'year',
    a: day,
    b: day,
    c: day,
    d: day,
    sigma: 182,
  };
}

export function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id,
    created_at: T1,
    updated_at: T1,
    title: `Event ${id}`,
    when: spec(),
    tags: [],
    provenance: { kind: 'manual' },
    ...overrides,
  };
}

export function connection(id: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    created_at: T1,
    updated_at: T1,
    from: 'a',
    to: 'b',
    note: `Because of ${id}`,
    tags: [],
    provenance: { kind: 'manual' },
    ...overrides,
  };
}

export function tag(id: string, overrides: Partial<Tag> = {}): Tag {
  return {
    id,
    created_at: T1,
    updated_at: T1,
    name: `Tag ${id}`,
    kind: 'user',
    ...overrides,
  };
}

export function era(id: string, overrides: Partial<Era> = {}): Era {
  return {
    id,
    created_at: T1,
    updated_at: T1,
    name: `Era ${id}`,
    when: spec(1900),
    kind: 'personal',
    tags: [],
    ...overrides,
  };
}

export function timeline(partial: Partial<Timeline> = {}): Timeline {
  return {
    events: partial.events ?? [],
    connections: partial.connections ?? [],
    tags: partial.tags ?? [],
    eras: partial.eras ?? [],
    packs: partial.packs ?? [],
  };
}

/** A small but complete timeline, one record of every kind. */
export function sampleTimeline(): Timeline {
  return timeline({
    events: [event('e1'), event('e2', { title: 'Lepanto', notes: 'Naval' })],
    connections: [connection('c1', { from: 'e1', to: 'e2' })],
    tags: [tag('tag.region.europe', { name: 'Europe', kind: 'region' })],
    eras: [era('r1', { name: 'My life' })],
  });
}

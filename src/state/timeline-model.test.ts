import { describe, expect, it } from 'vitest';
import { fromGregorian, instant, interval } from '../core/time';
import { NO_FILTER, applyFilter, buildAncestry, makePredicates } from '../core/filter';
import type { Connection, Era, Tag, Timeline, TimelineEvent } from '../core/model/types';
import {
  EMPTY_TIMELINE,
  applyUndo,
  compareEvents,
  createEra,
  createEvent,
  editEvent,
  ensureTags,
  removeEvent,
  sortEvents,
} from './timeline-model';
import type { Mutation } from './timeline-model';

const at = (year: number) => instant(year);

function withEvents(count: number): Timeline {
  let timeline = EMPTY_TIMELINE;
  for (let i = 0; i < count; i++) {
    timeline = createEvent(timeline, { title: `event ${i}`, when: at(1900 + i) }).timeline;
  }
  return timeline;
}

describe('createEvent', () => {
  it('records when you learned it, defaulting to now', () => {
    const { timeline } = createEvent(EMPTY_TIMELINE, { title: 'the fall', when: at(1453) });
    const event = timeline.events[0];
    expect(event?.learned_at).toBeTruthy();
    expect(event?.provenance.kind).toBe('manual');
  });

  it('keeps events sorted by the documented key', () => {
    let timeline = EMPTY_TIMELINE;
    for (const year of [1900, 1500, 1800, 1600]) {
      timeline = createEvent(timeline, { title: `e${year}`, when: at(year) }).timeline;
    }
    const years = timeline.events.map((e) => e.when.b);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it('reports the record to persist and an undo step', () => {
    const mutation = createEvent(EMPTY_TIMELINE, { title: 'x', when: at(1900) });
    expect(mutation.touched).toHaveLength(1);
    expect(mutation.touched[0]?.kind).toBe('events');
    expect(mutation.undo[0]?.record).toBeNull();
  });
});

describe('compareEvents', () => {
  it('breaks ties by title using code units, not locale collation', () => {
    const base = createEvent(EMPTY_TIMELINE, { title: 'a', when: at(1900) }).timeline
      .events[0] as NonNullable<Timeline['events'][number]>;
    const zebra = { ...base, id: 'zzz', title: 'Zebra' };
    const apple = { ...base, id: 'aaa', title: 'apple' };
    // Code-unit order puts uppercase first; a locale-aware sort would not.
    expect(compareEvents(zebra, apple)).toBeLessThan(0);
  });

  it('is a total order — sorting is stable and deterministic', () => {
    const timeline = withEvents(20);
    const once = sortEvents(timeline.events).map((e) => e.id);
    const twice = sortEvents([...timeline.events].reverse()).map((e) => e.id);
    expect(once).toEqual(twice);
  });
});

describe('editEvent', () => {
  it('bumps updated_at and returns the previous record for undo', () => {
    const timeline = withEvents(1);
    const id = timeline.events[0]?.id as string;
    const mutation = editEvent(timeline, id, { title: 'renamed' }, '2026-01-01T00:00:00.000+01:00');

    expect(mutation?.timeline.events[0]?.title).toBe('renamed');
    expect(mutation?.timeline.events[0]?.updated_at).toBe('2026-01-01T00:00:00.000+01:00');
    expect((mutation?.undo[0]?.record as TimelineEvent | null)?.title).toBe('event 0');
  });

  it('re-sorts when the date changes', () => {
    let timeline = withEvents(3);
    const last = timeline.events[2]?.id as string;
    timeline = (editEvent(timeline, last, { when: at(1000) }) as { timeline: Timeline }).timeline;
    expect(timeline.events[0]?.when.b).toBe(at(1000).b);
  });

  it('returns null for an unknown id', () => {
    expect(editEvent(EMPTY_TIMELINE, 'nope', { title: 'x' })).toBeNull();
  });
});

describe('removeEvent — the cascade (D21)', () => {
  function withConnection(): { timeline: Timeline; eventId: string; connectionId: string } {
    let timeline = withEvents(2);
    const [a, b] = timeline.events;
    const connection: Connection = {
      id: 'cx-1',
      created_at: '2026-01-01T00:00:00.000+01:00',
      updated_at: '2026-01-01T00:00:00.000+01:00',
      from: a?.id as string,
      to: b?.id as string,
      note: 'because',
      tags: [],
      provenance: { kind: 'manual' },
    };
    timeline = { ...timeline, connections: [connection] };
    return { timeline, eventId: a?.id as string, connectionId: connection.id };
  }

  it('soft-deletes the event and its connections as one undo entry', () => {
    const { timeline, eventId, connectionId } = withConnection();
    const mutation = removeEvent(timeline, eventId) as { timeline: Timeline; undo: unknown[] };

    expect(mutation.timeline.events.find((e) => e.id === eventId)?.deleted_at).toBeTruthy();
    expect(mutation.timeline.connections.find((c) => c.id === connectionId)?.deleted_at)
      .toBeTruthy();
    // One entry covering both, so a single undo restores the pair.
    expect(mutation.undo).toHaveLength(2);
  });

  it('restores both on undo', () => {
    const { timeline, eventId, connectionId } = withConnection();
    const deleted = removeEvent(timeline, eventId) as Mutation;
    const restored = applyUndo(deleted.timeline, deleted.undo);

    expect(restored.timeline.events.find((e) => e.id === eventId)?.deleted_at).toBeUndefined();
    expect(restored.timeline.connections.find((c) => c.id === connectionId)?.deleted_at)
      .toBeUndefined();
  });

  it('leaves unrelated connections alone', () => {
    let timeline = withEvents(4);
    const ids = timeline.events.map((e) => e.id);
    const make = (from: string, to: string, id: string): Connection => ({
      id,
      created_at: 'x',
      updated_at: 'x',
      from,
      to,
      note: '',
      tags: [],
      provenance: { kind: 'manual' },
    });
    timeline = {
      ...timeline,
      connections: [
        make(ids[0] as string, ids[1] as string, 'a'),
        make(ids[2] as string, ids[3] as string, 'b'),
      ],
    };

    const mutation = removeEvent(timeline, ids[0] as string) as { timeline: Timeline };
    expect(mutation.timeline.connections.find((c) => c.id === 'a')?.deleted_at).toBeTruthy();
    expect(mutation.timeline.connections.find((c) => c.id === 'b')?.deleted_at).toBeUndefined();
  });

  it('refuses to delete twice', () => {
    const timeline = withEvents(1);
    const id = timeline.events[0]?.id as string;
    const once = removeEvent(timeline, id) as { timeline: Timeline };
    expect(removeEvent(once.timeline, id)).toBeNull();
  });
});

describe('undoing a creation', () => {
  it('tombstones rather than dropping, so it cannot come back on reload', () => {
    const mutation = createEvent(EMPTY_TIMELINE, { title: 'oops', when: at(1900) });
    const undone = applyUndo(mutation.timeline, mutation.undo);

    // Still present as a record...
    expect(undone.timeline.events).toHaveLength(1);
    // ...but deleted, and reported for persistence so the store agrees.
    expect(undone.timeline.events[0]?.deleted_at).toBeTruthy();
    expect(undone.touched).toHaveLength(1);
    // And invisible to every view.
    expect(applyFilter(undone.timeline, NO_FILTER).events).toHaveLength(0);
  });
});

describe('ensureTags', () => {
  it('creates tags that do not exist and reuses those that do', () => {
    const first = ensureTags(EMPTY_TIMELINE, ['war', 'europe']);
    expect(first.ids).toHaveLength(2);
    expect(first.timeline.tags).toHaveLength(2);

    const second = ensureTags(first.timeline, ['war']);
    expect(second.ids).toEqual([first.ids[0]]);
    expect(second.timeline.tags).toHaveLength(2);
  });

  it('matches case-insensitively, so #War and #war are one tag', () => {
    const first = ensureTags(EMPTY_TIMELINE, ['War']);
    const second = ensureTags(first.timeline, ['war']);
    expect(second.timeline.tags).toHaveLength(1);
    expect(second.ids).toEqual(first.ids);
  });

  it('ignores blanks and de-duplicates within one call', () => {
    const result = ensureTags(EMPTY_TIMELINE, ['war', '  ', 'war', '']);
    expect(result.ids).toHaveLength(1);
    expect(result.timeline.tags).toHaveLength(1);
  });
});

describe('filter predicates (§3.5, D22)', () => {
  const tag = (id: string, name: string, parent?: string): Tag => ({
    id,
    created_at: 'x',
    updated_at: 'x',
    name,
    kind: 'region',
    ...(parent !== undefined ? { parent } : {}),
  });

  function fixture(): Timeline {
    let timeline: Timeline = {
      ...withEvents(3),
      tags: [tag('europe', 'Europe'), tag('norway', 'Norway', 'europe'), tag('asia', 'Asia')],
    };
    const ids = timeline.events.map((e) => e.id);
    timeline = {
      ...timeline,
      events: timeline.events.map((event, i) => ({
        ...event,
        tags: i === 0 ? ['norway'] : i === 1 ? ['asia'] : [],
      })),
      connections: [
        {
          id: 'c1',
          created_at: 'x',
          updated_at: 'x',
          from: ids[0] as string,
          to: ids[1] as string,
          note: '',
          tags: [],
          provenance: { kind: 'manual' },
        },
      ],
      eras: [
        {
          id: 'life',
          created_at: 'x',
          updated_at: 'x',
          name: 'my life',
          when: interval(fromGregorian(2002, 1, 1), fromGregorian(2026, 1, 1)),
          kind: 'personal',
          tags: [],
        } satisfies Era,
        {
          id: 'cold-war',
          created_at: 'x',
          updated_at: 'x',
          name: 'the Cold War',
          when: interval(fromGregorian(1947, 1, 1), fromGregorian(1991, 1, 1)),
          kind: 'canonical',
          tags: ['asia'],
        } satisfies Era,
      ],
    };
    return timeline;
  }

  it('rolls a child tag up to its parent', () => {
    expect(buildAncestry(fixture().tags).get('norway')).toEqual(['norway', 'europe']);
  });

  it('matches an event tagged Norway when filtering by Europe', () => {
    const timeline = fixture();
    const filtered = applyFilter(timeline, { tags: ['europe'] });
    expect(filtered.events).toHaveLength(1);
    expect(filtered.events[0]?.tags).toEqual(['norway']);
  });

  it('hides a connection whose endpoints are filtered out', () => {
    const timeline = fixture();
    // The connection joins the Norway event and the Asia event; filtering to
    // Europe hides one endpoint, so the arc must go too.
    expect(applyFilter(timeline, { tags: ['europe'] }).connections).toHaveLength(
      0,
    );
    expect(applyFilter(timeline, NO_FILTER).connections).toHaveLength(1);
  });

  it('always shows personal eras, whatever the filter', () => {
    const timeline = fixture();
    const filtered = applyFilter(timeline, { tags: ['europe'] });
    expect(filtered.eras.map((e) => e.id)).toEqual(['life']);
  });

  it('survives a cycle in the tag parent chain', () => {
    const cyclic: Tag[] = [tag('a', 'A', 'b'), tag('b', 'B', 'a')];
    expect(() => buildAncestry(cyclic)).not.toThrow();
    expect(buildAncestry(cyclic).get('a')).toEqual(['a', 'b']);
  });

  it('excludes soft-deleted records everywhere', () => {
    const timeline = fixture();
    const withDeleted: Timeline = {
      ...timeline,
      events: timeline.events.map((event, i) =>
        i === 0 ? { ...event, deleted_at: 'now' } : event,
      ),
    };
    const predicates = makePredicates(withDeleted, NO_FILTER);
    expect(withDeleted.events.filter(predicates.event)).toHaveLength(2);
    // ...and the connection that depended on it.
    expect(withDeleted.connections.filter(predicates.connection)).toHaveLength(0);
  });
});

describe('createEra', () => {
  it('creates the personal era first run needs', () => {
    const mutation = createEra(EMPTY_TIMELINE, {
      name: 'my life',
      when: interval(fromGregorian(2002, 1, 1), fromGregorian(2026, 1, 1)),
      kind: 'personal',
    });
    expect(mutation.timeline.eras[0]?.kind).toBe('personal');
    expect(mutation.touched[0]?.kind).toBe('eras');
  });
});

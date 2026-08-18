/**
 * Search and the duplicate guard (design.md §6.2–6.3).
 *
 * The realistic cases run against `generateTimeline()` — 2,000 events with
 * believable titles, notes and reading provenance — because a search tested only
 * against fixtures written to make it pass is not tested at all. The ranking and
 * folding cases use a handful of built events instead, where the point is to pin
 * an exact order or an exact character, and the corpus offers no controlled pair.
 */

import { describe, expect, it } from 'vitest';
import type { Id, TimeSpec, TimelineEvent } from './model/types';
import { findPossibleDuplicates, searchEvents } from './search';
import { generateTimeline } from './testing';
import { fromGregorian, fuzzy, instant, interval } from './time';

const timeline = generateTimeline({ events: 2000, connections: 0, eras: 0, seed: 1 });
const events = timeline.events;
const tagNames = new Map<Id, string>(timeline.tags.map((t) => [t.id, t.name]));

interface Built {
  when?: TimeSpec;
  notes?: string;
  learned_from?: string;
  tags?: Id[];
  deleted_at?: string;
}

function ev(id: string, title: string, extra: Built = {}): TimelineEvent {
  return {
    id,
    created_at: '2026-01-02T09:00:00+01:00',
    updated_at: '2026-01-02T09:00:00+01:00',
    title,
    when: extra.when ?? instant(1571),
    tags: extra.tags ?? [],
    provenance: { kind: 'manual' },
    ...(extra.notes !== undefined ? { notes: extra.notes } : {}),
    ...(extra.learned_from !== undefined ? { learned_from: extra.learned_from } : {}),
    ...(extra.deleted_at !== undefined ? { deleted_at: extra.deleted_at } : {}),
  };
}

const ids = (hits: readonly { event: TimelineEvent }[]): string[] => hits.map((h) => h.event.id);

describe('searchEvents', () => {
  describe('what it matches', () => {
    it('returns nothing for an empty query rather than everything', () => {
      expect(searchEvents(events, '')).toEqual([]);
      expect(searchEvents(events, '   ')).toEqual([]);
    });

    it('finds every event whose title contains the query, and ranks them first', () => {
      const expected = events.filter((e) => e.title.toLowerCase().includes('treaty'));
      expect(expected.length).toBeGreaterThan(5);

      const hits = searchEvents(events, 'treaty');
      const top = hits.slice(0, expected.length);
      expect(new Set(top.map((h) => h.event.id))).toEqual(new Set(expected.map((e) => e.id)));
    });

    it('matches notes', () => {
      const expected = events.filter((e) => (e.notes ?? '').toLowerCase().includes('coin hoard'));
      expect(expected.length).toBeGreaterThan(0);
      const found = new Set(ids(searchEvents(events, 'coin hoard')));
      for (const e of expected) expect(found.has(e.id)).toBe(true);
    });

    it('matches learned_from — "where is that thing the podcast said"', () => {
      const expected = events.filter((e) =>
        (e.learned_from ?? '').toLowerCase().includes('podcast'),
      );
      expect(expected.length).toBeGreaterThan(0);
      const hits = searchEvents(events, 'podcast');
      expect(new Set(ids(hits))).toEqual(new Set(expected.map((e) => e.id)));
    });

    it('matches a tag the event carries, but only when given the names', () => {
      const philosophy = 'tag.theme.philosophy';
      expect(tagNames.get(philosophy)).toBeDefined();
      const tagged = events.filter((e) => e.tags.includes(philosophy));
      expect(tagged.length).toBeGreaterThan(0);

      const withNames = searchEvents(events, 'philosophy', { tagNames });
      const withoutNames = searchEvents(events, 'philosophy');
      const found = new Set(ids(withNames));
      for (const e of tagged) expect(found.has(e.id)).toBe(true);
      expect(withNames.length).toBeGreaterThan(withoutNames.length);
    });

    it('excludes soft-deleted events', () => {
      const target = ev('gone', 'the siege of Tarnogol');
      const alive = ev('here', 'the siege of Tarnogol');
      const deleted = { ...target, deleted_at: '2026-02-01T10:00:00+01:00' };
      expect(ids(searchEvents([deleted, alive], 'tarnogol'))).toEqual(['here']);
    });

    it('honours a limit', () => {
      const hits = searchEvents(events, 'the', { limit: 7 });
      expect(hits).toHaveLength(7);
      expect(searchEvents(events, 'the').length).toBeGreaterThan(7);
    });
  });

  describe('case and diacritics', () => {
    const corpus = [ev('t', 'the siege of Tarnógol'), ev('b', 'the blåbær harvest')];

    it('finds an accented title from an unaccented query', () => {
      expect(ids(searchEvents(corpus, 'tarnogol'))).toEqual(['t']);
      expect(ids(searchEvents(corpus, 'TARNOGOL'))).toEqual(['t']);
      expect(ids(searchEvents(corpus, 'Tarnógol'))).toEqual(['t']);
    });

    it('folds the Norwegian letters that carry no combining mark', () => {
      // "blabaer" is what actually gets typed, and NFD alone does not get there:
      // å decomposes, æ does not.
      expect(ids(searchEvents(corpus, 'blabaer'))).toEqual(['b']);
      expect(ids(searchEvents(corpus, 'blåbær'))).toEqual(['b']);
      expect(ids(searchEvents(corpus, 'BLÅBÆR'))).toEqual(['b']);
    });
  });

  describe('ranking', () => {
    const corpus = [
      ev('notes', 'the naval war', { notes: 'ends at lepanto' }),
      ev('fuzzy', 'le panto'),
      ev('substring', 'sublepanto conjectures'),
      ev('learned', 'the rope trade', { learned_from: 'Gombrich on lepanto, ch. 4' }),
      ev('word', 'the battle of lepanto'),
      ev('tag', 'the harbour works', { tags: ['tag.x'] }),
      ev('prefix', 'lepanto and after'),
    ];
    const names = new Map<Id, string>([['tag.x', 'lepanto studies']]);

    it('orders title prefix, title word, title substring, tag, learned_from, notes, fuzzy', () => {
      expect(ids(searchEvents(corpus, 'lepanto', { tagNames: names }))).toEqual([
        'prefix',
        'word',
        'substring',
        'tag',
        'learned',
        'notes',
        'fuzzy',
      ]);
    });

    it('scores a shorter title above a longer one that matches the same way', () => {
      const short = ev('short', 'lepanto');
      const long = ev('long', 'lepanto and the long aftermath of the naval war');
      expect(ids(searchEvents([long, short], 'lepanto'))).toEqual(['short', 'long']);
    });

    it('breaks ties by the conventional sort key, never by locale', () => {
      // Same tier, same coverage: order falls to b -> a -> title -> id.
      const later = ev('z', 'lepanto', { when: instant(1600) });
      const earlier = ev('a', 'lepanto', { when: instant(1500) });
      expect(ids(searchEvents([later, earlier], 'lepanto'))).toEqual(['a', 'z']);

      const same = [ev('id-2', 'lepanto'), ev('id-1', 'lepanto')];
      expect(ids(searchEvents(same, 'lepanto'))).toEqual(['id-1', 'id-2']);
    });

    it('is deterministic', () => {
      const once = ids(searchEvents(events, 'the siege', { tagNames }));
      const twice = ids(searchEvents(events, 'the siege', { tagNames }));
      expect(twice).toEqual(once);
      expect(once.length).toBeGreaterThan(0);
    });
  });

  describe('fuzzy matching on the title', () => {
    it('survives a typo', () => {
      const corpus = [ev('l', 'the battle of lepanto')];
      expect(ids(searchEvents(corpus, 'lepnto'))).toEqual(['l']);
      expect(ids(searchEvents(corpus, 'batle lepanto'))).toEqual(['l']);
    });

    it('refuses a match stretched across the whole title', () => {
      const corpus = [ev('x', 'lions everywhere prowl and nobody talks of it')];
      expect(searchEvents(corpus, 'lepanto')).toEqual([]);
    });

    it('does not fuzzy-match one or two characters', () => {
      const corpus = [ev('x', 'the naval war')];
      expect(searchEvents(corpus, 'nl')).toEqual([]);
      expect(ids(searchEvents(corpus, 'val'))).toEqual(['x']); // substring, not fuzzy
    });

    it('does not apply fuzzy matching to notes', () => {
      const corpus = [ev('x', 'the harbour works', { notes: 'ends at lepanto' })];
      expect(ids(searchEvents(corpus, 'lepanto'))).toEqual(['x']);
      expect(searchEvents(corpus, 'lepnto')).toEqual([]);
    });
  });

  describe('performance (§6.3: a linear scan, and no index until measurement says otherwise)', () => {
    it('searches 50,000 events in a few milliseconds', () => {
      const big = generateTimeline({ events: 50000, connections: 0, eras: 0, seed: 3 }).events;
      expect(big).toHaveLength(50000);

      // First pass also folds every title, note and provenance line.
      const coldStart = performance.now();
      searchEvents(big, 'tarnogol', { tagNames });
      const cold = performance.now() - coldStart;

      const queries = ['tarnogol', 'treaty of', 'podcast', 'lepnto', 'kaltheim annals'];
      const started = performance.now();
      for (const q of queries) searchEvents(big, q, { tagNames });
      const perQuery = (performance.now() - started) / queries.length;

      // Measured: ~16-21 ms per query standalone, ~40 ms under the test runner,
      // for 50k events. Comfortable at the few-thousand events a real timeline
      // holds; 50k is the stress ceiling, not the expected size. The bound is
      // deliberately loose - it exists to catch a regression of an order of
      // magnitude, not to measure the machine it runs on.
      expect(cold).toBeLessThan(600);
      expect(perQuery).toBeLessThan(120);
    });
  });
});

describe('findPossibleDuplicates', () => {
  const lepanto = ev('lepanto', 'the battle of lepanto', { when: instant(1571) });

  it('catches the same event entered twice', () => {
    expect(findPossibleDuplicates([lepanto], 'the battle of lepanto', instant(1571))).toEqual([
      lepanto,
    ]);
  });

  it('catches it when the second entry is worded a little differently', () => {
    expect(findPossibleDuplicates([lepanto], 'battle of lepanto', instant(1571))).toHaveLength(1);
    expect(findPossibleDuplicates([lepanto], 'the Battle of Lepanto', instant(1571))).toHaveLength(
      1,
    );
    expect(findPossibleDuplicates([lepanto], 'lepanto', instant(1571))).toHaveLength(1);
  });

  it('catches it when the two dates were entered at different granularities', () => {
    const exact = instant(1571, 10, 7);
    expect(findPossibleDuplicates([lepanto], 'the battle of lepanto', exact)).toHaveLength(1);
  });

  it('does not flag the same title a century apart', () => {
    expect(findPossibleDuplicates([lepanto], 'the battle of lepanto', instant(1671))).toEqual([]);
  });

  it('does flag the same title a century apart when both dates are only a century', () => {
    // The tolerance scales with what the dates claim (§6.3): two events placed
    // no more precisely than a century make no claim that tells them apart, so
    // the title is the only evidence there is, and it says duplicate.
    const vague = ev('vague', 'the fall of Ur-Sabath', {
      when: instant(1200, undefined, undefined, { granularity: 'century' }),
    });
    const other = instant(1300, undefined, undefined, { granularity: 'century' });
    expect(findPossibleDuplicates([vague], 'the fall of Ur-Sabath', other)).toHaveLength(1);
  });

  it('does not flag a different event with the same phrasing', () => {
    const siege = ev('siege', 'the siege of Tarnogol', { when: instant(1571) });
    expect(findPossibleDuplicates([siege], 'the siege of Nuzarra', instant(1571))).toEqual([]);
  });

  it('does not flag on a short word shared with a longer title', () => {
    const great = ev('great', 'the great war', { when: instant(1914) });
    expect(findPossibleDuplicates([great], 'war', instant(1914))).toEqual([]);
  });

  it('flags a small rewording of the same claim', () => {
    const fell = ev('fell', 'rome fell', { when: instant(476) });
    expect(findPossibleDuplicates([fell], 'rome falls', instant(476))).toHaveLength(1);
  });

  it('falls back to the title alone when the line carried no date', () => {
    expect(findPossibleDuplicates([lepanto], 'the battle of lepanto', null)).toEqual([lepanto]);
  });

  it('ignores soft-deleted events and an empty title', () => {
    const removed = { ...lepanto, deleted_at: '2026-02-01T10:00:00+01:00' };
    expect(findPossibleDuplicates([removed], 'the battle of lepanto', instant(1571))).toEqual([]);
    expect(findPossibleDuplicates([lepanto], '   ', instant(1571))).toEqual([]);
  });

  it('reaches further when the existing event is an interval around the same years', () => {
    const war = ev('war', 'the great war', {
      when: interval(fromGregorian(1914), fromGregorian(1919), { granularity: 'year' }),
    });
    expect(findPossibleDuplicates([war], 'the great war', instant(1918))).toHaveLength(1);
    expect(findPossibleDuplicates([war], 'the great war', instant(1980))).toEqual([]);
  });

  it('ranks the closest match first and honours a limit', () => {
    const near = ev('near', 'the battle of lepanto', { when: instant(1571) });
    const off = ev('off', 'the battle of lepanto bay', { when: instant(1572) });
    const found = findPossibleDuplicates([off, near], 'the battle of lepanto', instant(1571));
    expect(found.map((e) => e.id)).toEqual(['near', 'off']);
    expect(
      findPossibleDuplicates([off, near], 'the battle of lepanto', instant(1571), { limit: 1 }),
    ).toEqual([near]);
  });

  it('stays quiet across a realistic corpus, and speaks up on a genuine repeat', () => {
    const sample = events[500];
    expect(sample).toBeDefined();
    if (sample === undefined) return;

    // A fresh capture of an event already in the store must be caught.
    const again = findPossibleDuplicates(events, sample.title, sample.when);
    expect(again.map((e) => e.id)).toContain(sample.id);

    // And an unrelated capture must not drown the user in warnings.
    const unrelated = findPossibleDuplicates(
      events,
      'a wholly invented claim about nothing in particular',
      fuzzy(fromGregorian(1700), fromGregorian(1700), fromGregorian(1701), fromGregorian(1701)),
    );
    expect(unrelated).toEqual([]);
  });
});

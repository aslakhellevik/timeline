import { describe, expect, it } from 'vitest';
import type { Tag, Timeline, TimelineEvent } from './model/types';
import { instant } from './time';
import { tagUsage } from './filter';

const STAMP = '2026-01-01T00:00:00+01:00';

function tag(id: string, name: string, parent?: string): Tag {
  return {
    id,
    created_at: STAMP,
    updated_at: STAMP,
    name,
    kind: 'region',
    ...(parent !== undefined ? { parent } : {}),
  };
}

function event(id: string, tags: string[], extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id,
    created_at: STAMP,
    updated_at: STAMP,
    title: id,
    when: instant(1900),
    tags,
    provenance: { kind: 'manual' },
    ...extra,
  };
}

/** Europe > Norway > Oslo, so rollup has more than one level to walk. */
const TAGS = [
  tag('europe', 'Europe'),
  tag('norway', 'Norway', 'europe'),
  tag('oslo', 'Oslo', 'norway'),
  tag('asia', 'Asia'),
];

const usageOf = (timeline: Timeline, includePacks = true) =>
  new Map(tagUsage(timeline, includePacks).map((entry) => [entry.tag.id, entry]));

function build(events: TimelineEvent[], tags: Tag[] = TAGS): Timeline {
  return { events, connections: [], tags, eras: [] };
}

describe('tagUsage', () => {
  it('counts direct use', () => {
    const usage = usageOf(build([event('a', ['europe']), event('b', ['europe'])]));
    expect(usage.get('europe')?.own).toBe(2);
    expect(usage.get('europe')?.total).toBe(2);
  });

  it('rolls descendants up into the parent, because that is what filtering does', () => {
    const usage = usageOf(build([event('a', ['norway']), event('b', ['oslo'])]));
    expect(usage.get('europe')?.own).toBe(0);
    expect(usage.get('europe')?.total).toBe(2);
    expect(usage.get('norway')?.total).toBe(2);
    expect(usage.get('oslo')?.total).toBe(1);
  });

  it('counts an event once per tag however many descendants it carries', () => {
    // Tagged Norway *and* Oslo *and* Europe: still one event under Europe.
    const usage = usageOf(build([event('a', ['europe', 'norway', 'oslo'])]));
    expect(usage.get('europe')?.total).toBe(1);
    expect(usage.get('europe')?.own).toBe(1);
  });

  it('keeps unrelated branches apart', () => {
    const usage = usageOf(build([event('a', ['oslo']), event('b', ['asia'])]));
    expect(usage.get('europe')?.total).toBe(1);
    expect(usage.get('asia')?.total).toBe(1);
  });

  it('ignores deleted events and deleted tags', () => {
    const timeline = build([
      event('a', ['europe']),
      event('b', ['europe'], { deleted_at: STAMP }),
    ]);
    const usage = usageOf(timeline);
    expect(usage.get('europe')?.total).toBe(1);

    const withDeadTag = build([event('a', ['europe'])], [
      { ...(TAGS[0] as Tag), deleted_at: STAMP },
      TAGS[1] as Tag,
    ]);
    expect(usageOf(withDeadTag).has('europe')).toBe(false);
  });

  it('honours the packs toggle, so the counts match what is on screen', () => {
    const timeline = build([event('a', ['europe']), event('b', ['europe'], { pack: 'wwii' })]);
    expect(usageOf(timeline, true).get('europe')?.total).toBe(2);
    expect(usageOf(timeline, false).get('europe')?.total).toBe(1);
  });

  it('reports unused tags with a zero rather than dropping them', () => {
    // The caller decides whether an empty premade tag is worth showing.
    const usage = usageOf(build([event('a', ['asia'])]));
    expect(usage.get('europe')).toEqual({ tag: TAGS[0], own: 0, total: 0 });
  });

  it('terminates on a parent cycle', () => {
    const cyclic = [tag('a', 'A', 'b'), tag('b', 'B', 'a')];
    const usage = usageOf(build([event('e', ['a'])], cyclic));
    expect(usage.get('a')?.total).toBe(1);
    expect(usage.get('b')?.total).toBe(1);
  });

  it('counts a tag no event carries but the timeline defines', () => {
    expect(usageOf(build([])).size).toBe(TAGS.length);
  });
});

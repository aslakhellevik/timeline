import { describe, expect, it } from 'vitest';
import type { Id, Timeline } from '../core/model/types';
import { NO_FILTER, applyFilter } from '../core/filter';
import { fromGregorian, instant, interval } from '../core/time';
import {
  EMPTY_TIMELINE,
  applyUndo,
  createConnection,
  createEra,
  createEvent,
  editEra,
  removeEra,
} from './timeline-model';

const year = (y: number) => fromGregorian(y, 1, 1);

function withEra(kind: 'personal' | 'canonical', name = 'my life'): { timeline: Timeline; id: Id } {
  const mutation = createEra(EMPTY_TIMELINE, {
    name,
    when: interval(year(2002), year(2027)),
    kind,
  });
  return { timeline: mutation.timeline, id: mutation.undo[0]?.id as Id };
}

describe('editEra', () => {
  it('replaces the span and stamps updated_at', () => {
    const { timeline, id } = withEra('personal');
    const when = interval(year(1837), year(1901));
    const mutation = editEra(timeline, id, { when }, '2027-01-01T00:00:00+01:00');

    expect(mutation?.timeline.eras[0]?.when.b).toBe(when.b);
    expect(mutation?.timeline.eras[0]?.updated_at).toBe('2027-01-01T00:00:00+01:00');
    expect(mutation?.touched[0]?.kind).toBe('eras');
  });

  it('can turn a personal era canonical, which changes whether filters hide it', () => {
    const { timeline, id } = withEra('personal');
    const canonical = editEra(timeline, id, { kind: 'canonical' })?.timeline as Timeline;
    expect(canonical.eras[0]?.kind).toBe('canonical');

    // Personal eras survive a tag filter; canonical ones do not (§3.5).
    const filter = { ...NO_FILTER, tags: ['philosophy'] };
    expect(applyFilter(timeline, filter).eras).toHaveLength(1);
    expect(applyFilter(canonical, filter).eras).toHaveLength(0);
  });

  it('returns null for an unknown id', () => {
    expect(editEra(EMPTY_TIMELINE, 'nobody', { name: 'x' })).toBeNull();
  });
});

describe('removeEra', () => {
  it('tombstones rather than deleting', () => {
    const { timeline, id } = withEra('personal');
    const mutation = removeEra(timeline, id);
    expect(mutation?.timeline.eras).toHaveLength(1);
    expect(mutation?.timeline.eras[0]?.deleted_at).toBeTruthy();
    expect(applyFilter(mutation?.timeline as Timeline, NO_FILTER).eras).toHaveLength(0);
  });

  it('is idempotent', () => {
    const { timeline, id } = withEra('personal');
    const once = removeEra(timeline, id)?.timeline as Timeline;
    expect(removeEra(once, id)).toBeNull();
  });

  /**
   * The rule worth pinning down: an era is a frame the timeline is read against,
   * not a container. Deleting "the Cold War" removes a label, and the events
   * that happened during it are untouched.
   */
  it('does not cascade to the events or connections inside it', () => {
    const { timeline, id } = withEra('canonical', 'the Cold War');

    let populated = timeline;
    const ids: Id[] = [];
    for (const y of [1948, 1962, 1989]) {
      const mutation = createEvent(populated, { title: `event ${y}`, when: instant(y) });
      populated = mutation.timeline;
      ids.push(mutation.undo[0]?.id as Id);
    }
    populated = createConnection(populated, {
      from: ids[0] as Id,
      to: ids[2] as Id,
    })?.timeline as Timeline;

    const after = removeEra(populated, id)?.timeline as Timeline;
    const visible = applyFilter(after, NO_FILTER);
    expect(visible.events).toHaveLength(3);
    expect(visible.connections).toHaveLength(1);
    expect(visible.eras).toHaveLength(0);
  });

  it('restores on undo', () => {
    const { timeline, id } = withEra('personal');
    const deletion = removeEra(timeline, id);
    const undone = applyUndo(deletion?.timeline as Timeline, deletion?.undo as never);
    expect(undone.timeline.eras[0]?.deleted_at).toBeUndefined();
    expect(undone.timeline.eras[0]?.name).toBe('my life');
  });
});

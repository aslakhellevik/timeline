/**
 * The store's wiring, against a fake `Store`.
 *
 * The rules themselves are tested in `timeline-model.test.ts`; what is tested
 * here is everything the model cannot see — what reaches the database and
 * when, the connect flow's one
 * rule seen from all three of its entrances, and the cross-tab receiver, which
 * is the only code in the app that can lose an edit nobody made a mistake with.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Base, Timeline } from '../core/model/types';
import { NO_FILTER } from '../core/filter';
import { interval } from '../core/time';
import type { RecordKind, Store, StoreChange } from '../store/contract';
import { connection, event, tag, timeline as makeTimeline } from '../store/fixtures';
import { EMPTY_TIMELINE } from './timeline-model';
import { useTimeline } from './timeline-store';

/** Older than anything `nowIso()` will produce during a test run. */
const OLD = '2020-01-01T00:00:00.000Z';

interface FakeStore extends Store {
  /** What is "on disk". Mutated directly to play the part of another tab. */
  data: Timeline;
  puts: [RecordKind, string[]][];
  replacements: number;
  /** Delivers a change as the BroadcastChannel would. */
  emit(change: StoreChange): void;
}

function fakeStore(initial: Timeline = EMPTY_TIMELINE, failWrites = false): FakeStore {
  const listeners = new Set<(change: StoreChange) => void>();
  const store: FakeStore = {
    data: { ...initial },
    puts: [],
    replacements: 0,

    load: async () => ({
      events: [...store.data.events],
      connections: [...store.data.connections],
      tags: [...store.data.tags],
      eras: [...store.data.eras],
    }),

    put: async (kind, records) => {
      if (failWrites) throw new Error('quota exceeded');
      store.puts.push([kind, records.map((record) => record.id)]);
      const existing = store.data[kind] as Base[];
      const merged = existing.slice();
      for (const record of records as readonly Base[]) {
        const at = merged.findIndex((candidate) => candidate.id === record.id);
        if (at === -1) merged.push(record);
        else merged[at] = record;
      }
      store.data = { ...store.data, [kind]: merged };
    },

    replaceAll: async (next) => {
      if (failWrites) throw new Error('quota exceeded');
      store.replacements++;
      store.data = {
        events: [...next.events],
        connections: [...next.connections],
        tags: [...next.tags],
        eras: [...next.eras],
      };
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    emit: (change) => {
      for (const listener of listeners) listener(change);
    },

    close: () => listeners.clear(),
  };
  return store;
}

/** Longer than the store's cross-tab coalescing window, plus the load it does. */
const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

async function attach(store: Store): Promise<void> {
  await useTimeline.getState().attach(store);
}

const state = () => useTimeline.getState();

beforeEach(() => {
  useTimeline.setState({
    status: 'loading',
    timeline: EMPTY_TIMELINE,
    filter: NO_FILTER,
    selectedId: null,
    selectedConnectionId: null,
    selectedEraId: null,
    connectFrom: null,
    pickerOpen: false,
    query: '',
    undoStack: [],
    undoLabel: null,
    error: null,
    isFirstRun: true,
    lastMutationAt: null,
    persistence: null,
  });
});

describe('undo through the store', () => {
  it('takes back an event and its cascaded connections as one step (D21)', async () => {
    await attach(
      fakeStore(
        makeTimeline({
          events: [event('e1'), event('e2')],
          connections: [connection('c1', { from: 'e1', to: 'e2' })],
        }),
      ),
    );

    state().deleteEvent('e1');
    expect(state().timeline.connections[0]?.deleted_at).toBeTruthy();
    expect(state().undoStack).toHaveLength(1);
    expect(state().undoLabel).toContain('delete event');

    state().undo();
    expect(state().timeline.events.find((e) => e.id === 'e1')?.deleted_at).toBeUndefined();
    expect(state().timeline.connections[0]?.deleted_at).toBeUndefined();
    expect(state().undoLabel).toBeNull();
  });

  it('closes a connection the cascade is about to take with it', async () => {
    await attach(
      fakeStore(
        makeTimeline({
          events: [event('e1'), event('e2')],
          connections: [connection('c1', { from: 'e1', to: 'e2' })],
        }),
      ),
    );

    useTimeline.setState({ selectedId: 'e1', selectedConnectionId: 'c1' });
    state().deleteEvent('e1');

    expect(state().selectedId).toBeNull();
    expect(state().selectedConnectionId).toBeNull();
  });

  it('merges a burst of typing into one entry, and the first "before" is what returns', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1', { title: 'Lepanto' })] })));

    for (const notes of ['N', 'Na', 'Nav', 'Nava', 'Naval']) {
      state().updateEvent('e1', { notes });
    }

    expect(state().undoStack).toHaveLength(1);
    expect(state().timeline.events[0]?.notes).toBe('Naval');

    state().undo();
    expect(state().timeline.events[0]?.notes).toBeUndefined();
  });

  it('starts a new entry when the edit moves to another field', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1', { title: 'Lepanto' })] })));

    state().updateEvent('e1', { notes: 'Naval' });
    state().updateEvent('e1', { title: 'Battle of Lepanto' });

    expect(state().undoStack).toHaveLength(2);
    state().undo();
    expect(state().timeline.events[0]?.title).toBe('Lepanto');
    expect(state().timeline.events[0]?.notes).toBe('Naval');
  });

  it('starts a new entry once the coalescing window has passed', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1')] })));

    state().updateEvent('e1', { notes: 'a' });
    // Age the entry rather than waiting a real second.
    useTimeline.setState({
      undoStack: state().undoStack.map((entry) => ({ ...entry, at: entry.at - 5_000 })),
    });
    state().updateEvent('e1', { notes: 'ab' });

    expect(state().undoStack).toHaveLength(2);
  });

  it('keeps a tag another record still carries when a quick-add is undone', async () => {
    // An event tagged war, on a timeline where the tag record itself has never
    // been materialised — so typing `#war` creates it (D39/D44).
    await attach(fakeStore(makeTimeline({ events: [event('e1', { tags: ['tag.theme.war'] })] })));

    expect(state().quickAdd('Armistice 1918 #war').ok).toBe(true);
    expect(state().timeline.tags.find((t) => t.id === 'tag.theme.war')).toBeTruthy();

    state().undo();

    const war = state().timeline.tags.find((t) => t.id === 'tag.theme.war');
    expect(war?.deleted_at).toBeUndefined();
  });

  it('takes an invented tag back with the event that invented it', async () => {
    await attach(fakeStore());

    expect(state().quickAdd('Something 1918 #entirely-mine').ok).toBe(true);
    expect(state().timeline.tags).toHaveLength(1);

    state().undo();
    expect(state().timeline.tags[0]?.deleted_at).toBeTruthy();
  });

  it('stamps a restored record as a new write, not an old one (§7.7)', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1', { updated_at: OLD })] })));

    state().deleteEvent('e1');
    state().undo();

    // The content is old; the write is new, or a backup taken in between wins
    // on restore and silently re-applies the delete.
    expect(state().timeline.events[0]?.updated_at).not.toBe(OLD);
  });
});

describe('making a connection (§5.4)', () => {
  const twoEvents = () => makeTimeline({ events: [event('e1'), event('e2')] });

  it('persists nothing when the connection is refused', async () => {
    const store = fakeStore(
      makeTimeline({ events: [event('e1'), event('e2', { deleted_at: OLD })] }),
    );
    await attach(store);

    expect(state().addConnection({ from: 'e1', to: 'e2' })).toBeNull();
    await state().flush();

    expect(state().timeline.connections).toHaveLength(0);
    expect(store.puts).toHaveLength(0);
  });

  it('completes through the picker', async () => {
    await attach(fakeStore(twoEvents()));

    state().beginConnect('e1');
    expect(state().pickerOpen).toBe(true);

    const id = state().connectTo('e2');
    expect(id).toBeTruthy();
    expect(state().connectFrom).toBeNull();
    expect(state().pickerOpen).toBe(false);
    expect(state().selectedConnectionId).toBe(id);
  });

  it('completes through a canvas or list selection, with the picker dismissed', async () => {
    await attach(fakeStore(twoEvents()));

    state().beginConnect('e1');
    state().closePicker();
    // The pick stays armed — the one route to the canvas — so any path that
    // would select an event completes it instead.
    expect(state().connectFrom).toBe('e1');

    state().select('e2');
    expect(state().timeline.connections).toHaveLength(1);
    expect(state().connectFrom).toBeNull();
  });

  it('selects the existing connection rather than making a second one', async () => {
    await attach(fakeStore(twoEvents()));

    const first = state().addConnection({ from: 'e1', to: 'e2' });
    state().beginConnect('e2');
    const again = state().connectTo('e1');

    expect(again).toBe(first);
    expect(state().timeline.connections).toHaveLength(1);
  });

  it('does not connect when a bookmark restores a selection', async () => {
    await attach(fakeStore(twoEvents()));

    state().beginConnect('e1');
    state().restoreBookmark({ selectedId: 'e2' });

    // Restoring a bookmark is not a click. Routing it through `select` wrote a
    // connection between the armed event and whatever the URL happened to name.
    expect(state().timeline.connections).toHaveLength(0);
    expect(state().selectedId).toBe('e2');
  });

  it('applies bookmarked tags', async () => {
    await attach(fakeStore(twoEvents()));

    state().restoreBookmark({ tags: ['tag.theme.war'] });

    expect(state().filter).toEqual({ tags: ['tag.theme.war'] });
  });

  it('disarms a pending pick when an era is added', async () => {
    await attach(fakeStore(twoEvents()));

    state().beginConnect('e1');
    state().addEra({ name: 'the 1840s', when: interval(0, 3650), kind: 'personal' });

    expect(state().connectFrom).toBeNull();
    expect(state().pickerOpen).toBe(false);
  });
});

describe('starting over (§7.8)', () => {
  it('leaves nothing queued and nothing stored', async () => {
    const store = fakeStore(makeTimeline({ events: [event('e1')] }));
    await attach(store);

    // Edited but not yet flushed: this is the record that used to be written
    // back after the database had been emptied and resurrect on reload.
    state().updateEvent('e1', { title: 'Still typing' });

    await state().resetAll();
    await state().flush();

    expect(store.data.events).toHaveLength(0);
    expect(state().timeline).toEqual(EMPTY_TIMELINE);
    expect(state().isFirstRun).toBe(true);
  });

  it('keeps the timeline on screen when the write fails', async () => {
    const store = fakeStore(makeTimeline({ events: [event('e1')] }), true);
    await attach(store);

    await state().resetAll();

    // A failed reset that had already blanked the screen would be
    // indistinguishable from a successful one that lost everything.
    expect(state().timeline.events).toHaveLength(1);
    expect(state().isFirstRun).toBe(false);
    expect(state().error).toBeTruthy();
  });
});

describe('another tab writes (§7.1, §7.7)', () => {
  it('keeps the local record when it is the newer of the two', async () => {
    const store = fakeStore(makeTimeline({ events: [event('e1', { title: 'Original' })] }));
    await attach(store);

    state().updateEvent('e1', { title: 'Mine' });
    await state().flush();

    // The other tab writes a version stamped before this one.
    store.data = { ...store.data, events: [event('e1', { title: 'Theirs', updated_at: OLD })] };
    store.emit({ kind: 'events', ids: ['e1'] });
    await delay();

    expect(state().timeline.events[0]?.title).toBe('Mine');
  });

  it('takes the remote record when it is newer, and clears the undo stack', async () => {
    const store = fakeStore(makeTimeline({ events: [event('e1', { title: 'Original' })] }));
    await attach(store);

    state().updateEvent('e1', { notes: 'local' });
    expect(state().undoStack).toHaveLength(1);

    store.data = {
      ...store.data,
      events: [event('e1', { title: 'Theirs', updated_at: '2099-01-01T00:00:00.000Z' })],
    };
    store.emit({ kind: 'events', ids: ['e1'] });
    await delay();

    expect(state().timeline.events[0]?.title).toBe('Theirs');
    // Every step on the stack was computed against a timeline that has gone.
    expect(state().undoStack).toHaveLength(0);
    expect(state().undoLabel).toBeNull();
  });

  it('adds what the change names and drops what has gone', async () => {
    const store = fakeStore(makeTimeline({ events: [event('e1'), event('e2')] }));
    await attach(store);

    store.data = { ...store.data, events: [event('e1'), event('e3')] };
    store.emit({ kind: 'events', ids: ['e2', 'e3'] });
    await delay();

    expect(state().timeline.events.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
  });

  it('leaves records the change does not name alone', async () => {
    const store = fakeStore(makeTimeline({ events: [event('e1'), event('e2')] }));
    await attach(store);

    // A hostile-looking database: e1 has vanished, but nothing announced it.
    store.data = { ...store.data, events: [event('e2')] };
    store.emit({ kind: 'events', ids: ['e2'] });
    await delay();

    expect(state().timeline.events.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('coalesces the burst of announcements a replaceAll makes into one reload', async () => {
    const store = fakeStore(makeTimeline({ events: [event('e1')] }));
    await attach(store);

    let loads = 0;
    const original = store.load.bind(store);
    store.load = async () => {
      loads++;
      return original();
    };

    store.data = { events: [event('e9')], connections: [], tags: [], eras: [] };
    for (const kind of ['events', 'connections', 'tags', 'eras'] as const) {
      store.emit({ kind, ids: ['e1', 'e9'] });
    }
    await delay();

    expect(loads).toBe(1);
    expect(state().timeline.events.map((e) => e.id)).toEqual(['e9']);
  });

  it('stops listening to the store it has been detached from', async () => {
    const first = fakeStore(makeTimeline({ events: [event('e1')] }));
    await attach(first);
    await attach(fakeStore(makeTimeline({ events: [event('e2')] })));

    first.data = { ...first.data, events: [] };
    first.emit({ kind: 'events', ids: ['e1'] });
    await delay();

    expect(state().timeline.events.map((e) => e.id)).toEqual(['e2']);
  });
});

describe('first run (D26)', () => {
  it('creates the life era and the premade vocabulary', async () => {
    await attach(fakeStore());
    expect(state().isFirstRun).toBe(true);

    state().seedLife(1990);

    expect(state().timeline.eras).toHaveLength(1);
    expect(state().timeline.tags.length).toBeGreaterThan(0);
    expect(state().isFirstRun).toBe(false);
  });

  it('is idempotent, so answering twice does not leave two lives on the axis', async () => {
    await attach(fakeStore());

    state().seedLife(1990);
    state().seedLife(1990);

    expect(state().timeline.eras).toHaveLength(1);
  });

  it('seeds the vocabulary without an era, which is what skipping leaves', async () => {
    await attach(fakeStore());

    // Skipping the question used to invent a birth year — a personal era dated
    // from nothing the user ever said. The tags are a separate matter: without
    // them a typed `#war` invents a private tag beside the built-in one (D39).
    state().seedTags();

    expect(state().timeline.eras).toHaveLength(0);
    expect(state().timeline.tags.length).toBeGreaterThan(0);
    expect(state().isFirstRun).toBe(true);
  });

  it('does not end first run until the user has an event or an era of their own', async () => {
    await attach(fakeStore());

    const seen: boolean[] = [];
    const stop = useTimeline.subscribe((current) => seen.push(current.isFirstRun));
    state().seedLife(1990);
    stop();

    // `seedLife` commits twice: the premade vocabulary, then the era. Only the
    // second is the user having something of their own, and dismissing the
    // birth-year screen on the first would leave it half answered.
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });
});

describe('the error line', () => {
  it('clears once a later write succeeds', async () => {
    let failNext = true;
    const store = fakeStore(makeTimeline({ events: [event('e1')] }));
    const put = store.put.bind(store);
    store.put = async (kind, records) => {
      if (failNext) {
        failNext = false;
        throw new Error('quota exceeded');
      }
      await put(kind, records);
    };
    await attach(store);

    state().updateEvent('e1', { title: 'One' });
    await state().flush();
    expect(state().error).toBe('quota exceeded');

    state().updateEvent('e1', { title: 'Two' });
    await state().flush();
    expect(state().error).toBeNull();
  });
});

/**
 * §7.3's layer 2 runs on a dirty signal, and a signal that misses a change is
 * worse than none: it means the automatic backup quietly stops covering it.
 */
describe('the dirty signal (§7.3)', () => {
  it('is null until something changes', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1')] })));
    expect(state().lastMutationAt).toBeNull();
  });

  it('is stamped by an ordinary mutation, and again by the next one', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1')] })));

    state().updateEvent('e1', { title: 'One' });
    const first = state().lastMutationAt;
    expect(first).not.toBeNull();

    await delay(5);
    state().updateEvent('e1', { title: 'Two' });
    expect(state().lastMutationAt).not.toBe(first);
  });

  it('is stamped by an undo, which is a new write and not an old one', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1')] })));
    state().updateEvent('e1', { title: 'One' });
    const before = state().lastMutationAt;

    await delay(5);
    state().undo();
    expect(state().lastMutationAt).not.toBe(before);
  });

  it('is stamped by the wholesale writes as well as the per-record ones', async () => {
    await attach(fakeStore());

    await state().replaceTimeline(makeTimeline({ events: [event('e1')] }));
    const replaced = state().lastMutationAt;
    expect(replaced).not.toBeNull();

    await delay(5);
    await state().resetAll();
    expect(state().lastMutationAt).not.toBe(replaced);
  });

  it('is stamped when another tab changes the timeline', async () => {
    // The backup folder is per machine, not per tab: whichever tab holds the
    // permission has to notice, or an edit made in the other is never saved.
    const store = fakeStore(makeTimeline({ events: [event('e1')] }));
    await attach(store);
    expect(state().lastMutationAt).toBeNull();

    const later = new Date(Date.now() + 60_000).toISOString();
    store.data = { ...store.data, events: [event('e1', { title: 'Elsewhere', updated_at: later })] };
    store.emit({ kind: 'events', ids: ['e1'] });
    await delay();

    expect(state().lastMutationAt).not.toBeNull();
  });
});

describe('claiming persistent storage (§7.3, layer 1)', () => {
  it('asks on the first write, and records the answer', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1')] })));
    expect(state().persistence).toBeNull();

    state().updateEvent('e1', { title: 'Something worth keeping' });
    await delay(5);

    // Node has no `navigator.storage`, so the honest answer here is
    // "unsupported" — the point is that something asked at all.
    expect(state().persistence).not.toBeNull();
    expect(typeof state().persistence?.message).toBe('string');
  });
});

describe("editing an event's tags (§5.2, D20, D44)", () => {
  it('attaches a premade region to a name typed any of its ways', async () => {
    const store = fakeStore(makeTimeline({ events: [event('e1')] }));
    await attach(store);

    state().setEventTags('e1', ['north-america']);
    await state().flush();

    // The whole point of taking names rather than ids: "north-america" is the
    // built-in region, not a private tag beside it (D44) — the difference is
    // whether the event shows under that region's filter.
    expect(state().timeline.events[0]?.tags).toEqual(['tag.region.north-america']);
    expect(state().timeline.tags.map((t) => t.id)).toContain('tag.region.north-america');
  });

  it('invents a tag, and one undo takes back both it and the tagging', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1')] })));

    state().setEventTags('e1', ['siege warfare']);
    const invented = state().timeline.tags.find((t) => t.name === 'siege warfare');
    expect(invented).toBeDefined();
    expect(state().timeline.events[0]?.tags).toEqual([invented?.id]);

    state().undo();
    expect(state().timeline.events[0]?.tags).toEqual([]);
    // Folded into the same entry, exactly as quickAdd folds its own: an undo
    // that left the invented tag live would silently grow the vocabulary. It is
    // tombstoned rather than removed, because D9 applies to a tag as much as to
    // anything else the user might have on another device.
    expect(state().timeline.tags.find((t) => t.name === 'siege warfare')?.deleted_at).toBeTruthy();
  });

  it('removes a tag by leaving it out of the list', async () => {
    await attach(
      fakeStore(
        makeTimeline({
          events: [event('e1', { tags: ['t1', 't2'] })],
          tags: [tag('t1', { name: 'war' }), tag('t2', { name: 'art' })],
        }),
      ),
    );

    state().setEventTags('e1', ['war']);
    expect(state().timeline.events[0]?.tags).toEqual(['t1']);
  });

  it('does nothing for an event that is not there', async () => {
    const store = fakeStore(EMPTY_TIMELINE);
    await attach(store);

    state().setEventTags('missing', ['war']);
    await state().flush();

    // Not even the tag: a mutation that cannot land must not leave half of
    // itself behind in the vocabulary.
    expect(state().timeline.tags).toHaveLength(0);
    expect(store.puts).toHaveLength(0);
  });
});

describe('asking for a reveal (§5.1)', () => {
  it('counts requests, so the same event can be revealed twice', async () => {
    await attach(fakeStore(makeTimeline({ events: [event('e1')] })));

    const before = state().revealRequest;
    state().select('e1');
    // Selecting is not itself a request: the views act on a selection anyway,
    // and a canvas click must not move the picture under the pointer.
    expect(state().revealRequest).toBe(before);

    state().revealSelected();
    state().revealSelected();
    expect(state().revealRequest).toBe(before + 2);
  });
});

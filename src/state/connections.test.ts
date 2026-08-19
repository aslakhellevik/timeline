import { describe, expect, it } from 'vitest';
import { instant } from '../core/time';
import type { Id, Timeline } from '../core/model/types';
import {
  EMPTY_TIMELINE,
  applyUndo,
  connectionsFor,
  createConnection,
  createEvent,
  editConnection,
  findConnectionBetween,
  removeConnection,
  removeEvent,
} from './timeline-model';

/** Three events, and their ids, to connect. */
function corpus(): { timeline: Timeline; ids: Id[] } {
  let timeline = EMPTY_TIMELINE;
  const ids: Id[] = [];
  for (const [title, year] of [
    ['the printing press', 1440],
    ['the ninety-five theses', 1517],
    ['the Peace of Westphalia', 1648],
  ] as const) {
    const mutation = createEvent(timeline, { title, when: instant(year) });
    timeline = mutation.timeline;
    ids.push(mutation.undo[0]?.id as Id);
  }
  return { timeline, ids };
}

function connect(timeline: Timeline, from: Id, to: Id, note = ''): Timeline {
  const mutation = createConnection(timeline, { from, to, note });
  expect(mutation).not.toBeNull();
  return (mutation as NonNullable<typeof mutation>).timeline;
}

describe('createConnection', () => {
  it('creates a connection carrying its own document', () => {
    const { timeline, ids } = corpus();
    const note = 'Cheap print is what made the theses spread beyond Wittenberg.';
    const mutation = createConnection(timeline, {
      from: ids[0] as Id,
      to: ids[1] as Id,
      note,
    });

    const connection = mutation?.timeline.connections[0];
    expect(connection?.note).toBe(note);
    expect(connection?.provenance.kind).toBe('manual');
    expect(mutation?.touched[0]?.kind).toBe('connections');
    expect(mutation?.undo[0]?.record).toBeNull();
  });

  it('refuses to connect an event to itself', () => {
    const { timeline, ids } = corpus();
    expect(createConnection(timeline, { from: ids[0] as Id, to: ids[0] as Id })).toBeNull();
  });

  it('refuses an endpoint that does not exist', () => {
    const { timeline, ids } = corpus();
    expect(createConnection(timeline, { from: ids[0] as Id, to: 'nobody' })).toBeNull();
  });

  it('refuses an endpoint that has been deleted', () => {
    const { timeline, ids } = corpus();
    const after = removeEvent(timeline, ids[1] as Id)?.timeline as Timeline;
    expect(createConnection(after, { from: ids[0] as Id, to: ids[1] as Id })).toBeNull();
  });

  it('refuses a pair that is already connected, in either direction', () => {
    const { timeline, ids } = corpus();
    const after = connect(timeline, ids[0] as Id, ids[1] as Id);
    expect(createConnection(after, { from: ids[0] as Id, to: ids[1] as Id })).toBeNull();
    // v1 reads connections as undirected (D6) even though they store an order.
    expect(createConnection(after, { from: ids[1] as Id, to: ids[0] as Id })).toBeNull();
  });

  it('allows the pair again once the connection is deleted', () => {
    const { timeline, ids } = corpus();
    const connected = connect(timeline, ids[0] as Id, ids[1] as Id);
    const id = connected.connections[0]?.id as Id;
    const after = removeConnection(connected, id)?.timeline as Timeline;
    expect(createConnection(after, { from: ids[0] as Id, to: ids[1] as Id })).not.toBeNull();
  });

  it('preserves the stored order, so a later directional vocabulary can use it', () => {
    const { timeline, ids } = corpus();
    const after = connect(timeline, ids[1] as Id, ids[0] as Id);
    expect(after.connections[0]?.from).toBe(ids[1]);
    expect(after.connections[0]?.to).toBe(ids[0]);
  });
});

describe('findConnectionBetween and connectionsFor', () => {
  it('finds a pair in either direction and ignores tombstones', () => {
    const { timeline, ids } = corpus();
    const connected = connect(timeline, ids[0] as Id, ids[1] as Id);
    expect(findConnectionBetween(connected, ids[1] as Id, ids[0] as Id)).toBeDefined();
    expect(findConnectionBetween(connected, ids[0] as Id, ids[2] as Id)).toBeUndefined();

    const id = connected.connections[0]?.id as Id;
    const removed = removeConnection(connected, id)?.timeline as Timeline;
    expect(findConnectionBetween(removed, ids[0] as Id, ids[1] as Id)).toBeUndefined();
  });

  it('collects every live connection touching an event', () => {
    const { timeline, ids } = corpus();
    let after = connect(timeline, ids[0] as Id, ids[1] as Id);
    after = connect(after, ids[2] as Id, ids[0] as Id);
    expect(connectionsFor(after, ids[0] as Id)).toHaveLength(2);
    expect(connectionsFor(after, ids[1] as Id)).toHaveLength(1);
  });
});

describe('editConnection', () => {
  it('replaces the note and stamps updated_at', () => {
    const { timeline, ids } = corpus();
    const connected = connect(timeline, ids[0] as Id, ids[1] as Id, 'first thought');
    const id = connected.connections[0]?.id as Id;

    const mutation = editConnection(connected, id, { note: 'second thought' }, '2027-01-01T00:00:00+01:00');
    expect(mutation?.timeline.connections[0]?.note).toBe('second thought');
    expect(mutation?.timeline.connections[0]?.updated_at).toBe('2027-01-01T00:00:00+01:00');
    expect(mutation?.undo[0]?.record).toMatchObject({ note: 'first thought' });
  });

  it('returns null for an unknown id rather than inventing a record', () => {
    const { timeline } = corpus();
    expect(editConnection(timeline, 'nobody', { note: 'x' })).toBeNull();
  });
});

describe('removeConnection', () => {
  it('tombstones rather than deleting, because sync needs the tombstone (D9)', () => {
    const { timeline, ids } = corpus();
    const connected = connect(timeline, ids[0] as Id, ids[1] as Id);
    const id = connected.connections[0]?.id as Id;

    const mutation = removeConnection(connected, id);
    expect(mutation?.timeline.connections).toHaveLength(1);
    expect(mutation?.timeline.connections[0]?.deleted_at).toBeTruthy();
    expect(mutation?.touched[0]?.records[0]).toHaveProperty('deleted_at');
  });

  it('is idempotent', () => {
    const { timeline, ids } = corpus();
    const connected = connect(timeline, ids[0] as Id, ids[1] as Id);
    const id = connected.connections[0]?.id as Id;
    const once = removeConnection(connected, id)?.timeline as Timeline;
    expect(removeConnection(once, id)).toBeNull();
  });
});

describe('undo', () => {
  it('tombstones an undone creation, so it does not resurrect on reload', () => {
    const { timeline, ids } = corpus();
    const mutation = createConnection(timeline, { from: ids[0] as Id, to: ids[1] as Id });
    const undone = applyUndo(
      (mutation as NonNullable<typeof mutation>).timeline,
      (mutation as NonNullable<typeof mutation>).undo,
    );

    expect(undone.timeline.connections[0]?.deleted_at).toBeTruthy();
    expect(connectionsFor(undone.timeline, ids[0] as Id)).toHaveLength(0);
    // The tombstone has to reach the database, or the upsert-only store hands
    // the record straight back on the next load.
    expect(undone.touched[0]?.kind).toBe('connections');
  });

  it('restores an event and its cascaded connections together', () => {
    const { timeline, ids } = corpus();
    let after = connect(timeline, ids[0] as Id, ids[1] as Id, 'the argument');
    after = connect(after, ids[0] as Id, ids[2] as Id);

    const deletion = removeEvent(after, ids[0] as Id);
    expect(deletion?.label).toContain('2 connection');
    expect(connectionsFor(deletion?.timeline as Timeline, ids[0] as Id)).toHaveLength(0);

    const undone = applyUndo(deletion?.timeline as Timeline, deletion?.undo as never);
    expect(undone.timeline.events.find((e) => e.id === ids[0])?.deleted_at).toBeUndefined();
    expect(connectionsFor(undone.timeline, ids[0] as Id)).toHaveLength(2);
    // The note is what makes the connection worth restoring at all.
    expect(connectionsFor(undone.timeline, ids[0] as Id).map((c) => c.note)).toContain(
      'the argument',
    );
  });
});

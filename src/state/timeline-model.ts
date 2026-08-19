/**
 * Mutations on a `Timeline`, as pure functions.
 *
 * Every operation returns the new timeline, the records that changed (so the
 * store can persist exactly those), and an undo step. Keeping this layer free of
 * React and of the database means the rules that actually matter — the cascade,
 * the sort order, tag resolution — are testable directly.
 */

import type {
  Base,
  Connection,
  Era,
  Id,
  Tag,
  TagKind,
  TimeSpec,
  Timeline,
  TimelineEvent,
} from '../core/model/types';
import { nowIso, uuidv7 } from '../core/model/ids';
import type { RecordKind } from '../store/contract';

export interface Touched {
  kind: RecordKind;
  records: Base[];
}

/** Previous state of one record. `record: null` means it did not exist. */
export interface UndoStep {
  kind: RecordKind;
  id: Id;
  record: Base | null;
}

export interface Mutation {
  timeline: Timeline;
  touched: Touched[];
  undo: UndoStep[];
  label: string;
}

export const EMPTY_TIMELINE: Timeline = { events: [], connections: [], tags: [], eras: [] };

/**
 * The sort key from the conventions list: `b → a → title → id`, fully
 * deterministic so render order never flickers. Titles compare **by code unit,
 * not `localeCompare`** — collation depends on the host's ICU data, and the same
 * timeline would otherwise sort differently on two machines.
 */
export function compareEvents(x: TimelineEvent, y: TimelineEvent): number {
  if (x.when.b !== y.when.b) return x.when.b < y.when.b ? -1 : 1;
  if (x.when.a !== y.when.a) return x.when.a < y.when.a ? -1 : 1;
  if (x.title !== y.title) return x.title < y.title ? -1 : 1;
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
}

export function sortEvents(events: readonly TimelineEvent[]): TimelineEvent[] {
  return [...events].sort(compareEvents);
}

export interface EventDraft {
  title: string;
  when: TimeSpec;
  tags?: Id[];
  notes?: string;
  learned_from?: string;
  learned_at?: string;
}

function baseFields(now: string): Base {
  return { id: uuidv7(), created_at: now, updated_at: now };
}

export function createEvent(
  timeline: Timeline,
  draft: EventDraft,
  now: string = nowIso(),
): Mutation {
  const event: TimelineEvent = {
    ...baseFields(now),
    title: draft.title,
    when: draft.when,
    tags: draft.tags ?? [],
    provenance: { kind: 'manual' },
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
    ...(draft.learned_from !== undefined ? { learned_from: draft.learned_from } : {}),
    // Recording *when you learned it* is half the point of the project (D10), so
    // it defaults to now rather than being left for the user to remember.
    learned_at: draft.learned_at ?? now,
  };

  return {
    timeline: { ...timeline, events: sortEvents([...timeline.events, event]) },
    touched: [{ kind: 'events', records: [event] }],
    undo: [{ kind: 'events', id: event.id, record: null }],
    label: 'add event',
  };
}

export function editEvent(
  timeline: Timeline,
  id: Id,
  patch: Partial<Omit<TimelineEvent, keyof Base>>,
  now: string = nowIso(),
): Mutation | null {
  const existing = timeline.events.find((event) => event.id === id);
  if (!existing) return null;

  const updated: TimelineEvent = { ...existing, ...patch, updated_at: now };
  const events = sortEvents(timeline.events.map((e) => (e.id === id ? updated : e)));

  return {
    timeline: { ...timeline, events },
    touched: [{ kind: 'events', records: [updated] }],
    undo: [{ kind: 'events', id, record: existing }],
    label: 'edit event',
  };
}

/**
 * Deleting an event soft-deletes its connections in the same operation (D21),
 * as a single undo entry.
 *
 * The alternative — leaving connections dangling and hiding them at render time
 * — pushes a validity check into every consumer of the store, and gets forgotten
 * in exactly one of them.
 */
export function removeEvent(timeline: Timeline, id: Id, now: string = nowIso()): Mutation | null {
  const existing = timeline.events.find((event) => event.id === id);
  if (!existing || existing.deleted_at) return null;

  const deleted: TimelineEvent = { ...existing, deleted_at: now, updated_at: now };
  const undo: UndoStep[] = [{ kind: 'events', id, record: existing }];
  const touched: Touched[] = [{ kind: 'events', records: [deleted] }];

  const orphaned = timeline.connections.filter(
    (c) => !c.deleted_at && (c.from === id || c.to === id),
  );
  const cascaded = orphaned.map((c): Connection => ({ ...c, deleted_at: now, updated_at: now }));

  for (const connection of orphaned) {
    undo.push({ kind: 'connections', id: connection.id, record: connection });
  }
  if (cascaded.length > 0) touched.push({ kind: 'connections', records: cascaded });

  const cascadedById = new Map(cascaded.map((c) => [c.id, c]));

  return {
    timeline: {
      ...timeline,
      events: timeline.events.map((e) => (e.id === id ? deleted : e)),
      connections: timeline.connections.map((c) => cascadedById.get(c.id) ?? c),
    },
    touched,
    undo,
    label: cascaded.length > 0 ? `delete event and ${cascaded.length} connection(s)` : 'delete event',
  };
}

// ---------------------------------------------------------------------------
// Connections (§4, D6)
// ---------------------------------------------------------------------------

export interface ConnectionDraft {
  from: Id;
  to: Id;
  /** Markdown — the argument for why these two belong together. */
  note?: string;
  tags?: Id[];
}

/**
 * The live connection between two events, in either direction.
 *
 * Stored as an ordered pair so a later `caused` / `influenced` vocabulary can be
 * directional without a migration (D6) — but v1 reads them as undirected, so
 * lookup has to ignore the order or the same pair gets connected twice.
 */
export function findConnectionBetween(
  timeline: Timeline,
  a: Id,
  b: Id,
): Connection | undefined {
  return timeline.connections.find(
    (candidate) =>
      !candidate.deleted_at &&
      ((candidate.from === a && candidate.to === b) || (candidate.from === b && candidate.to === a)),
  );
}

/** Every live connection touching an event, for the detail panel. */
export function connectionsFor(timeline: Timeline, id: Id): Connection[] {
  return timeline.connections.filter(
    (candidate) => !candidate.deleted_at && (candidate.from === id || candidate.to === id),
  );
}

/**
 * Creates a connection, or refuses.
 *
 * `null` means the pair is not connectable: an event joined to itself, an
 * endpoint that does not exist or has been deleted, or a pair already connected.
 * The caller decides what to do about it — the store selects the existing
 * connection rather than reporting an error, since wanting to connect two events
 * that are already connected almost always means wanting to read the note.
 */
export function createConnection(
  timeline: Timeline,
  draft: ConnectionDraft,
  now: string = nowIso(),
): Mutation | null {
  if (draft.from === draft.to) return null;

  const live = (id: Id) => timeline.events.some((e) => e.id === id && !e.deleted_at);
  if (!live(draft.from) || !live(draft.to)) return null;
  if (findConnectionBetween(timeline, draft.from, draft.to)) return null;

  const connection: Connection = {
    ...baseFields(now),
    from: draft.from,
    to: draft.to,
    note: draft.note ?? '',
    tags: draft.tags ?? [],
    provenance: { kind: 'manual' },
  };

  return {
    timeline: { ...timeline, connections: [...timeline.connections, connection] },
    touched: [{ kind: 'connections', records: [connection] }],
    undo: [{ kind: 'connections', id: connection.id, record: null }],
    label: 'add connection',
  };
}

export function editConnection(
  timeline: Timeline,
  id: Id,
  patch: Partial<Omit<Connection, keyof Base>>,
  now: string = nowIso(),
): Mutation | null {
  const existing = timeline.connections.find((candidate) => candidate.id === id);
  if (!existing) return null;

  const updated: Connection = { ...existing, ...patch, updated_at: now };

  return {
    timeline: {
      ...timeline,
      connections: timeline.connections.map((c) => (c.id === id ? updated : c)),
    },
    touched: [{ kind: 'connections', records: [updated] }],
    undo: [{ kind: 'connections', id, record: existing }],
    label: 'edit connection',
  };
}

export function removeConnection(
  timeline: Timeline,
  id: Id,
  now: string = nowIso(),
): Mutation | null {
  const existing = timeline.connections.find((candidate) => candidate.id === id);
  if (!existing || existing.deleted_at) return null;

  const deleted: Connection = { ...existing, deleted_at: now, updated_at: now };

  return {
    timeline: {
      ...timeline,
      connections: timeline.connections.map((c) => (c.id === id ? deleted : c)),
    },
    touched: [{ kind: 'connections', records: [deleted] }],
    undo: [{ kind: 'connections', id, record: existing }],
    label: 'delete connection',
  };
}

/**
 * Resolves tag names to ids, creating any that do not exist. Matching is
 * case-insensitive so `#war` typed twice does not become two tags — the quiet
 * way a tag vocabulary rots.
 */
export function ensureTags(
  timeline: Timeline,
  names: readonly string[],
  now: string = nowIso(),
  kind: TagKind = 'user',
): { timeline: Timeline; ids: Id[]; touched: Touched[]; undo: UndoStep[] } {
  const byName = new Map(timeline.tags.map((tag) => [tag.name.toLowerCase(), tag]));
  const created: Tag[] = [];
  const ids: Id[] = [];

  for (const raw of names) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      if (!ids.includes(existing.id)) ids.push(existing.id);
      continue;
    }
    const tag: Tag = { ...baseFields(now), name, kind };
    created.push(tag);
    byName.set(name.toLowerCase(), tag);
    ids.push(tag.id);
  }

  if (created.length === 0) return { timeline, ids, touched: [], undo: [] };

  return {
    timeline: { ...timeline, tags: [...timeline.tags, ...created] },
    ids,
    touched: [{ kind: 'tags', records: created }],
    undo: created.map((tag) => ({ kind: 'tags' as const, id: tag.id, record: null })),
  };
}

export interface EraDraft {
  name: string;
  when: TimeSpec;
  kind: Era['kind'];
  tags?: Id[];
  notes?: string;
}

export function createEra(timeline: Timeline, draft: EraDraft, now: string = nowIso()): Mutation {
  const era: Era = {
    ...baseFields(now),
    name: draft.name,
    when: draft.when,
    kind: draft.kind,
    tags: draft.tags ?? [],
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
  };

  return {
    timeline: { ...timeline, eras: [...timeline.eras, era] },
    touched: [{ kind: 'eras', records: [era] }],
    undo: [{ kind: 'eras', id: era.id, record: null }],
    label: 'add era',
  };
}

/**
 * Applies undo steps, returning the restored timeline and what to persist.
 *
 * Undoing a *creation* tombstones the record rather than dropping it from the
 * array. The store is upsert-only by design — D9 keeps tombstones because sync
 * needs them — so a record merely removed from memory would come back on the
 * next load. A tombstone disappears from every view (the filter excludes
 * `deleted_at`) and stays gone.
 */
export function applyUndo(
  timeline: Timeline,
  steps: readonly UndoStep[],
  now: string = nowIso(),
): Mutation {
  // Readonly while accumulating, materialised once at the end: `restore`
  // returns new arrays rather than mutating, and typing them mutable here would
  // be a claim this function does not need to make.
  let events: readonly TimelineEvent[] = timeline.events;
  let connections: readonly Connection[] = timeline.connections;
  let tags: readonly Tag[] = timeline.tags;
  let eras: readonly Era[] = timeline.eras;
  const touched: Touched[] = [];

  const restore = <T extends Base>(list: readonly T[], step: UndoStep): readonly T[] => {
    if (step.record === null) {
      const current = list.find((item) => item.id === step.id);
      if (!current || current.deleted_at) return list;
      const tombstoned: T = { ...current, deleted_at: now, updated_at: now };
      touched.push({ kind: step.kind, records: [tombstoned] });
      return list.map((item) => (item.id === step.id ? tombstoned : item));
    }

    const record = step.record as T;
    touched.push({ kind: step.kind, records: [record] });
    return list.some((item) => item.id === step.id)
      ? list.map((item) => (item.id === step.id ? record : item))
      : [...list, record];
  };

  for (const step of steps) {
    switch (step.kind) {
      case 'events':
        events = restore(events, step);
        break;
      case 'connections':
        connections = restore(connections, step);
        break;
      case 'tags':
        tags = restore(tags, step);
        break;
      case 'eras':
        eras = restore(eras, step);
        break;
    }
  }

  return {
    timeline: {
      events: sortEvents(events),
      connections: [...connections],
      tags: [...tags],
      eras: [...eras],
    },
    touched,
    undo: [],
    label: 'undo',
  };
}

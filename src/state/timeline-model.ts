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
import { BUILTIN_TAGS, builtinTagByName, normaliseTagName } from '../core/model/builtin-tags';
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
  /**
   * Key under which consecutive mutations merge into one undo entry (§7.6).
   * Unset means "never merge" — a delete and its cascade are one step and the
   * next thing the user does is a different one.
   */
  coalesce?: string;
}

/** One undoable action: what to put back, and what to call it in the UI. */
export interface UndoEntry {
  steps: UndoStep[];
  label: string;
  coalesce?: string;
  /** `Date.now()` when it was recorded, for the coalescing window. */
  at: number;
}

/**
 * The empty timeline — the store's initial state and the value "start over"
 * writes, so it is deep-frozen: a consumer that pushed into one of these arrays
 * would corrupt every later reset, and the failure would surface nowhere near
 * the code that caused it.
 */
export const EMPTY_TIMELINE: Timeline = Object.freeze({
  events: frozenList<TimelineEvent>(),
  connections: frozenList<Connection>(),
  tags: frozenList<Tag>(),
  eras: frozenList<Era>(),
});

/** Frozen at runtime, but still the mutable type `Timeline` declares. */
function frozenList<T>(): T[] {
  return Object.freeze([]) as unknown as T[];
}

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

/**
 * A patch: any field may be changed, and an **optional** field may be cleared by
 * passing `undefined`.
 *
 * `Partial<T>` cannot express the second half under `exactOptionalPropertyTypes`
 * — it permits the key to be absent but not present-and-undefined, so there is
 * no way to say "remove the place from this event". Naively admitting undefined
 * everywhere is worse: it would also let a patch clear `title`, which is not
 * optional and whose absence nothing downstream expects.
 */
type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never;
}[keyof T];

export type Patch<T> = Partial<Pick<T, Exclude<keyof T, OptionalKeys<T>>>> & {
  [K in OptionalKeys<T>]?: T[K] | undefined;
};

/**
 * Applies a patch, **removing** keys set to `undefined` rather than storing them
 * as present-and-undefined.
 *
 * A spread would leave `place: undefined` sitting on the record. That is not the
 * same as having no place: it round-trips differently through JSON and
 * structured clone, and it contradicts the record types, which under
 * `exactOptionalPropertyTypes` say an absent optional field is absent. Deleting
 * is both what the caller meant and what the type says.
 */
function applyPatch<T extends object>(record: T, patch: object, now: string): T {
  const next: Record<string, unknown> = { ...record, updated_at: now };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

/** How long consecutive edits of one field stay a single undo entry (§7.6). */
export const COALESCE_MS = 1000;

/**
 * The key consecutive edits merge under.
 *
 * Typing into a note fires a mutation per keystroke, and one undo entry per
 * keystroke emptied a fifty-deep stack inside a single sentence. Edits of the
 * *same field of the same record*, moments apart, are one thing the user did.
 *
 * Changing field breaks the key deliberately: going back to before you touched
 * the title is a different step from going back to before you touched the note.
 */
function coalesceKey(kind: RecordKind, id: Id, patch: object): string {
  return `${kind}:${id}:${Object.keys(patch).sort().join(',')}`;
}

/**
 * Pushes an undo entry, merging it into the top one when it continues the same
 * edit (§7.6).
 *
 * The merge keeps the *older* entry's steps — its "before" is what undo has to
 * restore — and only moves the clock forward, so a continuous burst of typing
 * stays one step no matter how long it runs. A cascading delete carries no key
 * and is therefore never merged (D21).
 */
export function pushUndo(
  stack: readonly UndoEntry[],
  entry: UndoEntry,
  depth: number,
  windowMs: number = COALESCE_MS,
): UndoEntry[] {
  const top = stack[stack.length - 1];
  if (
    entry.coalesce !== undefined &&
    top?.coalesce === entry.coalesce &&
    entry.at - top.at < windowMs
  ) {
    return [...stack.slice(0, -1), { ...top, at: entry.at }];
  }
  return [...stack, entry].slice(-depth);
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
  patch: Patch<Omit<TimelineEvent, keyof Base>>,
  now: string = nowIso(),
): Mutation | null {
  const existing = timeline.events.find((event) => event.id === id);
  if (!existing) return null;

  const updated = applyPatch(existing, patch, now);
  const events = sortEvents(timeline.events.map((e) => (e.id === id ? updated : e)));

  return {
    timeline: { ...timeline, events },
    touched: [{ kind: 'events', records: [updated] }],
    undo: [{ kind: 'events', id, record: existing }],
    label: 'edit event',
    coalesce: coalesceKey('events', id, patch),
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
  patch: Patch<Omit<Connection, keyof Base>>,
  now: string = nowIso(),
): Mutation | null {
  const existing = timeline.connections.find((candidate) => candidate.id === id);
  if (!existing) return null;

  const updated = applyPatch(existing, patch, now);

  return {
    timeline: {
      ...timeline,
      connections: timeline.connections.map((c) => (c.id === id ? updated : c)),
    },
    touched: [{ kind: 'connections', records: [updated] }],
    undo: [{ kind: 'connections', id, record: existing }],
    label: 'edit connection',
    coalesce: coalesceKey('connections', id, patch),
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
 *
 * Names are compared **normalised** (D44): `-`, `_` and a space are the same
 * character and a leading article is dropped, because a `#tag` is one word and
 * half the premade regions are not. Without it `#nordics` and `#north-america`
 * each invented a private tag beside the built-in one, and the event never
 * showed under the region's filter. A premade tag reached by one of its other spellings is
 * materialised at its fixed id rather than copied under a new one (D20/D39).
 */
export function ensureTags(
  timeline: Timeline,
  names: readonly string[],
  now: string = nowIso(),
  kind: TagKind = 'user',
): { timeline: Timeline; ids: Id[]; touched: Touched[]; undo: UndoStep[] } {
  const byName = new Map(timeline.tags.map((tag) => [normaliseTagName(tag.name), tag]));
  const byId = new Map(timeline.tags.map((tag) => [tag.id, tag]));
  const created: Tag[] = [];
  const ids: Id[] = [];

  const take = (tag: Tag): void => {
    if (!ids.includes(tag.id)) ids.push(tag.id);
  };
  const add = (tag: Tag): void => {
    created.push(tag);
    byName.set(normaliseTagName(tag.name), tag);
    byId.set(tag.id, tag);
    take(tag);
  };

  for (const raw of names) {
    const name = raw.trim();
    if (name.length === 0) continue;

    const existing = byName.get(normaliseTagName(name));
    if (existing) {
      take(existing);
      continue;
    }

    const builtin = builtinTagByName(name);
    if (builtin) {
      const record = byId.get(builtin.id);
      if (record) take(record);
      else add({ ...builtin, created_at: now, updated_at: now });
      continue;
    }

    add({ ...baseFields(now), name, kind });
  }

  if (created.length === 0) return { timeline, ids, touched: [], undo: [] };

  return {
    timeline: { ...timeline, tags: [...timeline.tags, ...created] },
    ids,
    touched: [{ kind: 'tags', records: created }],
    undo: created.map((tag) => ({ kind: 'tags' as const, id: tag.id, record: null })),
  };
}

/**
 * Materialises the premade tag set as records (D14, D20).
 *
 * They exist as constants, but until they exist as *records* they cannot be
 * filtered on, and — worse — `ensureTags` matches by name, so typing `#war` on a
 * timeline without them invents a private "war" tag beside the built-in one.
 * The vocabulary silently forks in two, which is exactly what fixed namespaced
 * ids were supposed to prevent.
 *
 * Idempotent by id, so it is safe to run on every install and on first run.
 */
export function installBuiltinTags(timeline: Timeline, now: string = nowIso()): Mutation {
  const known = new Set(timeline.tags.map((tag) => tag.id));
  const created = BUILTIN_TAGS.filter((tag) => !known.has(tag.id)).map(
    (tag): Tag => ({ ...tag, created_at: now, updated_at: now }),
  );

  if (created.length === 0) {
    return { timeline, touched: [], undo: [], label: 'tags already present' };
  }

  return {
    timeline: { ...timeline, tags: [...timeline.tags, ...created] },
    touched: [{ kind: 'tags', records: created }],
    // No undo: this is setup, not an edit, and undoing it would break every
    // record that references one of these ids.
    undo: [],
    label: 'add the premade tags',
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

export function editEra(
  timeline: Timeline,
  id: Id,
  patch: Patch<Omit<Era, keyof Base>>,
  now: string = nowIso(),
): Mutation | null {
  const existing = timeline.eras.find((era) => era.id === id);
  if (!existing) return null;

  const updated = applyPatch(existing, patch, now);

  return {
    timeline: { ...timeline, eras: timeline.eras.map((e) => (e.id === id ? updated : e)) },
    touched: [{ kind: 'eras', records: [updated] }],
    undo: [{ kind: 'eras', id, record: existing }],
    label: 'edit era',
    coalesce: coalesceKey('eras', id, patch),
  };
}

/**
 * Soft-deletes an era.
 *
 * No cascade, unlike an event (D21): an era is a frame the timeline is read
 * against, not something events belong to. Deleting "the Cold War" removes a
 * label, not the events that happened during it.
 */
export function removeEra(timeline: Timeline, id: Id, now: string = nowIso()): Mutation | null {
  const existing = timeline.eras.find((era) => era.id === id);
  if (!existing || existing.deleted_at) return null;

  const deleted: Era = { ...existing, deleted_at: now, updated_at: now };

  return {
    timeline: { ...timeline, eras: timeline.eras.map((e) => (e.id === id ? deleted : e)) },
    touched: [{ kind: 'eras', records: [deleted] }],
    undo: [{ kind: 'eras', id, record: existing }],
    label: 'delete era',
  };
}

/** Tag ids a live record still carries, so undo cannot take one away. */
function referencedTags(
  events: readonly TimelineEvent[],
  connections: readonly Connection[],
  eras: readonly Era[],
): Set<Id> {
  const used = new Set<Id>();
  for (const record of [...events, ...connections, ...eras]) {
    if (record.deleted_at) continue;
    for (const tag of record.tags) used.add(tag);
  }
  return used;
}

/**
 * Applies undo steps, returning the restored timeline and what to persist.
 *
 * Undoing a *creation* tombstones the record rather than dropping it from the
 * array. The store is upsert-only by design — D9 keeps tombstones because sync
 * needs them — so a record merely removed from memory would come back on the
 * next load. A tombstone disappears from every view (the filter excludes
 * `deleted_at`) and stays gone.
 *
 * Restored records are stamped with the current `updated_at`. The *content* is
 * old; the *write* is new, and leaving the old stamp on it meant a backup taken
 * between the action and the undo looked newer to the merge rule and silently
 * re-applied the change the user had just taken back (§7.7).
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

    const record: T = { ...(step.record as T), updated_at: now };
    touched.push({ kind: step.kind, records: [record] });
    return list.some((item) => item.id === step.id)
      ? list.map((item) => (item.id === step.id ? record : item))
      : [...list, record];
  };

  // Tag removals are decided after the rest of the batch: undoing a quick-add
  // takes back the event *and* the tag it invented, and while the event is
  // still there the tag trivially looks in use.
  const removedTags: UndoStep[] = [];

  for (const step of steps) {
    switch (step.kind) {
      case 'events':
        events = restore(events, step);
        break;
      case 'connections':
        connections = restore(connections, step);
        break;
      case 'tags':
        if (step.record === null) removedTags.push(step);
        else tags = restore(tags, step);
        break;
      case 'eras':
        eras = restore(eras, step);
        break;
    }
  }

  if (removedTags.length > 0) {
    const inUse = referencedTags(events, connections, eras);
    for (const step of removedTags) {
      // Undoing the quick-add that invented `#war` must not take the tag away
      // from the four other events that have since been given it by hand.
      if (!inUse.has(step.id)) tags = restore(tags, step);
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

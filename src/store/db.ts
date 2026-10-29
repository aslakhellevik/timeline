/**
 * The working store: IndexedDB via `idb`, one object store per record kind
 * (docs/design.md §8.1).
 *
 * The in-memory `Timeline` is canonical; this is only the durable record of it.
 * Two responsibilities beyond read and write:
 *
 *   - every write is one transaction, so a crash mid-write cannot leave a
 *     half-written store;
 *   - every committed write is broadcast, because two tabs both holding
 *     in-memory state would otherwise silently eat each other's edits.
 */

import { deleteDB, openDB } from 'idb';
import type { Connection, Era, Tag, Timeline, TimelineEvent } from '../core/model/types';
import type { RecordKind, Store, StoreChange } from './contract';
import { SCHEMA_VERSION } from './contract';
import { RECORD_KINDS, SchemaVersionError, migrate } from './serialise';

export const DEFAULT_DB_NAME = 'arlinje';

/**
 * Bumped when the object stores themselves change, not when the data schema
 * does. Up to 3 it tracked `SCHEMA_VERSION`, which is what lets
 * `startingSchemaVersion` below infer the schema of a database that predates
 * the meta store. Version 4 drops the `packs` store (D70).
 */
const DB_VERSION = 4;

/** Object stores earlier versions created and this one deletes on upgrade. */
const RETIRED_STORES = ['packs'];

/** Where the schema version of the records on disk is kept (§8.1). */
const META_STORE = 'meta';
const SCHEMA_KEY = 'schema_version';

/**
 * What schema the records in an existing database are written in.
 *
 * Only reachable for a database created before the meta store existed, so the
 * answer has to be inferred, and `DB_VERSION` is the only evidence there is:
 * version 1 is the schema-1 build, version 2 the schema-2 build, and a database
 * being created now is written at the current version by definition.
 */
function startingSchemaVersion(oldVersion: number): number {
  if (oldVersion === 0) return SCHEMA_VERSION;
  return oldVersion === 1 ? 1 : 2;
}

/**
 * Opens (or creates) the store. `name` exists so tests, and any future
 * "second timeline" idea, can have their own database.
 */
export async function createIndexedDbStore(name: string = DEFAULT_DB_NAME): Promise<Store> {
  const db = await openDB(name, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      for (const kind of RECORD_KINDS) {
        if (!database.objectStoreNames.contains(kind)) {
          database.createObjectStore(kind, { keyPath: 'id' });
        }
      }
      // What an older build kept there is not carried over: installed-pack
      // records mean nothing now, and the records a pack brought live in the
      // ordinary stores, where the schema 2 → 3 migration on load makes them
      // the user's own.
      for (const retired of RETIRED_STORES) {
        if (database.objectStoreNames.contains(retired)) database.deleteObjectStore(retired);
      }
      // Written only when the store is created, never on a later upgrade: after
      // that the stored version is the record of what is actually on disk and
      // guessing over it would skip the migration it exists to trigger.
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
        void transaction
          .objectStore(META_STORE)
          .put(startingSchemaVersion(oldVersion), SCHEMA_KEY);
      }
    },
  });

  const readSchemaVersion = async (): Promise<number> => {
    const stored = (await db.get(META_STORE, SCHEMA_KEY)) as unknown;
    // Absent means a database this build has never opened before the meta store
    // existed — impossible via `upgrade`, but a missing value must not be read
    // as "version 0" and sent through every migration a second time.
    return typeof stored === 'number' && Number.isInteger(stored) && stored >= 1
      ? stored
      : SCHEMA_VERSION;
  };

  const listeners = new Set<(change: StoreChange) => void>();
  const channel = openChannel(name, (change) => {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch (error) {
        // One bad listener must not stop the others from catching up. Surface
        // the failure without swallowing it.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  });

  const announce = (change: StoreChange): void => {
    if (change.ids.length === 0) return;
    try {
      channel?.postMessage(change);
    } catch {
      // A closed or unavailable channel is not a reason to fail a write that
      // has already committed.
    }
  };

  const store: Store = {
    async load() {
      const version = await readSchemaVersion();
      // A database written by a newer build of the app. Exactly the case where
      // reading on regardless and writing back what this build understands
      // destroys the fields it does not (the same argument as `SchemaVersionError`
      // at import), so it stops instead of quietly downgrading the timeline.
      if (version > SCHEMA_VERSION) throw new SchemaVersionError(version, SCHEMA_VERSION);

      const tx = db.transaction(RECORD_KINDS, 'readonly');
      const [events, connections, tags, eras] = await Promise.all([
        tx.objectStore('events').getAll(),
        tx.objectStore('connections').getAll(),
        tx.objectStore('tags').getAll(),
        tx.objectStore('eras').getAll(),
      ]);
      await tx.done;

      // Records come back in key order, not insertion order; nothing downstream
      // depends on store order (the renderer sorts by time).
      const loaded: Timeline = {
        events: events as TimelineEvent[],
        connections: connections as Connection[],
        tags: tags as Tag[],
        eras: eras as Era[],
      };

      if (version === SCHEMA_VERSION) return loaded;

      /*
       * §8.1: migrations are applied "on load and on import". Import had them
       * from the start and this path did not, so a database written by an older
       * build was handed to the app unmigrated — the one case where the
       * migration chain, which exists precisely so that old data opens, was
       * never run.
       *
       * The records are put through the same ordered chain a file goes through,
       * written back, and the version recorded, so the cost is paid once.
       */
      const migrated = migrate({
        schema_version: version,
        exported_at: new Date().toISOString(),
        ...loaded,
      });
      const next: Timeline = {
        events: migrated.events,
        connections: migrated.connections,
        tags: migrated.tags,
        eras: migrated.eras,
      };
      await store.replaceAll(next);
      await db.put(META_STORE, SCHEMA_VERSION, SCHEMA_KEY);
      return next;
    },

    async put(kind, records) {
      if (records.length === 0) return;

      const tx = db.transaction(kind, 'readwrite');
      const store = tx.objectStore(kind);
      // Tombstones are written like any other record: removing them here would
      // resurrect the record on the next load (D9).
      await Promise.all([...records.map((record) => store.put(record)), tx.done]);

      announce({ kind, ids: unique(records.map((record) => record.id)) });
    },

    async replaceAll(timeline) {
      const tx = db.transaction(RECORD_KINDS, 'readwrite');
      const stores = RECORD_KINDS.map((kind) => tx.objectStore(kind));

      // What was there before, so other tabs can be told which ids to drop as
      // well as which to re-read.
      const previous = await Promise.all(stores.map((store) => store.getAllKeys()));

      const pending: Promise<unknown>[] = [];
      const changes: StoreChange[] = [];

      for (let i = 0; i < RECORD_KINDS.length; i++) {
        const kind = RECORD_KINDS[i];
        const store = stores[i];
        if (!kind || !store) continue;

        const records = timeline[kind];
        pending.push(store.clear());
        for (const record of records) pending.push(store.put(record));

        const before = (previous[i] ?? []).map((key) => String(key));
        changes.push({ kind, ids: unique([...before, ...records.map((record) => record.id)]) });
      }

      await Promise.all(pending);
      await tx.done;

      for (const change of changes) announce(change);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      listeners.clear();
      channel?.close();
      db.close();
    },
  };

  return store;
}

/**
 * Everything the other tab needs is the kind and the ids: it re-reads those
 * records from IndexedDB and drops the ones that have gone. That covers
 * `replaceAll` too, which reports the union of the ids it removed and wrote.
 *
 * Absent in workers and older Safari, so it is feature-detected rather than
 * assumed; without it the store still works, single-tab.
 */
function openChannel(
  name: string,
  onChange: (change: StoreChange) => void,
): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null;

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(`${name}::store-changes`);
  } catch {
    return null;
  }

  channel.onmessage = (event: MessageEvent) => {
    const change = asStoreChange(event.data);
    if (change) onChange(change);
  };

  // Node's implementation keeps the event loop alive; browsers have no `unref`.
  (channel as BroadcastChannel & { unref?: () => void }).unref?.();

  return channel;
}

/** The channel is shared with anything on the origin, so messages are checked. */
function asStoreChange(data: unknown): StoreChange | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as Partial<StoreChange>;
  if (typeof candidate.kind !== 'string') return null;
  if (!RECORD_KINDS.includes(candidate.kind as RecordKind)) return null;
  if (!Array.isArray(candidate.ids)) return null;
  const ids = candidate.ids.filter((id): id is string => typeof id === 'string');
  return { kind: candidate.kind as RecordKind, ids };
}

function unique(ids: readonly string[]): string[] {
  return ids.length < 2 ? ids.slice() : [...new Set(ids)];
}

/** Deletes a database outright. Test and "start again" support, not part of `Store`. */
export async function deleteStore(name: string = DEFAULT_DB_NAME): Promise<void> {
  await deleteDB(name);
}

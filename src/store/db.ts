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
import type { Connection, Era, InstalledPack, Tag, TimelineEvent } from '../core/model/types';
import type { RecordKind, Store, StoreChange } from './contract';
import { RECORD_KINDS } from './serialise';

export const DEFAULT_DB_NAME = 'arlinje';

/** Bumped only when the object stores themselves change, not when the data schema does. */
const DB_VERSION = 2;

/**
 * Opens (or creates) the store. `name` exists so tests, and any future
 * "second timeline" idea, can have their own database.
 */
export async function createIndexedDbStore(name: string = DEFAULT_DB_NAME): Promise<Store> {
  const db = await openDB(name, DB_VERSION, {
    upgrade(database) {
      for (const kind of RECORD_KINDS) {
        if (!database.objectStoreNames.contains(kind)) {
          database.createObjectStore(kind, { keyPath: 'id' });
        }
      }
    },
  });

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

  return {
    async load() {
      const tx = db.transaction(RECORD_KINDS, 'readonly');
      const [events, connections, tags, eras, packs] = await Promise.all([
        tx.objectStore('events').getAll(),
        tx.objectStore('connections').getAll(),
        tx.objectStore('tags').getAll(),
        tx.objectStore('eras').getAll(),
        tx.objectStore('packs').getAll(),
      ]);
      await tx.done;

      // Records come back in key order, not insertion order; nothing downstream
      // depends on store order (the renderer sorts by time).
      return {
        events: events as TimelineEvent[],
        connections: connections as Connection[],
        tags: tags as Tag[],
        eras: eras as Era[],
        packs: packs as InstalledPack[],
      };
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

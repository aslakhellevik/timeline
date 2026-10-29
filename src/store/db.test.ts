import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Store, StoreChange } from './contract';
import { SCHEMA_VERSION } from './contract';
import { createIndexedDbStore, deleteStore } from './db';
import { SchemaVersionError } from './serialise';
import { T1, T3, connection, era, event, sampleTimeline, tag } from './fixtures';

const open: Store[] = [];
let counter = 0;

/** A fresh database per test: fake-indexeddb keeps everything for the whole file. */
async function store(name: string = `store-test-${counter++}`): Promise<Store> {
  const created = await createIndexedDbStore(name);
  open.push(created);
  return created;
}

function sortById<T extends { id: string }>(records: readonly T[]): T[] {
  return records.slice().sort((a, b) => a.id.localeCompare(b.id));
}

afterEach(() => {
  for (const created of open.splice(0)) created.close();
  vi.unstubAllGlobals();
});

describe('createIndexedDbStore', () => {
  it('starts empty', async () => {
    const db = await store();
    expect(await db.load()).toEqual({ events: [], connections: [], tags: [], eras: [] });
  });

  it('writes a timeline and hands it back after a reload', async () => {
    const name = `roundtrip-${counter++}`;
    const original = sampleTimeline();

    const first = await store(name);
    await first.replaceAll(original);
    first.close();

    const second = await store(name);
    const loaded = await second.load();

    expect(sortById(loaded.events)).toEqual(sortById(original.events));
    expect(sortById(loaded.connections)).toEqual(sortById(original.connections));
    expect(sortById(loaded.tags)).toEqual(sortById(original.tags));
    expect(sortById(loaded.eras)).toEqual(sortById(original.eras));
  });

  it('upserts by id rather than appending', async () => {
    const db = await store();
    await db.put('events', [event('e1', { title: 'First' })]);
    await db.put('events', [event('e1', { title: 'Second', updated_at: T3 })]);

    const loaded = await db.load();
    expect(loaded.events).toHaveLength(1);
    expect(loaded.events[0]?.title).toBe('Second');
  });

  it('writes every kind through the same call shape', async () => {
    const db = await store();
    await db.put('events', [event('e1')]);
    await db.put('connections', [connection('c1')]);
    await db.put('tags', [tag('t1')]);
    await db.put('eras', [era('r1')]);

    const loaded = await db.load();
    expect(loaded.events).toHaveLength(1);
    expect(loaded.connections).toHaveLength(1);
    expect(loaded.tags).toHaveLength(1);
    expect(loaded.eras).toHaveLength(1);
  });

  it('accepts an empty write without complaint', async () => {
    const db = await store();
    await expect(db.put('events', [])).resolves.toBeUndefined();
  });

  it('keeps tombstones across a reload instead of resurrecting the record', async () => {
    const name = `tombstone-${counter++}`;

    const first = await store(name);
    await first.put('events', [event('e1'), event('e2')]);
    await first.put('events', [event('e1', { updated_at: T3, deleted_at: T3 })]);
    first.close();

    const second = await store(name);
    const loaded = await second.load();
    const deleted = loaded.events.find((candidate) => candidate.id === 'e1');

    expect(loaded.events).toHaveLength(2);
    expect(deleted?.deleted_at).toBe(T3);
  });

  it('replaces everything, dropping records the new timeline does not have', async () => {
    const db = await store();
    await db.put('events', [event('old-1'), event('old-2')]);
    await db.replaceAll({ events: [event('new-1')], connections: [], tags: [], eras: [] });

    const loaded = await db.load();
    expect(loaded.events.map((e) => e.id)).toEqual(['new-1']);
  });

  it('survives being closed and reopened repeatedly', async () => {
    const name = `reopen-${counter++}`;
    for (let i = 0; i < 3; i++) {
      const db = await store(name);
      await db.put('events', [event(`e${i}`, { created_at: T1 })]);
      db.close();
    }

    const db = await store(name);
    expect((await db.load()).events).toHaveLength(3);
  });
});

describe('deleteStore', () => {
  it('removes the database entirely', async () => {
    const name = `deletable-${counter++}`;
    const first = await store(name);
    await first.put('events', [event('e1')]);
    first.close();
    open.length = 0;

    await deleteStore(name);

    const second = await store(name);
    expect((await second.load()).events).toEqual([]);
  });
});

describe('subscribe', () => {
  it('returns an unsubscribe that stops delivery', async () => {
    const db = await store();
    const listener = vi.fn();
    const off = db.subscribe(listener);
    off();
    await db.put('events', [event('e1')]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('works when BroadcastChannel is absent', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);

    const db = await store();
    const off = db.subscribe(() => undefined);

    await expect(db.put('events', [event('e1')])).resolves.toBeUndefined();
    expect((await db.load()).events).toHaveLength(1);
    expect(() => off()).not.toThrow();
    expect(() => db.close()).not.toThrow();
  });
});

/** Delivery is cross-tab, so it needs a real channel; skip where there is none. */
const hasChannel = typeof BroadcastChannel === 'function';

describe.skipIf(!hasChannel)('cross-tab notification', () => {
  function nextChange(db: Store, timeoutMs = 2000): Promise<StoreChange> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('no change was delivered'));
      }, timeoutMs);
      const off = db.subscribe((change) => {
        clearTimeout(timer);
        off();
        resolve(change);
      });
    });
  }

  it('tells another tab which ids changed', async () => {
    const name = `tabs-${counter++}`;
    const tabA = await store(name);
    const tabB = await store(name);

    const delivered = nextChange(tabB);
    await tabA.put('events', [event('e1'), event('e2')]);

    const change = await delivered;
    expect(change.kind).toBe('events');
    expect(change.ids.sort()).toEqual(['e1', 'e2']);
  });

  it('delivers ids the other tab can act on', async () => {
    const name = `tabs-act-${counter++}`;
    const tabA = await store(name);
    const tabB = await store(name);

    const delivered = nextChange(tabB);
    await tabA.put('events', [event('e1', { title: 'Written by the other tab' })]);
    const change = await delivered;

    // What a receiving tab actually does: re-read those records.
    const loaded = await tabB.load();
    const caught = loaded.events.filter((candidate) => change.ids.includes(candidate.id));
    expect(caught[0]?.title).toBe('Written by the other tab');
  });

  it('reports both the removed and the written ids after replaceAll', async () => {
    const name = `tabs-replace-${counter++}`;
    const tabA = await store(name);
    await tabA.put('events', [event('gone')]);

    const tabB = await store(name);
    const delivered = nextChange(tabB);
    await tabA.replaceAll({ events: [event('kept')], connections: [], tags: [], eras: [] });

    const change = await delivered;
    expect(change.kind).toBe('events');
    expect(change.ids.sort()).toEqual(['gone', 'kept']);
  });

  it('does not deliver a tab its own writes', async () => {
    const name = `tabs-self-${counter++}`;
    const tabA = await store(name);
    const listener = vi.fn();
    tabA.subscribe(listener);

    await tabA.put('events', [event('e1')]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not cross between differently named stores', async () => {
    const tabA = await store(`isolated-a-${counter++}`);
    const tabB = await store(`isolated-b-${counter++}`);
    const listener = vi.fn();
    tabB.subscribe(listener);

    await tabA.put('events', [event('e1')]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(listener).not.toHaveBeenCalled();
  });
});

/**
 * §8.1 says migrations are applied "on load and on import". Import had them
 * from the start; this path did not, so a database written by an older build
 * reached the app unmigrated — the one case the migration chain exists for.
 */
describe('migrations on load (§8.1)', () => {
  /** Reads the recorded schema version straight out of the meta store. */
  async function storedVersion(name: string): Promise<unknown> {
    const raw = await openDB(name);
    const value = await raw.get('meta', 'schema_version');
    raw.close();
    return value;
  }

  /**
   * A database as an older build left it: IndexedDB version 1, the record
   * stores present, and no meta store to say what schema the records are in.
   */
  async function legacyDatabase(name: string): Promise<void> {
    const raw = await openDB(name, 1, {
      upgrade(database) {
        for (const kind of ['events', 'connections', 'tags', 'eras', 'packs']) {
          database.createObjectStore(kind, { keyPath: 'id' });
        }
      },
    });
    await raw.put('events', event('e1', { title: 'Written by the old build' }));
    await raw.put('packs', { id: 'pack.junk', created_at: T1, updated_at: T1 });
    raw.close();
  }

  /**
   * A database as the last build with packs left it (D70): IndexedDB version 3,
   * schema 2 in the meta store, a `packs` store, and pack records in the
   * ordinary stores. Aslak's own timeline is one of these.
   */
  async function schema2Database(name: string): Promise<void> {
    const raw = await openDB(name, 3, {
      upgrade(database) {
        for (const kind of ['events', 'connections', 'tags', 'eras', 'packs']) {
          database.createObjectStore(kind, { keyPath: 'id' });
        }
        database.createObjectStore('meta');
      },
    });
    await raw.put('meta', 2, 'schema_version');
    await raw.put('events', event('mine'));
    await raw.put('events', {
      ...event('pack.cold-war/sputnik', { title: 'Sputnik' }),
      pack: 'pack.cold-war',
      provenance: { kind: 'pack', ref: 'pack.cold-war' },
    });
    await raw.put('packs', {
      id: 'pack.cold-war',
      created_at: T1,
      updated_at: T1,
      name: 'Cold War',
      version: '1',
      license: 'CC BY-SA 4.0',
      installed_at: T1,
    });
    raw.close();
  }

  async function storeNames(name: string): Promise<string[]> {
    const raw = await openDB(name);
    const names = [...raw.objectStoreNames];
    raw.close();
    return names;
  }

  it('runs the chain over records an older build wrote, and keeps them', async () => {
    const name = `legacy-${counter++}`;
    await legacyDatabase(name);

    const db = await store(name);
    const loaded = await db.load();

    expect(loaded.events.map((e) => e.id)).toEqual(['e1']);
    expect(Object.keys(loaded).sort()).toEqual(['connections', 'eras', 'events', 'tags']);
  });

  it('opens a database with packs, keeping their records as the user’s own', async () => {
    const name = `schema2-${counter++}`;
    await schema2Database(name);

    const db = await store(name);
    const loaded = await db.load();

    expect(loaded.events.map((e) => e.id).sort()).toEqual(['mine', 'pack.cold-war/sputnik']);
    const sputnik = loaded.events.find((e) => e.id === 'pack.cold-war/sputnik');
    expect(sputnik && 'pack' in sputnik).toBe(false);
    expect(sputnik?.provenance).toEqual({ kind: 'import', ref: 'pack.cold-war' });
    expect(await storeNames(name)).not.toContain('packs');
    expect(await storedVersion(name)).toBe(SCHEMA_VERSION);

    // Written back, not just migrated in memory.
    db.close();
    open.length = 0;
    const raw = await openDB(name);
    const stored = (await raw.get('events', 'pack.cold-war/sputnik')) as Record<string, unknown>;
    raw.close();
    expect('pack' in stored).toBe(false);
  });

  it('records the new version, so the migration is paid for once', async () => {
    const name = `legacy-once-${counter++}`;
    await legacyDatabase(name);

    const db = await store(name);
    await db.load();
    expect(await storedVersion(name)).toBe(SCHEMA_VERSION);

    // And the write-back really happened: a second load, which now migrates
    // nothing, still sees the migrated state.
    expect((await db.load()).events.map((e) => e.id)).toEqual(['e1']);
    expect(await storeNames(name)).not.toContain('packs');
  });

  it('stamps a database it creates with the current version, migrating nothing', async () => {
    const name = `fresh-${counter++}`;
    const db = await store(name);
    await db.put('events', [event('e1')]);
    expect(await storedVersion(name)).toBe(SCHEMA_VERSION);
    expect((await db.load()).events).toHaveLength(1);
  });

  it('refuses to open a database written by a newer build rather than downgrade it', async () => {
    // The same argument as `SchemaVersionError` at import: reading on regardless
    // means writing back without the fields this build does not know about.
    const name = `newer-${counter++}`;
    const db = await store(name);
    await db.put('events', [event('e1')]);
    db.close();
    open.length = 0;

    const raw = await openDB(name);
    await raw.put('meta', SCHEMA_VERSION + 5, 'schema_version');
    raw.close();

    const reopened = await store(name);
    await expect(reopened.load()).rejects.toThrow(SchemaVersionError);
  });
});

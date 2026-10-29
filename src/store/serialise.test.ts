import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from './contract';
import type { TimelineDocument } from './contract';
import {
  DocumentFormatError,
  MIGRATIONS,
  SchemaVersionError,
  asDocument,
  compareTimestamps,
  fromDocument,
  isWellFormedRecord,
  mergeDocument,
  migrate,
  parseDocument,
  serialiseDocument,
  toDocument,
} from './serialise';
import { T1, T2, T3, connection, era, event, sampleTimeline, spec, tag, timeline } from './fixtures';

function doc(partial: Partial<TimelineDocument> = {}): TimelineDocument {
  return {
    schema_version: SCHEMA_VERSION,
    exported_at: T2,
    events: [],
    connections: [],
    tags: [],
    eras: [],
    ...partial,
  };
}

describe('toDocument / fromDocument', () => {
  it('round-trips a timeline through a document', () => {
    const original = sampleTimeline();
    expect(fromDocument(toDocument(original))).toEqual(original);
  });

  it('round-trips through JSON, which is the actual portability contract', () => {
    const original = sampleTimeline();
    const text = serialiseDocument(toDocument(original));
    expect(fromDocument(parseDocument(text))).toEqual(original);
  });

  it('stamps the current schema version and a generator', () => {
    const document = toDocument(timeline(), { exportedAt: T3 });
    expect(document.schema_version).toBe(SCHEMA_VERSION);
    expect(document.exported_at).toBe(T3);
    expect(document.generator).toMatch(/\S/);
  });

  it('copies the arrays, so later edits do not rewrite an exported document', () => {
    const original = sampleTimeline();
    const document = toDocument(original);
    original.events.push(event('e3'));
    expect(document.events).toHaveLength(2);
  });
});

describe('parseDocument', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseDocument('{ nope')).toThrow(DocumentFormatError);
  });

  it('rejects JSON that is not a document', () => {
    expect(() => parseDocument('[1, 2, 3]')).toThrow(DocumentFormatError);
    expect(() => parseDocument('{"events": []}')).toThrow(DocumentFormatError);
  });

  it('accepts a hand-written file that omits empty collections', () => {
    const document = asDocument({ schema_version: SCHEMA_VERSION, events: [event('e1')] });
    expect(document.events).toHaveLength(1);
    expect(document.connections).toEqual([]);
    expect(document.tags).toEqual([]);
    expect(document.eras).toEqual([]);
  });
});

describe('migrate', () => {
  it('has one migration per released schema version', () => {
    expect(MIGRATIONS).toHaveLength(SCHEMA_VERSION - 1);
  });

  it('passes a current document through untouched', () => {
    const current = doc({ events: [event('e1')] });
    expect(migrate(current)).toBe(current);
  });

  it('throws on a future schema version rather than mangling the data', () => {
    const future = doc({ schema_version: SCHEMA_VERSION + 1 });
    expect(() => migrate(future)).toThrow(SchemaVersionError);
    try {
      migrate(future);
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaVersionError);
      const versioned = error as SchemaVersionError;
      expect(versioned.found).toBe(SCHEMA_VERSION + 1);
      expect(versioned.supported).toBe(SCHEMA_VERSION);
      expect(versioned.message).toContain('newer version');
    }
  });

  it('rejects a nonsense version', () => {
    expect(() => migrate(doc({ schema_version: 0 }))).toThrow(DocumentFormatError);
    expect(() => migrate(doc({ schema_version: 1.5 }))).toThrow(DocumentFormatError);
  });

  it('guards the import and merge paths too', () => {
    const future = doc({ schema_version: SCHEMA_VERSION + 1 });
    expect(() => fromDocument(future)).toThrow(SchemaVersionError);
    expect(() => mergeDocument(timeline(), future)).toThrow(SchemaVersionError);
  });
});

/**
 * Schema 2 had packs (D70 removed them): a list of installed packs, a `pack` id
 * on every record one brought, and `provenance.kind: 'pack'`. An export written
 * then has to import now, with the pack content as the user's own.
 */
describe('migrate — schema 2 → 3, packs removed', () => {
  /** An export as the schema-2 build wrote it, inline and as plain JSON. */
  const SCHEMA_2_EXPORT = {
    schema_version: 2,
    exported_at: T2,
    generator: 'arlinje/0.0.0',
    events: [
      { ...event('mine', { title: 'Mine' }), provenance: { kind: 'manual' } },
      {
        ...event('pack.second-world-war/d-day', { title: 'D-Day' }),
        pack: 'pack.second-world-war',
        provenance: { kind: 'pack', ref: 'pack.second-world-war' },
      },
      {
        ...event('read', { title: 'Read somewhere' }),
        provenance: { kind: 'ai_extract', ref: 'notes/reading.md', confidence: 0.7 },
      },
    ],
    connections: [
      {
        ...connection('c1', { from: 'mine', to: 'pack.second-world-war/d-day' }),
        pack: 'pack.second-world-war',
        provenance: { kind: 'pack', ref: 'pack.second-world-war' },
      },
    ],
    tags: [{ ...tag('tag.theme.war', { name: 'war', kind: 'theme' }), pack: 'pack.second-world-war' }],
    eras: [{ ...era('ww2', { kind: 'canonical' }), pack: 'pack.second-world-war' }],
    packs: [
      {
        id: 'pack.second-world-war',
        created_at: T1,
        updated_at: T1,
        name: 'Second World War',
        version: '1',
        license: 'CC BY-SA 4.0',
        installed_at: T1,
      },
    ],
  };

  it('drops the installed packs and makes every pack record the user’s own', () => {
    const migrated = migrate(parseDocument(JSON.stringify(SCHEMA_2_EXPORT)));

    expect(migrated.schema_version).toBe(SCHEMA_VERSION);
    expect('packs' in migrated).toBe(false);
    const records = [...migrated.events, ...migrated.connections, ...migrated.tags, ...migrated.eras];
    expect(records).toHaveLength(6);
    for (const record of records) expect('pack' in record).toBe(false);

    const kinds = Object.fromEntries(migrated.events.map((e) => [e.id, e.provenance]));
    expect(kinds['mine']).toEqual({ kind: 'manual' });
    // The ref survives, so where it came from is still on the record.
    expect(kinds['pack.second-world-war/d-day']).toEqual({
      kind: 'import',
      ref: 'pack.second-world-war',
    });
    expect(kinds['read']).toEqual({ kind: 'import', ref: 'notes/reading.md', confidence: 0.7 });
    expect(migrated.connections[0]?.provenance.kind).toBe('import');
  });

  it('imports through the merge rule like any other file', () => {
    const result = mergeDocument(
      timeline(),
      parseDocument(serialiseDocument(SCHEMA_2_EXPORT as unknown as TimelineDocument)),
    );

    expect(result.timeline.events.map((e) => e.id)).toEqual([
      'mine',
      'pack.second-world-war/d-day',
      'read',
    ]);
    expect(result.timeline.connections).toHaveLength(1);
    expect(result.timeline.eras).toHaveLength(1);
    expect(Object.keys(result.stats).sort()).toEqual(['connections', 'eras', 'events', 'tags']);
    expect(result.stats.events).toEqual({ added: 3, updated: 0, skipped: 0, rejected: 0 });
  });

  it('does not touch the input document', () => {
    const input = parseDocument(JSON.stringify(SCHEMA_2_EXPORT));
    migrate(input);
    expect((input.events[1] as unknown as { pack?: string }).pack).toBe('pack.second-world-war');
  });
});

describe('compareTimestamps', () => {
  it('compares instants, not strings', () => {
    // The same moment, written in two offsets.
    expect(compareTimestamps('2026-06-01T10:00:00+02:00', '2026-06-01T08:00:00Z')).toBe(0);
    // Later instant, but the earlier-looking string.
    expect(compareTimestamps('2026-06-01T09:00:00Z', '2026-06-01T10:00:00+02:00')).toBe(1);
  });

  it('falls back to string order when a value will not parse', () => {
    expect(compareTimestamps('nonsense', 'nonsense')).toBe(0);
    expect(compareTimestamps('b', 'a')).toBe(1);
    expect(compareTimestamps(undefined, T1)).toBe(-1);
  });

  /**
   * The fallback is kept, and this is what keeping it costs. A garbled string
   * cannot be clamped the way an absurd future instant can, and the alternatives
   * — treating it as the epoch, or throwing — lose more: the first lets any real
   * timestamp overwrite it, the second aborts a whole import over one field.
   * What the fallback buys is a *total, deterministic* order, so that merging
   * the same file twice reaches the same timeline.
   */
  it('is a byte comparison, so an unreadable value can sort above a real one', () => {
    expect(compareTimestamps('zzz', '2026-08-15T10:00:00Z')).toBe(1);
    expect(compareTimestamps('2026-08-15T10:00:00Z', 'zzz')).toBe(-1);
  });

  it('is deterministic between two unreadable values, which is the point of it', () => {
    expect(compareTimestamps('nope', 'also nope')).toBe(1);
    expect(compareTimestamps('also nope', 'nope')).toBe(-1);
  });
});

describe('mergeDocument', () => {
  it('adds records it has never seen, of every kind', () => {
    const result = mergeDocument(
      timeline(),
      doc({
        events: [event('e1')],
        connections: [connection('c1', { from: 'e1', to: 'e1' })],
        tags: [tag('t1')],
        eras: [era('r1')],
      }),
    );

    expect(result.timeline.events).toHaveLength(1);
    expect(result.timeline.connections).toHaveLength(1);
    expect(result.timeline.tags).toHaveLength(1);
    expect(result.timeline.eras).toHaveLength(1);
    expect(result.stats.events).toEqual({ added: 1, updated: 0, skipped: 0, rejected: 0 });
    expect(result.stats.eras).toEqual({ added: 1, updated: 0, skipped: 0, rejected: 0 });
  });

  it('lets the newer updated_at win when the incoming record is newer', () => {
    const current = timeline({ events: [event('e1', { title: 'Old', updated_at: T1 })] });
    const result = mergeDocument(current, doc({ events: [event('e1', { title: 'New', updated_at: T2 })] }));

    expect(result.timeline.events[0]?.title).toBe('New');
    expect(result.stats.events).toEqual({ added: 0, updated: 1, skipped: 0, rejected: 0 });
  });

  it('lets the newer updated_at win when the local record is newer', () => {
    const current = timeline({ events: [event('e1', { title: 'Mine', updated_at: T3 })] });
    const result = mergeDocument(current, doc({ events: [event('e1', { title: 'Theirs', updated_at: T2 })] }));

    expect(result.timeline.events[0]?.title).toBe('Mine');
    expect(result.stats.events).toEqual({ added: 0, updated: 0, skipped: 1, rejected: 0 });
  });

  it('keeps the local record on an equal timestamp', () => {
    const current = timeline({ events: [event('e1', { title: 'Mine', updated_at: T2 })] });
    const result = mergeDocument(current, doc({ events: [event('e1', { title: 'Theirs', updated_at: T2 })] }));

    expect(result.timeline.events[0]?.title).toBe('Mine');
    expect(result.stats.events.skipped).toBe(1);
  });

  it('compares timestamps as instants across offsets', () => {
    const current = timeline({
      events: [event('e1', { title: 'Mine', updated_at: '2026-06-01T10:00:00+02:00' })],
    });
    // 09:00Z is 11:00+02:00 — newer, though it sorts earlier as a string.
    const result = mergeDocument(
      current,
      doc({ events: [event('e1', { title: 'Theirs', updated_at: '2026-06-01T09:00:00Z' })] }),
    );

    expect(result.timeline.events[0]?.title).toBe('Theirs');
  });

  it('leaves records the document says nothing about alone', () => {
    const current = timeline({ events: [event('e1'), event('e2')] });
    const result = mergeDocument(current, doc({ events: [event('e2', { updated_at: T3 })] }));

    expect(result.timeline.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(result.stats.events).toEqual({ added: 0, updated: 1, skipped: 0, rejected: 0 });
  });

  it('does not mutate the timeline it was given', () => {
    const current = timeline({ events: [event('e1', { title: 'Mine', updated_at: T1 })] });
    mergeDocument(current, doc({ events: [event('e1', { title: 'Theirs', updated_at: T3 })] }));

    expect(current.events[0]?.title).toBe('Mine');
  });

  it('copies accepted records, so the merged timeline does not alias the document', () => {
    const incoming = event('e1', { title: 'From the file' });
    const result = mergeDocument(timeline(), doc({ events: [incoming] }));
    incoming.title = 'Mutated afterwards';

    expect(result.timeline.events[0]?.title).toBe('From the file');
  });
});

describe('mergeDocument — tombstones (D9)', () => {
  it('applies a newer tombstone rather than keeping the live record', () => {
    const current = timeline({ events: [event('e1', { updated_at: T1 })] });
    const result = mergeDocument(
      current,
      doc({ events: [event('e1', { updated_at: T2, deleted_at: T2 })] }),
    );

    expect(result.timeline.events).toHaveLength(1);
    expect(result.timeline.events[0]?.deleted_at).toBe(T2);
  });

  it('does not resurrect a record deleted since the document was written', () => {
    const current = timeline({ events: [event('e1', { updated_at: T3, deleted_at: T3 })] });
    const result = mergeDocument(current, doc({ events: [event('e1', { updated_at: T2 })] }));

    expect(result.timeline.events[0]?.deleted_at).toBe(T3);
    expect(result.stats.events.skipped).toBe(1);
  });

  it('re-adds a record the document has and this store has never seen, tombstone or not', () => {
    const result = mergeDocument(
      timeline(),
      doc({ events: [event('e9', { updated_at: T2, deleted_at: T2 })] }),
    );

    expect(result.timeline.events).toHaveLength(1);
    expect(result.timeline.events[0]?.deleted_at).toBe(T2);
  });
});

describe('mergeDocument — restoring a backup onto a diverged store (§8.3)', () => {
  it('keeps every edit made since the backup, and restores what was lost', () => {
    // The backup: three events as they were in January.
    const backup = doc({
      exported_at: T1,
      events: [
        event('e1', { title: 'Lepanto', updated_at: T1 }),
        event('e2', { title: 'Trafalgar', updated_at: T1 }),
        event('e3', { title: 'Jutland', updated_at: T1 }),
      ],
      tags: [tag('t1', { name: 'Naval', updated_at: T1 })],
    });

    // The store since: e1 rewritten, e2 deleted, e3 lost to a browser wipe,
    // e4 added, and a tag renamed.
    const current = timeline({
      events: [
        event('e1', { title: 'Battle of Lepanto', updated_at: T3 }),
        event('e2', { title: 'Trafalgar', updated_at: T3, deleted_at: T3 }),
        event('e4', { title: 'Added since', updated_at: T3 }),
      ],
      tags: [tag('t1', { name: 'Naval history', updated_at: T3 })],
    });

    const result = mergeDocument(current, backup);
    const byId = new Map(result.timeline.events.map((e) => [e.id, e]));

    expect(byId.get('e1')?.title).toBe('Battle of Lepanto');
    expect(byId.get('e2')?.deleted_at).toBe(T3);
    expect(byId.get('e3')?.title).toBe('Jutland');
    expect(byId.get('e4')?.title).toBe('Added since');
    expect(result.timeline.tags[0]?.name).toBe('Naval history');
    expect(result.stats.events).toEqual({ added: 1, updated: 0, skipped: 2, rejected: 0 });
    expect(result.stats.tags).toEqual({ added: 0, updated: 0, skipped: 1, rejected: 0 });
  });

  it('is idempotent — restoring the same backup twice changes nothing', () => {
    const current = sampleTimeline();
    const backup = toDocument(current, { exportedAt: T2 });

    const once = mergeDocument(current, backup);
    const twice = mergeDocument(once.timeline, backup);

    expect(twice.timeline).toEqual(current);
    expect(twice.stats.events).toEqual({ added: 0, updated: 0, skipped: 2, rejected: 0 });
  });
});

/**
 * §8.7. Everything below is data the app is not entitled to trust: a file the
 * user edited by hand, a file written by somebody else, a device with the wrong
 * date. The store is trusted absolutely by everything downstream, so the merge
 * is where the checking has to happen.
 */
describe('mergeDocument — hostile and hand-edited documents', () => {
  it('rejects an event with no when, which would throw the moment it was sorted', () => {
    const broken = { ...event('e1') } as unknown as Record<string, unknown>;
    delete broken.when;

    const result = mergeDocument(timeline(), doc({ events: [broken as never] }));

    expect(result.timeline.events).toHaveLength(0);
    expect(result.stats.events.rejected).toBe(1);
    expect(result.stats.events.added).toBe(0);
  });

  it('rejects a when whose numbers are out of order or not numbers', () => {
    const backwards = event('e1', { when: { ...spec(), a: 10, b: 5, c: 5, d: 5 } });
    const stringy = event('e2', { when: { ...spec(), b: '1571' as unknown as number } });

    const result = mergeDocument(timeline(), doc({ events: [backwards, stringy] }));
    expect(result.timeline.events).toHaveLength(0);
    expect(result.stats.events.rejected).toBe(2);
  });

  it('rejects tags that are not a list of strings', () => {
    const result = mergeDocument(
      timeline(),
      doc({
        events: [
          event('e1', { tags: 'war' as unknown as string[] }),
          event('e2', { tags: [{ id: 'war' }] as unknown as string[] }),
        ],
      }),
    );

    expect(result.timeline.events).toHaveLength(0);
    expect(result.stats.events.rejected).toBe(2);
  });

  it('rejects a place whose coordinates are strings, which would map to NaN', () => {
    const result = mergeDocument(
      timeline(),
      doc({
        events: [
          event('e1', { place: { name: 'Lepanto', lat: '38.2' as unknown as number, lon: 21.3 } }),
        ],
      }),
    );

    expect(result.stats.events.rejected).toBe(1);
  });

  it('accepts a place with only a name — most events have no coordinates', () => {
    const result = mergeDocument(
      timeline(),
      doc({ events: [event('e1', { place: { name: 'somewhere in Asia' } })] }),
    );

    expect(result.timeline.events).toHaveLength(1);
  });

  it('rejects records with no id or no timestamps, of every kind', () => {
    const strip = (record: object, field: string) => {
      const copy = { ...record } as Record<string, unknown>;
      delete copy[field];
      return copy as never;
    };

    const result = mergeDocument(
      timeline(),
      doc({
        events: [strip(event('e1'), 'id'), strip(event('e2'), 'updated_at')],
        tags: [strip(tag('t1'), 'created_at'), tag('t2', { name: 1 as unknown as string })],
        eras: [strip(era('r1'), 'id')],
      }),
    );

    expect(result.stats.events.rejected).toBe(2);
    expect(result.stats.tags.rejected).toBe(2);
    expect(result.stats.eras.rejected).toBe(1);
    expect(result.timeline.events).toHaveLength(0);
  });

  it('drops a connection whose endpoints nothing has, and counts it', () => {
    const current = timeline({ events: [event('e1')] });
    const result = mergeDocument(
      current,
      doc({ connections: [connection('c1', { from: 'e1', to: 'nowhere' })] }),
    );

    expect(result.timeline.connections).toHaveLength(0);
    expect(result.stats.connections.rejected).toBe(1);
  });

  it('keeps a connection whose endpoints arrive in the same document', () => {
    const result = mergeDocument(
      timeline(),
      doc({
        events: [event('e1'), event('e2')],
        connections: [connection('c1', { from: 'e1', to: 'e2' })],
      }),
    );

    expect(result.timeline.connections).toHaveLength(1);
    expect(result.stats.connections.rejected).toBe(0);
  });

  it('leaves a local connection alone even if its endpoint has gone', () => {
    // Only incoming records are checked. Rejecting on the way *in* is a guard;
    // deleting what is already there would be the merge losing data on its own.
    const current = timeline({ connections: [connection('c1', { from: 'gone', to: 'also-gone' })] });
    const result = mergeDocument(current, doc({}));

    expect(result.timeline.connections).toHaveLength(1);
  });

  it('is still lenient about missing collections, which a hand-written file needs', () => {
    const result = mergeDocument(
      timeline(),
      asDocument({ schema_version: SCHEMA_VERSION, events: [event('e1')] }),
    );

    expect(result.timeline.events).toHaveLength(1);
    expect(result.stats.connections.rejected).toBe(0);
  });
});

describe('mergeDocument — the future-timestamp guard (§8.7)', () => {
  const NOW = new Date('2026-08-15T12:00:00Z');
  const soon = new Date(NOW.getTime() + 3 * 3_600_000).toISOString();
  const absurd = '2035-01-01T00:00:00.000Z';

  it('leaves a timestamp a few hours ahead alone — clocks and offsets differ', () => {
    const result = mergeDocument(
      timeline({ events: [event('e1', { title: 'Mine', updated_at: T3 })] }),
      doc({ events: [event('e1', { title: 'Theirs', updated_at: soon })] }),
      { now: NOW },
    );

    expect(result.timeline.events[0]?.title).toBe('Theirs');
    expect(result.timeline.events[0]?.updated_at).toBe(soon);
  });

  it('clamps a record stamped in 2035 back to the moment of the import', () => {
    // Left alone, that record could never be overwritten again: every later
    // edit would compare as older and lose.
    const result = mergeDocument(timeline(), doc({ events: [event('e1', { updated_at: absurd })] }), {
      now: NOW,
    });

    expect(result.timeline.events).toHaveLength(1);
    expect(result.timeline.events[0]?.updated_at).toBe(NOW.toISOString());
    expect(result.stats.events.added).toBe(1);
  });

  it('clamped, it no longer beats a local record it has nothing newer to say than', () => {
    const current = timeline({ events: [event('e1', { title: 'Mine', updated_at: T3 })] });
    const result = mergeDocument(
      current,
      // The import happens in June; the local edit was made in August.
      doc({ events: [event('e1', { title: 'From 2035', updated_at: absurd })] }),
      { now: new Date(Date.parse(T2)) },
    );

    expect(result.timeline.events[0]?.title).toBe('Mine');
    expect(result.stats.events.skipped).toBe(1);
  });
});

describe('isWellFormedRecord', () => {
  it('answers per kind, since the load-bearing fields differ', () => {
    expect(isWellFormedRecord('events', event('e1'))).toBe(true);
    expect(isWellFormedRecord('connections', connection('c1'))).toBe(true);
    expect(isWellFormedRecord('tags', tag('t1'))).toBe(true);
    expect(isWellFormedRecord('eras', era('r1'))).toBe(true);
    // An event is not an era: it has no `name`.
    expect(isWellFormedRecord('eras', event('e1'))).toBe(false);
    expect(isWellFormedRecord('connections', event('e1'))).toBe(false);
  });

  it('rejects anything that is not an object', () => {
    for (const value of [null, undefined, 'e1', 42, [event('e1')]]) {
      expect(isWellFormedRecord('events', value)).toBe(false);
    }
  });

  it('lets unknown fields through — a newer app will write fields this one has never seen', () => {
    expect(isWellFormedRecord('events', { ...event('e1'), mood: 'ominous' })).toBe(true);
  });
});

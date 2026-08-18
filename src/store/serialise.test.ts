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
  mergeDocument,
  migrate,
  parseDocument,
  serialiseDocument,
  toDocument,
} from './serialise';
import { T1, T2, T3, connection, era, event, sampleTimeline, tag, timeline } from './fixtures';

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

  it('accepts a hand-written pack that omits empty collections', () => {
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
});

describe('mergeDocument', () => {
  it('adds records it has never seen, of every kind', () => {
    const result = mergeDocument(
      timeline(),
      doc({
        events: [event('e1')],
        connections: [connection('c1')],
        tags: [tag('t1')],
        eras: [era('r1')],
      }),
    );

    expect(result.timeline.events).toHaveLength(1);
    expect(result.timeline.connections).toHaveLength(1);
    expect(result.timeline.tags).toHaveLength(1);
    expect(result.timeline.eras).toHaveLength(1);
    expect(result.stats.events).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(result.stats.eras).toEqual({ added: 1, updated: 0, skipped: 0 });
  });

  it('lets the newer updated_at win when the incoming record is newer', () => {
    const current = timeline({ events: [event('e1', { title: 'Old', updated_at: T1 })] });
    const result = mergeDocument(current, doc({ events: [event('e1', { title: 'New', updated_at: T2 })] }));

    expect(result.timeline.events[0]?.title).toBe('New');
    expect(result.stats.events).toEqual({ added: 0, updated: 1, skipped: 0 });
  });

  it('lets the newer updated_at win when the local record is newer', () => {
    const current = timeline({ events: [event('e1', { title: 'Mine', updated_at: T3 })] });
    const result = mergeDocument(current, doc({ events: [event('e1', { title: 'Theirs', updated_at: T2 })] }));

    expect(result.timeline.events[0]?.title).toBe('Mine');
    expect(result.stats.events).toEqual({ added: 0, updated: 0, skipped: 1 });
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
    expect(result.stats.events).toEqual({ added: 0, updated: 1, skipped: 0 });
  });

  it('does not mutate the timeline it was given', () => {
    const current = timeline({ events: [event('e1', { title: 'Mine', updated_at: T1 })] });
    mergeDocument(current, doc({ events: [event('e1', { title: 'Theirs', updated_at: T3 })] }));

    expect(current.events[0]?.title).toBe('Mine');
  });

  it('copies accepted records, so the merged timeline does not alias the document', () => {
    const incoming = event('e1', { title: 'From the pack' });
    const result = mergeDocument(timeline(), doc({ events: [incoming] }));
    incoming.title = 'Mutated afterwards';

    expect(result.timeline.events[0]?.title).toBe('From the pack');
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

describe('mergeDocument — pack upgrades (§5)', () => {
  it('upgrades a pack record the user has not touched', () => {
    const current = timeline({
      events: [event('e1', { title: 'v1', pack: 'wwii', updated_at: T1, provenance: { kind: 'pack', ref: 'wwii' } })],
    });
    const result = mergeDocument(
      current,
      doc({
        events: [event('e1', { title: 'v2', pack: 'wwii', updated_at: T3, provenance: { kind: 'pack', ref: 'wwii' } })],
      }),
    );

    expect(result.timeline.events[0]?.title).toBe('v2');
    expect(result.stats.events.updated).toBe(1);
  });

  it('never clobbers a record the user adopted, even with a newer pack', () => {
    // Adoption clears `pack` and makes the record manual (§5). The pack's next
    // version is newer by definition, so the timestamp rule alone would lose it.
    const current = timeline({
      events: [event('e1', { title: 'My rewrite', updated_at: T1, provenance: { kind: 'manual' } })],
    });
    const result = mergeDocument(
      current,
      doc({ events: [event('e1', { title: 'Pack v2', pack: 'wwii', updated_at: T3 })] }),
    );

    expect(result.timeline.events[0]?.title).toBe('My rewrite');
    expect(result.timeline.events[0]?.pack).toBeUndefined();
    expect(result.stats.events).toEqual({ added: 0, updated: 0, skipped: 1 });
  });

  it('skips a pack record edited more recently than the incoming version', () => {
    const current = timeline({
      events: [event('e1', { title: 'Edited in place', pack: 'wwii', updated_at: T3 })],
    });
    const result = mergeDocument(
      current,
      doc({ events: [event('e1', { title: 'Pack v2', pack: 'wwii', updated_at: T2 })] }),
    );

    expect(result.timeline.events[0]?.title).toBe('Edited in place');
  });

  it('still installs the pack records that are genuinely new in the upgrade', () => {
    const current = timeline({
      events: [event('e1', { title: 'My rewrite', updated_at: T1 })],
    });
    const result = mergeDocument(
      current,
      doc({
        events: [
          event('e1', { title: 'Pack v2', pack: 'wwii', updated_at: T3 }),
          event('e2', { title: 'New in v2', pack: 'wwii', updated_at: T3 }),
        ],
      }),
    );

    expect(result.timeline.events.map((e) => e.title)).toEqual(['My rewrite', 'New in v2']);
    expect(result.stats.events).toEqual({ added: 1, updated: 0, skipped: 1 });
  });

  it('lets an import carry an adoption from another device onto a pack record', () => {
    // The reverse direction: nothing about `pack` blocks a genuinely newer edit.
    const current = timeline({ events: [event('e1', { pack: 'wwii', updated_at: T1 })] });
    const result = mergeDocument(
      current,
      doc({ events: [event('e1', { title: 'Adopted elsewhere', updated_at: T3 })] }),
    );

    expect(result.timeline.events[0]?.title).toBe('Adopted elsewhere');
    expect(result.timeline.events[0]?.pack).toBeUndefined();
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
    expect(result.stats.events).toEqual({ added: 1, updated: 0, skipped: 2 });
    expect(result.stats.tags).toEqual({ added: 0, updated: 0, skipped: 1 });
  });

  it('is idempotent — restoring the same backup twice changes nothing', () => {
    const current = sampleTimeline();
    const backup = toDocument(current, { exportedAt: T2 });

    const once = mergeDocument(current, backup);
    const twice = mergeDocument(once.timeline, backup);

    expect(twice.timeline).toEqual(current);
    expect(twice.stats.events).toEqual({ added: 0, updated: 0, skipped: 2 });
  });
});

/**
 * The portability contract: documents in, documents out, and the one merge
 * function that import, backup restore and pack install all share.
 * See docs/design.md §8.1 (versioned JSON, migrations), §8.3 (merge by id) and
 * §5 (pack upgrades must not overwrite your work).
 *
 * Nothing here touches IndexedDB or the DOM. It is pure data, which is why the
 * merge rule — the part that can silently lose a decade of work — is testable
 * without a browser.
 */

import type { Timeline } from '../core/model/types';
import type { MergeResult, MergeStats, RecordKind, TimelineDocument } from './contract';
import { SCHEMA_VERSION } from './contract';

/** The four record kinds, in a stable order. */
export const RECORD_KINDS: readonly RecordKind[] = ['events', 'connections', 'tags', 'eras'];

/** Written into `generator` so a stale export can be traced to what wrote it. */
export const GENERATOR = 'arlinje/0.0.0';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The file is not a timeline document at all. */
export class DocumentFormatError extends Error {
  override readonly name = 'DocumentFormatError';
}

/**
 * The file declares a schema this build does not know. Thrown rather than
 * guessed at: a newer document opened by an older app is exactly the case where
 * quietly dropping the fields it does not recognise destroys data.
 */
export class SchemaVersionError extends Error {
  override readonly name = 'SchemaVersionError';
  readonly found: number;
  readonly supported: number;

  constructor(found: number, supported: number) {
    super(
      `This file was written by a newer version of the app (schema version ${found}; ` +
        `this one understands ${supported}). Update the app before importing it, ` +
        `so nothing is lost.`,
    );
    this.found = found;
    this.supported = supported;
  }
}

// ---------------------------------------------------------------------------
// Migrations (§8.1)
// ---------------------------------------------------------------------------

/** A pure upgrade step. Never mutates its argument. */
export type Migration = (doc: TimelineDocument) => TimelineDocument;

/**
 * Ordered, and never deleted — an export from two years ago has to open, or the
 * portability promise was a decoration (§8.1).
 *
 * `MIGRATIONS[i]` upgrades a document from schema version `i + 1` to `i + 2`,
 * so the array always has `SCHEMA_VERSION - 1` entries. Adding one is a single
 * line here plus the bump of `SCHEMA_VERSION` in `contract.ts`; `migrate` fails
 * loudly if the two ever disagree.
 */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Runs the chain from whatever version the document declares up to
 * `SCHEMA_VERSION`. A document already at the current version is returned
 * unchanged, by identity.
 */
export function migrate(doc: TimelineDocument): TimelineDocument {
  if (MIGRATIONS.length !== SCHEMA_VERSION - 1) {
    // A programming error, not a data error: someone bumped one without the other.
    throw new Error(
      `Migration chain is inconsistent: SCHEMA_VERSION is ${SCHEMA_VERSION} but ` +
        `${MIGRATIONS.length} migration(s) are registered.`,
    );
  }

  const from = doc.schema_version;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new DocumentFormatError(
      `This file does not declare a usable schema version (found ${JSON.stringify(from)}).`,
    );
  }
  if (from > SCHEMA_VERSION) throw new SchemaVersionError(from, SCHEMA_VERSION);

  let current = doc;
  for (let version = from; version < SCHEMA_VERSION; version++) {
    const step = MIGRATIONS[version - 1];
    if (!step) throw new Error(`No migration registered from schema version ${version}.`);
    current = step(current);
  }

  return current.schema_version === SCHEMA_VERSION
    ? current
    : { ...current, schema_version: SCHEMA_VERSION };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface ToDocumentOptions {
  /** ISO instant; injectable so tests and snapshots are deterministic. */
  exportedAt?: string;
  generator?: string;
}

/**
 * The in-memory timeline as a document. Arrays are copied, records are shared —
 * the result is meant to be serialised immediately, not held and mutated.
 */
export function toDocument(timeline: Timeline, options: ToDocumentOptions = {}): TimelineDocument {
  return {
    schema_version: SCHEMA_VERSION,
    exported_at: options.exportedAt ?? new Date().toISOString(),
    generator: options.generator ?? GENERATOR,
    events: timeline.events.slice(),
    connections: timeline.connections.slice(),
    tags: timeline.tags.slice(),
    eras: timeline.eras.slice(),
  };
}

/** A document as a timeline, migrated first (§8.1: migrations run on load and on import). */
export function fromDocument(doc: TimelineDocument): Timeline {
  const migrated = migrate(doc);
  return {
    events: asArray(migrated.events),
    connections: asArray(migrated.connections),
    tags: asArray(migrated.tags),
    eras: asArray(migrated.eras),
  };
}

/** Pretty-printed, because a backup folder full of unreadable JSON is a worse backup. */
export function serialiseDocument(doc: TimelineDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Parses and shape-checks a file's contents. Throws `DocumentFormatError` on rubbish. */
export function parseDocument(text: string): TimelineDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DocumentFormatError('This file is not valid JSON, so it cannot be imported.');
  }
  return asDocument(raw);
}

/**
 * Shape-checks an already-parsed value — the entry point for a pack bundle that
 * arrives as an object rather than a file (§5: pack install and import are one
 * code path).
 *
 * Deliberately lenient about the record arrays: a hand-written pack that omits
 * `connections` should install, not fail. It is strict about `schema_version`,
 * because that is the field which decides how everything else is interpreted.
 */
export function asDocument(raw: unknown): TimelineDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DocumentFormatError('This file does not look like a timeline export.');
  }
  const source = raw as Partial<TimelineDocument>;
  if (typeof source.schema_version !== 'number') {
    throw new DocumentFormatError(
      'This file does not declare a schema version, so it cannot be read safely.',
    );
  }

  const doc: TimelineDocument = {
    schema_version: source.schema_version,
    exported_at: typeof source.exported_at === 'string' ? source.exported_at : '',
    events: asArray(source.events),
    connections: asArray(source.connections),
    tags: asArray(source.tags),
    eras: asArray(source.eras),
  };
  if (typeof source.generator === 'string') doc.generator = source.generator;
  return doc;
}

// ---------------------------------------------------------------------------
// Merge (§8.3, §5)
// ---------------------------------------------------------------------------

/** The fields the merge rule reads. Every record kind has them (`Base`). */
interface MergeableRecord {
  id: string;
  updated_at: string;
  deleted_at?: string;
  pack?: string;
}

/**
 * Merges a document into the current timeline **by `id`; it never replaces**
 * (§8.3). Restoring a backup onto a store that has since diverged has to be
 * safe, or backups are a trap.
 *
 * Per record:
 *   - unknown id           → added
 *   - newer `updated_at`   → replaces the local one
 *   - older or equal       → skipped, so the local edit survives
 *   - locally adopted      → skipped, even if the incoming record is newer (§5)
 *
 * Tombstones need no special case and get none: a delete is a write with a
 * newer `updated_at`, so it propagates like any other change, and an old
 * document cannot resurrect a record deleted since (D9).
 *
 * Records present locally but absent from the document are left alone. An
 * incoming document is a claim about the records it contains, never about the
 * ones it omits.
 */
export function mergeDocument(current: Timeline, incoming: TimelineDocument): MergeResult {
  const doc = migrate(incoming);

  const events = mergeKind(current.events, asArray(doc.events));
  const connections = mergeKind(current.connections, asArray(doc.connections));
  const tags = mergeKind(current.tags, asArray(doc.tags));
  const eras = mergeKind(current.eras, asArray(doc.eras));

  return {
    timeline: {
      events: events.records,
      connections: connections.records,
      tags: tags.records,
      eras: eras.records,
    },
    stats: {
      events: events.stats,
      connections: connections.stats,
      tags: tags.stats,
      eras: eras.stats,
    },
  };
}

function mergeKind<T extends MergeableRecord>(
  current: readonly T[],
  incoming: readonly T[],
): { records: T[]; stats: MergeStats } {
  const records = current.slice();
  const index = new Map<string, number>();
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record) index.set(record.id, i);
  }

  const stats: MergeStats = { added: 0, updated: 0, skipped: 0 };

  for (const candidate of incoming) {
    if (!candidate || typeof candidate.id !== 'string') {
      stats.skipped++;
      continue;
    }

    const at = index.get(candidate.id);
    if (at === undefined) {
      index.set(candidate.id, records.length);
      records.push(clone(candidate));
      stats.added++;
      continue;
    }

    const mine = records[at];
    if (mine === undefined) {
      // Unreachable: the index only ever holds live positions.
      stats.skipped++;
      continue;
    }

    if (!accepts(mine, candidate)) {
      stats.skipped++;
      continue;
    }

    records[at] = clone(candidate);
    stats.updated++;
  }

  return { records, stats };
}

/** Whether `theirs` should overwrite `mine`. */
function accepts(mine: MergeableRecord, theirs: MergeableRecord): boolean {
  // §5 — a pack upgrade skips any record whose `pack` has been cleared. Adopting
  // a pack event (editing it, connecting it, or explicitly) clears `pack`, and
  // the next version of the pack carries a newer `updated_at` than the edit, so
  // without this clause every upgrade would quietly rewrite the user's work.
  if (theirs.pack !== undefined && mine.pack === undefined) return false;

  // §8.3 — newer `updated_at` wins. Ties keep what is already here: a merge
  // should never be able to change a record it has no new information about.
  return compareTimestamps(theirs.updated_at, mine.updated_at) > 0;
}

/**
 * Timestamps are ISO instants *with an offset* (local wall clock), so
 * `'2026-08-15T10:00+02:00'` and `'2026-08-15T08:00Z'` are the same moment and
 * sort differently as strings. Compare instants, and fall back to a string
 * comparison only when a value will not parse.
 */
export function compareTimestamps(a: string | undefined, b: string | undefined): number {
  const left = typeof a === 'string' ? a : '';
  const right = typeof b === 'string' ? b : '';
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    return leftMs === rightMs ? 0 : leftMs < rightMs ? -1 : 1;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asArray<T>(value: readonly T[] | undefined): T[] {
  return Array.isArray(value) ? value.slice() : [];
}

/**
 * Accepted records are copied, so a merged timeline never aliases the document
 * it came from — a pack object held in memory must not change when the user
 * edits the event it installed.
 */
function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

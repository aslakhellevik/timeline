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
import { isWellFormedSpec } from '../core/time';
import type { MergeResult, MergeStats, RecordKind, TimelineDocument } from './contract';
import { SCHEMA_VERSION } from './contract';

/** Every record kind, in a stable order. */
export const RECORD_KINDS: readonly RecordKind[] = [
  'events',
  'connections',
  'tags',
  'eras',
  'packs',
];

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
export const MIGRATIONS: readonly Migration[] = [
  // 1 → 2: packs became records of their own (§5). A document written before
  // them simply has none installed; nothing else about it changes.
  (doc) => ({ ...doc, packs: [] }),
];

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
    packs: timeline.packs.slice(),
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
    packs: asArray(migrated.packs),
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
    packs: asArray(source.packs),
  };
  if (typeof source.generator === 'string') doc.generator = source.generator;
  return doc;
}

// ---------------------------------------------------------------------------
// Record validation (§8.7)
// ---------------------------------------------------------------------------

/**
 * How far ahead of the importing machine a record may claim to have been
 * written. §8.7 records the hole this closes: `updated_at` is client wall-clock
 * time, so one device with a wrong clock stamps a record in 2035 and
 * last-write-wins never overwrites it again — the record is frozen for a decade
 * and nothing in the UI explains why.
 *
 * A day is wide enough for every honest cause (a timezone the file was written
 * in, a clock a few hours out) and narrow enough to catch the dishonest one.
 */
export const FUTURE_TOLERANCE_MS = 86_400_000;

/**
 * Whether the merge should look at a record at all.
 *
 * The merge rule is the one place hostile or hand-edited JSON reaches the
 * in-memory store, and the store is trusted by everything downstream: an event
 * with no `when` throws inside `compareEvents` the moment it is sorted, a
 * `tags: 'x'` throws in every filter, a string latitude puts a dot at NaN. None
 * of those are recoverable by the user, and all of them are one `typeof` away
 * from being caught here.
 *
 * The checks are per kind and deliberately shallow: they cover the fields the
 * app dereferences without asking, and let anything else through, because a
 * document from a future version of the app is expected to carry fields this
 * build has never heard of.
 */
export function isWellFormedRecord(kind: RecordKind, value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!hasBaseFields(value)) return false;

  switch (kind) {
    case 'events':
      return (
        typeof value.title === 'string' &&
        isWellFormedSpec(value.when as never) &&
        isIdList(value.tags) &&
        isPlace(value.place)
      );
    case 'connections':
      return (
        typeof value.from === 'string' &&
        typeof value.to === 'string' &&
        value.from.length > 0 &&
        value.to.length > 0 &&
        isIdList(value.tags)
      );
    case 'eras':
      return (
        typeof value.name === 'string' &&
        isWellFormedSpec(value.when as never) &&
        isIdList(value.tags)
      );
    case 'tags':
      return typeof value.name === 'string' && typeof value.kind === 'string';
    case 'packs':
      return (
        typeof value.name === 'string' &&
        typeof value.version === 'string' &&
        typeof value.installed_at === 'string'
      );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Base`, which every kind extends: an id and two timestamps, all strings. */
function hasBaseFields(record: Record<string, unknown>): boolean {
  if (typeof record.id !== 'string' || record.id.length === 0) return false;
  if (typeof record.created_at !== 'string') return false;
  if (typeof record.updated_at !== 'string') return false;
  if (record.deleted_at !== undefined && typeof record.deleted_at !== 'string') return false;
  return record.pack === undefined || typeof record.pack === 'string';
}

function isIdList(value: unknown): boolean {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

function isPlace(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  if (typeof value.name !== 'string') return false;
  return (['lat', 'lon', 'precision'] as const).every((key) => {
    const number = value[key];
    return number === undefined || (typeof number === 'number' && Number.isFinite(number));
  });
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

export interface MergeOptions {
  /** Injectable clock, so the future-timestamp guard is testable. */
  now?: Date;
}

/**
 * Merges a document into the current timeline **by `id`; it never replaces**
 * (§8.3). Restoring a backup onto a store that has since diverged has to be
 * safe, or backups are a trap.
 *
 * Per record:
 *   - malformed            → rejected, and counted (§8.7)
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
 *
 * Validation lives here rather than in `asDocument` because this is where a
 * record actually enters the timeline — every route in (file import, backup
 * restore, pack install) goes through this one function, and only this one has
 * somewhere to report what it threw away.
 */
export function mergeDocument(
  current: Timeline,
  incoming: TimelineDocument,
  options: MergeOptions = {},
): MergeResult {
  const doc = migrate(incoming);
  const now = options.now ?? new Date();

  const events = mergeKind(current.events, asArray(doc.events), 'events', now);

  // An arc has to terminate in something, so an incoming connection naming an
  // event neither this timeline nor the document has is dropped rather than
  // stored to dangle. Checked against the *merged* events, so a file may bring
  // a connection and both its endpoints at once.
  const known = new Set(events.records.map((event) => event.id));
  const connections = mergeKind(current.connections, asArray(doc.connections), 'connections', now, {
    accept: (record) => known.has(record.from) && known.has(record.to),
  });

  const tags = mergeKind(current.tags, asArray(doc.tags), 'tags', now);
  const eras = mergeKind(current.eras, asArray(doc.eras), 'eras', now);
  const packs = mergeKind(current.packs, asArray(doc.packs), 'packs', now);

  return {
    timeline: {
      events: events.records,
      connections: connections.records,
      tags: tags.records,
      eras: eras.records,
      packs: packs.records,
    },
    stats: {
      events: events.stats,
      connections: connections.stats,
      tags: tags.stats,
      eras: eras.stats,
      packs: packs.stats,
    },
  };
}

function mergeKind<T extends MergeableRecord>(
  current: readonly T[],
  incoming: readonly T[],
  kind: RecordKind,
  now: Date,
  options: { accept?: (record: T) => boolean } = {},
): { records: T[]; stats: MergeStats } {
  const records = current.slice();
  const index = new Map<string, number>();
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record) index.set(record.id, i);
  }

  const stats: MergeStats = { added: 0, updated: 0, skipped: 0, rejected: 0 };

  for (const raw of incoming) {
    if (!isWellFormedRecord(kind, raw) || options.accept?.(raw) === false) {
      stats.rejected++;
      continue;
    }
    const candidate = clampFuture(raw, now);

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

/**
 * Pulls an absurd future `updated_at` back to the moment of the import.
 *
 * **Clamped, not skipped**, and the difference matters: the record is the
 * user's data and is very likely fine — it is the *claim to have been written
 * tomorrow* that is not, and that claim is what would freeze the id against
 * every later edit (§8.7). Clamping keeps the content and costs the record only
 * its place at the front of the queue: it now merges by the ordinary rule, so a
 * newer local version wins and an unknown id is still added.
 *
 * `created_at` is left as it is. Nothing decides anything by it.
 */
function clampFuture<T extends MergeableRecord>(record: T, now: Date): T {
  const stamped = Date.parse(record.updated_at);
  if (!Number.isFinite(stamped) || stamped <= now.getTime() + FUTURE_TOLERANCE_MS) return record;
  return { ...record, updated_at: now.toISOString() };
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
 *
 * **The fallback compares as text, and that is kept on purpose.** A value that
 * will not parse has no instant to compare, and the alternatives are worse:
 * treating it as the epoch would let any parseable timestamp overwrite it, and
 * treating it as an error would make one unreadable field abort a whole import.
 * A byte comparison at least keeps the order *total and deterministic*, which
 * is what the merge needs to be repeatable — merging the same file twice must
 * reach the same timeline.
 *
 * The cost, stated plainly: `'zzz'` sorts above `'2026-…'`, so a record with an
 * unreadable timestamp can overwrite a real one. That is the same hole the
 * future-timestamp guard closes for readable values, and it is left open
 * because the two need different answers — a garbled string cannot be clamped
 * to anything. Nothing this app writes reaches it.
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

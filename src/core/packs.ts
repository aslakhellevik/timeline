/**
 * Packs (docs/design.md §5, D5) — canonical content, installed and uninstalled
 * cleanly.
 *
 * An empty timeline is the point of the project, so nothing canonical ships
 * pre-loaded. What ships instead is a set of bundles you can opt into, and the
 * semantic problem the design is careful about is worth restating: **if the
 * Second World War is pre-loaded, the density plot stops meaning "what I know".**
 * Every resolution here follows from that.
 *
 * Pure data, no store and no DOM. Install goes through `mergeDocument` because
 * §5 requires that pack install and file import be one code path — the merge
 * rule is the part that can silently destroy a decade of work, and there should
 * be exactly one of it.
 */

import type {
  Connection,
  Era,
  Id,
  InstalledPack,
  Tag,
  Timeline,
  TimelineEvent,
} from './model/types';
import { BUILTIN_TAGS } from './model/builtin-tags';
import { nowIso } from './model/ids';

/**
 * A bundle as authored.
 *
 * Records arrive without `pack`, `created_at` or `updated_at` — the installer
 * stamps all three, so a bundle stays readable and a pack author cannot
 * accidentally forge a timestamp newer than the user's own work.
 */
export interface PackBundle {
  id: Id;
  name: string;
  version: string;
  /**
   * Not optional. Wikipedia-derived content is CC BY-SA and that obligation
   * travels with the data; a pack with no stated licence is one nobody can
   * safely redistribute.
   */
  license: string;
  description?: string;
  events: PackEvent[];
  eras?: PackEra[];
  connections?: PackConnection[];
}

type Authored<T> = Omit<T, 'id' | 'created_at' | 'updated_at' | 'pack' | 'provenance'> & {
  /** Unique **within the pack**; namespaced against the pack id on install. */
  key: string;
};

export type PackEvent = Authored<TimelineEvent>;
export type PackEra = Authored<Era>;
export type PackConnection = Omit<Authored<Connection>, 'from' | 'to'> & {
  /** `key` of the endpoints, within this pack. */
  from: string;
  to: string;
};

/**
 * Record id for a pack's record.
 *
 * Derived from the pack id and the author's key rather than random, and that is
 * what makes an upgrade an upgrade: version two of a pack produces the same ids
 * as version one, so `mergeDocument` updates in place instead of installing a
 * duplicate copy of everything.
 */
export function packRecordId(packId: Id, key: string): Id {
  return `${packId}/${key}`;
}

/**
 * The stamp on the premade tags a pack carries with it.
 *
 * Those tags are *references*, not content: a pack that mentions Europe needs
 * Europe to exist, and has nothing whatever to say about what it is called or
 * what colour it is. Stamped `now` they were newer than the user's own rename,
 * and the merge rule dutifully undid it on every install — the pack quietly
 * winning an argument it was not having.
 *
 * The floor makes them **upsert-if-absent**: added when missing, and never
 * preferred over anything already there. The date is a claim about precedence,
 * not about when the tag was made.
 */
export const REFERENCE_STAMP = '1970-01-01T00:00:00.000Z';

export interface InstallOptions {
  now?: string;
  /** Where the bundle came from, for the record. */
  source?: string;
}

export interface PackDocument {
  events: TimelineEvent[];
  eras: Era[];
  connections: Connection[];
  /**
   * The premade tags this pack references, as records.
   *
   * Packs reference tags by id and never by name (D20), so a pack installed onto
   * a timeline that has never materialised the premade set would carry ids
   * pointing at nothing — filterable by neither the pack's events nor the
   * user's. They are emitted **without** `pack`, because they are shared: an
   * uninstall must not take away a tag the user's own events also carry — and
   * stamped `REFERENCE_STAMP`, so installing a pack never overwrites a tag the
   * user has renamed or recoloured.
   */
  tags: Tag[];
  pack: InstalledPack;
}

/**
 * Expands a bundle into records, ready to merge.
 *
 * Every record carries `pack: <id>`, which is the single mechanism the whole
 * feature rests on: it is what makes install reversible, what desaturates the
 * rendering, what the `mine / mine + packs` toggle reads, and what adoption
 * clears.
 */
export function expandPack(bundle: PackBundle, options: InstallOptions = {}): PackDocument {
  const now = options.now ?? nowIso();
  const stamp = { created_at: now, updated_at: now, pack: bundle.id };

  const events = bundle.events.map(({ key, ...rest }): TimelineEvent => ({
    ...rest,
    ...stamp,
    id: packRecordId(bundle.id, key),
    provenance: { kind: 'pack', ref: bundle.id },
  }));

  const eras = (bundle.eras ?? []).map(({ key, ...rest }): Era => ({
    ...rest,
    ...stamp,
    id: packRecordId(bundle.id, key),
  }));

  const known = new Set(events.map((event) => event.id));
  const connections = (bundle.connections ?? []).flatMap(({ key, from, to, ...rest }): Connection[] => {
    const fromId = packRecordId(bundle.id, from);
    const toId = packRecordId(bundle.id, to);
    // A bundle that references a key it does not define is a broken bundle, and
    // installing the edge anyway would leave an arc terminating in nothing.
    if (!known.has(fromId) || !known.has(toId)) return [];
    return [
      {
        ...rest,
        ...stamp,
        id: packRecordId(bundle.id, key),
        from: fromId,
        to: toId,
        provenance: { kind: 'pack', ref: bundle.id },
      },
    ];
  });

  // Ancestors count as referenced. A WWII event tagged German lands is meant to
  // answer a filter on Europe (D14 rollup), and on a timeline that has never
  // materialised the premade set, emitting the child without its parent leaves
  // Europe pointing at nothing — the two-Europes failure D20 exists to prevent.
  const parentOf = new Map(BUILTIN_TAGS.map((tag) => [tag.id, tag.parent]));
  const referenced = new Set<Id>();
  for (const record of [...events, ...eras, ...connections]) {
    for (const tag of record.tags) {
      let current: Id | undefined = tag;
      while (current !== undefined && !referenced.has(current)) {
        referenced.add(current);
        current = parentOf.get(current);
      }
    }
  }
  const tags = BUILTIN_TAGS.filter((tag) => referenced.has(tag.id)).map(
    (tag): Tag => ({ ...tag, created_at: REFERENCE_STAMP, updated_at: REFERENCE_STAMP }),
  );

  return {
    events,
    eras,
    connections,
    tags,
    pack: {
      id: bundle.id,
      created_at: now,
      updated_at: now,
      name: bundle.name,
      version: bundle.version,
      license: bundle.license,
      installed_at: now,
      ...(bundle.description !== undefined ? { description: bundle.description } : {}),
      ...(options.source !== undefined ? { source: options.source } : {}),
    },
  };
}

/** Whether a pack is currently installed. */
export function isInstalled(timeline: Timeline, packId: Id): boolean {
  return timeline.packs.some((pack) => pack.id === packId && !pack.deleted_at);
}

export function installedPack(timeline: Timeline, packId: Id): InstalledPack | undefined {
  return timeline.packs.find((pack) => pack.id === packId && !pack.deleted_at);
}

/** Records still owned by a pack — everything uninstall would take away. */
export function packRecords(
  timeline: Timeline,
  packId: Id,
): { events: TimelineEvent[]; eras: Era[]; connections: Connection[] } {
  return {
    events: timeline.events.filter((event) => event.pack === packId),
    eras: timeline.eras.filter((era) => era.pack === packId),
    connections: timeline.connections.filter((connection) => connection.pack === packId),
  };
}

/** What an uninstall would take away, counted so the confirmation can say it. */
export interface UninstallImpact {
  /** Pack-owned events. Adopted ones have cleared `pack` and are not counted. */
  events: number;
  eras: number;
  /** Connections the pack brought. These go for good. */
  packConnections: number;
  /**
   * The user's **own** connections into a departing event. Tombstoned, not
   * dropped — and counted separately, because these are the only records in the
   * operation that are the user's own writing.
   */
  ownConnections: number;
}

/** The ids of the records `uninstallPack` would take out of the timeline. */
function doomedIds(timeline: Timeline, packId: Id): Set<Id> {
  const ids = new Set<Id>();
  for (const event of timeline.events) if (event.pack === packId) ids.add(event.id);
  for (const era of timeline.eras) if (era.pack === packId) ids.add(era.id);
  return ids;
}

/**
 * Counts what an uninstall would remove, split by whose it is.
 *
 * The confirmation used to say only how many events would go, which is the
 * count that matters least: pack events come back with one click. What does not
 * come back is the note the user wrote on a connection *into* one of them, and
 * the old wording never mentioned those at all.
 */
export function uninstallImpact(timeline: Timeline, packId: Id): UninstallImpact {
  const doomed = doomedIds(timeline, packId);
  let packConnections = 0;
  let ownConnections = 0;
  for (const connection of timeline.connections) {
    if (connection.deleted_at) continue;
    if (connection.pack === packId) packConnections++;
    else if (doomed.has(connection.from) || doomed.has(connection.to)) ownConnections++;
  }

  return {
    events: timeline.events.filter((event) => event.pack === packId).length,
    eras: timeline.eras.filter((era) => era.pack === packId).length,
    packConnections,
    ownConnections,
  };
}

/**
 * Removes a pack and everything it still owns.
 *
 * **Hard removal, and deliberately so** — the one place D9's "never delete, sync
 * needs tombstones" does not apply. Pack content is not the user's data; it is
 * re-derivable from the bundle at any time. A tombstone would be worse than
 * useless here: it carries a newer `updated_at` than the bundle, so reinstalling
 * the pack later would merge into it and restore nothing.
 *
 * Anything adopted has had its `pack` cleared and is therefore untouched, which
 * is the whole point of adoption.
 *
 * **The user's own connections into a departing event are tombstoned, not
 * dropped.** They still have to leave the view — an arc into a hole is the
 * thing D37 is avoiding — but the argument in that note is the user's writing,
 * not the pack's, and every reason D37 gives for hard removal is a reason about
 * *pack* records: re-derivable from the bundle, and blocked by a tombstone on
 * reinstall. Neither is true of a connection somebody wrote themselves. A
 * tombstone leaves it recoverable, and reinstalling the pack does not resurrect
 * it — which is right, since a connection nobody has seen for a year should not
 * silently reappear.
 */
export function uninstallPack(timeline: Timeline, packId: Id, now: string = nowIso()): Timeline {
  const doomed = doomedIds(timeline, packId);

  return {
    events: timeline.events.filter((event) => event.pack !== packId),
    connections: timeline.connections.flatMap((connection): Connection[] => {
      // The pack's own, gone with the rest of its content.
      if (connection.pack === packId) return [];
      if (connection.deleted_at) return [connection];
      const dangling = doomed.has(connection.from) || doomed.has(connection.to);
      if (!dangling) return [connection];
      return [{ ...connection, deleted_at: now, updated_at: now }];
    }),
    // Tags are left alone. They are shared by id (D20), so a pack's tags are
    // almost always the built-in ones the user's own events also carry.
    tags: timeline.tags,
    eras: timeline.eras.filter((era) => era.pack !== packId),
    packs: timeline.packs.filter((pack) => pack.id !== packId),
  };
}

/**
 * Adopts a pack record as the user's own: `pack` cleared, provenance manual.
 *
 * Returns `null` when there is nothing to do, so callers can adopt
 * unconditionally before an edit without checking first.
 *
 * The rule that "editing or connecting a pack event adopts it" is what makes
 * §5's second upgrade clause unnecessary. The design asks a pack upgrade to skip
 * records "whose `pack` has been cleared, **or** whose `updated_at` is later
 * than the install it came from" — but if every edit clears `pack`, the second
 * condition can never be true without the first, and the merge rule needs no
 * install timestamps to be safe.
 */
export function adoptRecord<T extends { pack?: Id; provenance?: { kind: string; ref?: string } }>(
  record: T,
  now: string,
): T | null {
  if (record.pack === undefined) return null;
  const { pack: _dropped, ...rest } = record;
  return {
    ...(rest as T),
    updated_at: now,
    provenance: { kind: 'manual', ...(record.pack ? { ref: record.pack } : {}) },
  };
}

export interface PackSummary {
  bundle: PackBundle;
  installed: InstalledPack | undefined;
  /** A newer version is available than the one installed. */
  upgradable: boolean;
  events: number;
  eras: number;
  connections: number;
}

/**
 * Compares dotted version numbers: `-1`, `0` or `1`. Deliberately not semver in
 * full — pack versions are `1`, `1.2`, `1.2.3`, a missing part counts as zero,
 * and anything non-numeric falls back to comparing the strings, which at least
 * keeps the order total. Enough to tell an upgrade from a downgrade, which mere
 * inequality cannot: shipping an app with an older bundle than the one already
 * installed used to offer "upgrade" and then quietly walk the pack backwards.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = Number.parseInt(left[i] ?? '0', 10);
    const y = Number.parseInt(right[i] ?? '0', 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return a < b ? -1 : a > b ? 1 : 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** What the pack panel shows: the catalogue, annotated with what is installed. */
export function summarise(timeline: Timeline, catalogue: readonly PackBundle[]): PackSummary[] {
  return catalogue.map((bundle) => {
    const installed = installedPack(timeline, bundle.id);
    return {
      bundle,
      installed,
      upgradable: installed !== undefined && compareVersions(installed.version, bundle.version) < 0,
      events: bundle.events.length,
      eras: (bundle.eras ?? []).length,
      connections: (bundle.connections ?? []).length,
    };
  });
}

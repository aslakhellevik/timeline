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
   * uninstall must not take away a tag the user's own events also carry.
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
  const now = options.now ?? new Date().toISOString();
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

  const referenced = new Set<Id>();
  for (const record of [...events, ...eras, ...connections]) {
    for (const tag of record.tags) referenced.add(tag);
  }
  const tags = BUILTIN_TAGS.filter((tag) => referenced.has(tag.id)).map(
    (tag): Tag => ({ ...tag, created_at: now, updated_at: now }),
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
 */
export function uninstallPack(timeline: Timeline, packId: Id): Timeline {
  const doomed = new Set(
    [
      ...timeline.events.filter((event) => event.pack === packId),
      ...timeline.eras.filter((era) => era.pack === packId),
    ].map((record) => record.id),
  );

  return {
    events: timeline.events.filter((event) => event.pack !== packId),
    // Connections owned by the pack go, and so do the user's own connections to
    // an event that is leaving: the alternative is an arc into a hole.
    connections: timeline.connections.filter(
      (connection) =>
        connection.pack !== packId && !doomed.has(connection.from) && !doomed.has(connection.to),
    ),
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

/** What the pack panel shows: the catalogue, annotated with what is installed. */
export function summarise(timeline: Timeline, catalogue: readonly PackBundle[]): PackSummary[] {
  return catalogue.map((bundle) => {
    const installed = installedPack(timeline, bundle.id);
    return {
      bundle,
      installed,
      upgradable: installed !== undefined && installed.version !== bundle.version,
      events: bundle.events.length,
      eras: (bundle.eras ?? []).length,
      connections: (bundle.connections ?? []).length,
    };
  });
}

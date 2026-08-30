/**
 * The persistence contract (docs/design.md §8).
 *
 * The in-memory `Timeline` is canonical; this layer only durably records it and
 * hands it back on the next load. Nothing here decides anything about the data —
 * merge policy lives in `serialise.ts` because import, restore and pack install
 * are the same operation and must not drift apart.
 */

import type {
  Connection,
  Era,
  InstalledPack,
  Tag,
  Timeline,
  TimelineEvent,
} from '../core/model/types';

/** Bump when a released schema changes, and add a migration for it. */
export const SCHEMA_VERSION = 2;

export type RecordKind = 'events' | 'connections' | 'tags' | 'eras' | 'packs';

export interface TimelineDocument {
  schema_version: number;
  exported_at: string;
  /** Free-form; the app name and version that wrote the file. */
  generator?: string;
  events: TimelineEvent[];
  connections: Connection[];
  tags: Tag[];
  eras: Era[];
  /** Which packs are installed (§5). Travels with an export, like everything else. */
  packs: InstalledPack[];
}

/** A change originating in another tab, delivered so this one can catch up. */
export interface StoreChange {
  kind: RecordKind;
  ids: string[];
}

export interface Store {
  load(): Promise<Timeline>;

  /**
   * Upserts records of one kind. Soft-deleted records are written like any
   * other — tombstones are data (D9), and removing them here would resurrect
   * the record on the next load.
   */
  put(kind: RecordKind, records: readonly { id: string }[]): Promise<void>;

  /** Replaces everything. Used by restore and by the first-run seed. */
  replaceAll(timeline: Timeline): Promise<void>;

  /**
   * Notifies of writes made by other tabs in this browser. Two tabs both hold
   * in-memory state and would otherwise silently overwrite each other (§8.1).
   */
  subscribe(listener: (change: StoreChange) => void): () => void;

  close(): void;
}

export interface MergeStats {
  added: number;
  updated: number;
  /** Left alone: the local copy was the same age or newer, or had been adopted. */
  skipped: number;
  /**
   * Thrown away as unreadable — a malformed record, or a connection to an event
   * nothing has (§8.7). Distinct from `skipped`, which is the merge rule working
   * as designed; this is data that could not be let in at all, and the panel
   * says so rather than reporting a clean import.
   */
  rejected: number;
}

export interface MergeResult {
  timeline: Timeline;
  stats: Record<RecordKind, MergeStats>;
}

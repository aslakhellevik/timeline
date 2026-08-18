/**
 * The persistence contract (docs/design.md §8).
 *
 * The in-memory `Timeline` is canonical; this layer only durably records it and
 * hands it back on the next load. Nothing here decides anything about the data —
 * merge policy lives in `serialise.ts` because import, restore and pack install
 * are the same operation and must not drift apart.
 */

import type { Connection, Era, Tag, Timeline, TimelineEvent } from '../core/model/types';

/** Bump when a released schema changes, and add a migration for it. */
export const SCHEMA_VERSION = 1;

export type RecordKind = 'events' | 'connections' | 'tags' | 'eras';

export interface TimelineDocument {
  schema_version: number;
  exported_at: string;
  /** Free-form; the app name and version that wrote the file. */
  generator?: string;
  events: TimelineEvent[];
  connections: Connection[];
  tags: Tag[];
  eras: Era[];
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
  skipped: number;
}

export interface MergeResult {
  timeline: Timeline;
  stats: Record<RecordKind, MergeStats>;
}

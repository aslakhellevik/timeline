/**
 * The shared data model. See docs/design.md §2.2 (time) and §4 (entities).
 *
 * This file is the contract every other module builds against. It is pure types
 * plus the small amount of vocabulary that goes with them — no logic, no imports.
 */

/**
 * UUIDv7 for user-created records; fixed namespaced strings for built-ins (D20).
 * A record is built-in iff its id is not a UUID — see `isBuiltinId`.
 */
export type Id = string;

// ---------------------------------------------------------------------------
// Time (D1, D2)
// ---------------------------------------------------------------------------

/**
 * Numeric time: fractional days from 1970-01-01T00:00, proleptic Gregorian,
 * astronomical year numbering (year 0 = 1 BC). Float64. Never a JS `Date`.
 */
export type Days = number;

export type TimeMode = 'instant' | 'interval' | 'fuzzy';
export type Calendar = 'gregorian' | 'julian';
export type Granularity = 'day' | 'month' | 'year' | 'decade' | 'century';

/**
 * One storage shape for every temporal claim: a trapezoidal fuzzy interval,
 * `a <= b <= c <= d`, in `Days`.
 *
 *   instant   a=b=c=d, widened by granularity
 *   interval  a=b, c=d
 *   fuzzy     unconstrained trapezoid
 *
 * There is no undated state: maximal uncertainty is a very wide interval.
 */
export interface TimeSpec {
  mode: TimeMode;
  calendar: Calendar;
  granularity: Granularity;
  /** earliest possible start */
  a: Days;
  /** likely start */
  b: Days;
  /** likely end */
  c: Days;
  /** latest possible end */
  d: Days;
  /** 1σ uncertainty, in days, used by the density estimator (§3.2) */
  sigma: number;
  /** Authored string, kept only when it says more than (a,b,c,d) can express. */
  text?: string;
}

// ---------------------------------------------------------------------------
// Entities (§4)
// ---------------------------------------------------------------------------

export interface Base {
  id: Id;
  /** ISO instant with offset, local wall clock */
  created_at: string;
  updated_at: string;
  /** Soft delete — records are never removed, sync needs tombstones (D9) */
  deleted_at?: string;
}

export type ProvenanceKind = 'manual' | 'pack' | 'import' | 'ai_extract';

export interface Provenance {
  kind: ProvenanceKind;
  /** origin id, pack id, or source document */
  ref?: string;
  confidence?: number;
}

export interface Place {
  name: string;
  lat?: number;
  lon?: number;
  /** radius in km within which the location is accurate */
  precision?: number;
}

export type SourceKind = 'book' | 'article' | 'url' | 'conversation' | 'other';

export interface Source {
  kind: SourceKind;
  ref: string;
  /** page, chapter, timestamp */
  locator?: string;
}

export interface TimelineEvent extends Base {
  title: string;
  when: TimeSpec;
  /** Markdown */
  notes?: string;
  tags: Id[];
  place?: Place;
  sources?: Source[];
  /** D10 — when you encountered it. ISO instant with offset. */
  learned_at?: string;
  /** D10 — free text: "Gombrich, ch. 4", "conversation with M" */
  learned_from?: string;
  provenance: Provenance;
  /** set iff this record came from an installed pack and has not been adopted */
  pack?: Id;
}

export interface Connection extends Base {
  /** Ordered pair, though v1 treats connections as undirected (D6). */
  from: Id;
  to: Id;
  /** Markdown — the argument for why these two belong together. */
  note: string;
  tags: Id[];
  /** Reserved for a later taxonomy; unset in v1. */
  kind?: string;
  provenance: Provenance;
  pack?: Id;
}

export type TagKind = 'region' | 'theme' | 'user';

export interface Tag extends Base {
  name: string;
  kind: TagKind;
  /** Europe > Norway, for rollup filtering (D14) */
  parent?: Id;
  color?: string;
  pack?: Id;
}

export type EraKind = 'canonical' | 'personal';

export interface Era extends Base {
  name: string;
  when: TimeSpec;
  kind: EraKind;
  tags: Id[];
  notes?: string;
  pack?: Id;
}

/**
 * A pack the user has installed (§5).
 *
 * Kept as a record rather than derived from the `pack` field on events, for two
 * reasons: a pack whose every event has been adopted would otherwise vanish from
 * the list of what is installed, and the name, version and licence have to
 * survive somewhere. The licence in particular is not optional — Wikipedia-
 * derived content is CC BY-SA and that obligation travels with the data.
 */
export interface InstalledPack extends Base {
  /** Stable pack id, e.g. `pack.second-world-war`. */
  name: string;
  version: string;
  license: string;
  description?: string;
  /** Where the bundle came from: a built-in id, or a URL/filename. */
  source?: string;
  installed_at: string;
}

/** The whole store, held in memory (§8.1). */
export interface Timeline {
  events: TimelineEvent[];
  connections: Connection[];
  tags: Tag[];
  eras: Era[];
  packs: InstalledPack[];
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Half-open window on the time axis, in Days. */
export interface Viewport {
  /** left edge */
  start: Days;
  /** right edge */
  end: Days;
  /** device-independent pixel width the window is drawn into */
  width: number;
}

/** The single filter predicate every view consumes (§3.5, D22). */
export interface Filter {
  /** Tag ids; empty means no tag filtering. An event passes if it carries any. */
  tags: Id[];
  /** Whether pack-sourced records contribute (D5). */
  includePacks: boolean;
  /** Free-text search, matched by the search module. */
  query?: string;
}

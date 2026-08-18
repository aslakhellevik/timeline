/**
 * The one filter predicate every view consumes (docs/design.md §3.5, D22).
 *
 * Canvas, list and — in v2 — the map all read this. Keeping it single means a
 * connection can never render as an arc terminating in an event the list has
 * hidden, and it means "what is currently showing" has exactly one definition.
 */

import type { Connection, Era, Filter, Id, Tag, Timeline, TimelineEvent } from './model/types';

/**
 * Tag id → itself and all its ancestors. Filtering by Europe must match an event
 * tagged only Norway, so rollup is resolved once here rather than walked per
 * event per frame.
 *
 * Cycles are possible in principle (nothing stops a user making A the parent of
 * B and B the parent of A), so the walk is bounded by the tag count.
 */
export function buildAncestry(tags: readonly Tag[]): Map<Id, Id[]> {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const ancestry = new Map<Id, Id[]>();

  for (const tag of tags) {
    const chain: Id[] = [];
    const seen = new Set<Id>();
    let current: Tag | undefined = tag;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current.id);
      current = current.parent ? byId.get(current.parent) : undefined;
    }
    ancestry.set(tag.id, chain);
  }

  return ancestry;
}

export interface Predicates {
  event: (event: TimelineEvent) => boolean;
  connection: (connection: Connection) => boolean;
  era: (era: Era) => boolean;
}

export function makePredicates(timeline: Timeline, filter: Filter): Predicates {
  const ancestry = buildAncestry(timeline.tags);
  const wanted = new Set(filter.tags);
  const filtering = wanted.size > 0;

  const carriesWantedTag = (tags: readonly Id[]): boolean => {
    for (const tag of tags) {
      for (const id of ancestry.get(tag) ?? [tag]) {
        if (wanted.has(id)) return true;
      }
    }
    return false;
  };

  const event = (candidate: TimelineEvent): boolean => {
    if (candidate.deleted_at) return false;
    if (candidate.pack && !filter.includePacks) return false;
    if (filtering && !carriesWantedTag(candidate.tags)) return false;
    return true;
  };

  const passing = new Set<Id>();
  for (const candidate of timeline.events) if (event(candidate)) passing.add(candidate.id);

  return {
    event,

    /**
     * Both endpoints must pass. A connection's own tags narrow further; they
     * never admit one whose endpoints are hidden, because an arc terminating in
     * nothing reads as a rendering bug rather than as a filter.
     */
    connection: (candidate: Connection): boolean => {
      if (candidate.deleted_at) return false;
      if (candidate.pack && !filter.includePacks) return false;
      if (!passing.has(candidate.from) || !passing.has(candidate.to)) return false;
      if (filtering && candidate.tags.length > 0 && !carriesWantedTag(candidate.tags)) return false;
      return true;
    },

    /**
     * Personal eras always show. Your own life is the frame of reference the
     * timeline is read against — an event is not just in 1847, it is during your
     * great-grandmother's childhood — and that frame should not disappear
     * because you filtered to art history.
     */
    era: (candidate: Era): boolean => {
      if (candidate.deleted_at) return false;
      if (candidate.kind === 'personal') return true;
      if (candidate.pack && !filter.includePacks) return false;
      if (filtering && !carriesWantedTag(candidate.tags)) return false;
      return true;
    },
  };
}

/** The filtered view, for consumers that want a `Timeline` rather than predicates. */
export function applyFilter(timeline: Timeline, filter: Filter): Timeline {
  const predicates = makePredicates(timeline, filter);
  return {
    events: timeline.events.filter(predicates.event),
    connections: timeline.connections.filter(predicates.connection),
    tags: timeline.tags.filter((tag) => !tag.deleted_at),
    eras: timeline.eras.filter(predicates.era),
  };
}

export const NO_FILTER: Filter = { tags: [], includePacks: true };

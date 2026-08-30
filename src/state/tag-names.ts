import type { Tag } from '../core/model/types';
import { useTimeline } from './timeline-store';

/**
 * Tag ids to names — the lookup every list of events needs.
 *
 * Cached against the tag array rather than memoised per component. Three
 * components built the same `Map` from the same array (the list, the picker and
 * the event pane), so a `useMemo` in each of them meant three copies whose only
 * shared property was going stale at different moments. A `WeakMap` keyed on the
 * array is the same invalidation rule — the store replaces the array whenever a
 * tag changes — held in one place, and it lets the map outlive a component that
 * unmounts and comes back.
 */
const byArray = new WeakMap<readonly Tag[], ReadonlyMap<string, string>>();

export function tagNamesOf(tags: readonly Tag[]): ReadonlyMap<string, string> {
  const cached = byArray.get(tags);
  if (cached) return cached;
  const names = new Map(tags.map((tag) => [tag.id, tag.name]));
  byArray.set(tags, names);
  return names;
}

/** The same map, as a store selector. */
export function useTagNames(): ReadonlyMap<string, string> {
  return tagNamesOf(useTimeline((state) => state.timeline.tags));
}

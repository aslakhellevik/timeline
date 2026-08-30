import { describe, expect, it } from 'vitest';
import type { Tag } from '../core/model/types';
import { tagNamesOf } from './tag-names';

const tag = (id: string, name: string): Tag => ({
  id,
  name,
  kind: 'user',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('tagNamesOf', () => {
  it('maps ids to names', () => {
    const tags = [tag('a', 'war'), tag('b', 'science')];
    expect(tagNamesOf(tags).get('a')).toBe('war');
    expect(tagNamesOf(tags).get('b')).toBe('science');
    expect(tagNamesOf(tags).get('c')).toBeUndefined();
  });

  it('returns the same map for the same array', () => {
    // The point of the cache: three components asked for this map, and the
    // search path uses it as a memo key — a fresh `Map` on every render would
    // invalidate that key on every render.
    const tags = [tag('a', 'war')];
    expect(tagNamesOf(tags)).toBe(tagNamesOf(tags));
  });

  it('rebuilds when the array is replaced', () => {
    // Which is exactly when a tag can have changed: the store never mutates an
    // array in place.
    const before = tagNamesOf([tag('a', 'war')]);
    const after = tagNamesOf([tag('a', 'warfare')]);
    expect(after).not.toBe(before);
    expect(after.get('a')).toBe('warfare');
  });
});

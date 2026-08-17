import { describe, expect, it } from 'vitest';
import { isBuiltinId, nowIso, uuidv7 } from './ids';
import { BUILTIN_TAGS, tagAncestry } from './builtin-tags';

describe('uuidv7', () => {
  it('has the right shape, version and variant', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sorts lexicographically by creation time', () => {
    const early = uuidv7(1_000_000_000_000);
    const late = uuidv7(1_700_000_000_000);
    expect(early < late).toBe(true);
  });

  it('encodes the timestamp in the leading 48 bits', () => {
    const ts = 0x0123456789ab;
    const id = uuidv7(ts);
    expect(id.slice(0, 8) + id.slice(9, 13)).toBe('0123456789ab');
  });

  it('does not collide', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(uuidv7());
    expect(seen.size).toBe(10_000);
  });
});

describe('isBuiltinId', () => {
  it('treats UUIDs as user records and namespaced strings as built-ins', () => {
    expect(isBuiltinId(uuidv7())).toBe(false);
    expect(isBuiltinId('tag.region.europe')).toBe(true);
    expect(isBuiltinId('ev-0001')).toBe(true);
  });
});

describe('builtin tags', () => {
  it('has unique ids, all namespaced', () => {
    const ids = BUILTIN_TAGS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isBuiltinId(id)).toBe(true);
  });

  it('has resolvable parents', () => {
    const ids = new Set(BUILTIN_TAGS.map((t) => t.id));
    for (const tag of BUILTIN_TAGS) {
      if (tag.parent) expect(ids.has(tag.parent)).toBe(true);
    }
  });

  it('rolls a nested region up to its ancestors', () => {
    expect(tagAncestry('tag.region.norway')).toEqual([
      'tag.region.norway',
      'tag.region.nordics',
      'tag.region.europe',
    ]);
  });

  it('returns an unknown tag unchanged', () => {
    expect(tagAncestry('tag.user.whatever')).toEqual(['tag.user.whatever']);
  });
});

describe('nowIso', () => {
  it('formats an ISO instant with an offset', () => {
    expect(nowIso(new Date(2026, 7, 15, 9, 5, 3, 7))).toMatch(
      /^2026-08-15T09:05:03\.007[+-]\d{2}:\d{2}$/,
    );
  });
});

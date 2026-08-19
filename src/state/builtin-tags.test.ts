import { describe, expect, it } from 'vitest';
import { BUILTIN_TAGS } from '../core/model/builtin-tags';
import { instant } from '../core/time';
import { EMPTY_TIMELINE, createEvent, ensureTags, installBuiltinTags } from './timeline-model';

const T1 = '2026-01-01T00:00:00+01:00';

describe('installBuiltinTags', () => {
  it('materialises the premade set with its fixed ids (D20)', () => {
    const { timeline, touched } = installBuiltinTags(EMPTY_TIMELINE, T1);
    expect(timeline.tags).toHaveLength(BUILTIN_TAGS.length);
    expect(timeline.tags.map((tag) => tag.id)).toContain('tag.theme.war');
    expect(touched[0]?.kind).toBe('tags');
  });

  it('is idempotent, so it is safe on every install', () => {
    const once = installBuiltinTags(EMPTY_TIMELINE, T1).timeline;
    const twice = installBuiltinTags(once, T1);
    expect(twice.timeline.tags).toHaveLength(BUILTIN_TAGS.length);
    expect(twice.touched).toHaveLength(0);
    expect(twice.timeline).toBe(once);
  });

  it('offers no undo — undoing setup would orphan every id referencing it', () => {
    expect(installBuiltinTags(EMPTY_TIMELINE, T1).undo).toHaveLength(0);
  });

  /**
   * The bug this exists to prevent. `ensureTags` matches by name, so on a
   * timeline where the premade set was never materialised, typing `#war` invents
   * a private tag beside the one every pack event carries — and the vocabulary
   * silently forks in two, which fixed namespaced ids were meant to stop.
   */
  it('makes a typed #war attach to the built-in tag rather than inventing one', () => {
    const seeded = installBuiltinTags(EMPTY_TIMELINE, T1).timeline;
    const resolved = ensureTags(seeded, ['war'], T1);

    expect(resolved.ids).toEqual(['tag.theme.war']);
    expect(resolved.touched).toHaveLength(0);
  });

  it('without it, the same input forks the vocabulary', () => {
    // The failing case, pinned so the fix cannot be quietly removed.
    const resolved = ensureTags(EMPTY_TIMELINE, ['war'], T1);
    expect(resolved.ids[0]).not.toBe('tag.theme.war');
    expect(resolved.touched).toHaveLength(1);
  });

  it('leaves a user tag of the same name alone once it exists', () => {
    let timeline = installBuiltinTags(EMPTY_TIMELINE, T1).timeline;
    timeline = createEvent(timeline, { title: 'x', when: instant(1900) }, T1).timeline;
    const again = installBuiltinTags(timeline, T1);
    expect(again.timeline.tags).toHaveLength(BUILTIN_TAGS.length);
  });
});

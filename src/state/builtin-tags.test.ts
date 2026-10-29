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

  it('materialises the premade tag on demand rather than forking the vocabulary', () => {
    // Even without the first-run install, a typed name that means a premade tag
    // now lands on its fixed id — the record is created there (D44).
    const resolved = ensureTags(EMPTY_TIMELINE, ['war'], T1);
    expect(resolved.ids).toEqual(['tag.theme.war']);
    expect(resolved.touched).toHaveLength(1);
    expect(resolved.timeline.tags[0]?.id).toBe('tag.theme.war');
    expect(resolved.timeline.tags[0]?.kind).toBe('theme');
  });

  it('leaves a user tag of the same name alone once it exists', () => {
    let timeline = installBuiltinTags(EMPTY_TIMELINE, T1).timeline;
    timeline = createEvent(timeline, { title: 'x', when: instant(1900) }, T1).timeline;
    const again = installBuiltinTags(timeline, T1);
    expect(again.timeline.tags).toHaveLength(BUILTIN_TAGS.length);
  });
});

/**
 * D44. A `#tag` is one word, so eight of the twenty premade regions could not be
 * typed at all: `#britain` invented a private tag beside "Britain and Ireland",
 * and the event never showed under that region's filter.
 */
describe('tag aliases and normalisation (D44)', () => {
  const seeded = installBuiltinTags(EMPTY_TIMELINE, T1).timeline;
  const resolve = (name: string) => ensureTags(seeded, [name], T1);

  it('resolves the spellings a multi-word region is actually typed as', () => {
    expect(resolve('britain').ids).toEqual(['tag.region.britain']);
    expect(resolve('nordics').ids).toEqual(['tag.region.nordics']);
    expect(resolve('mediterranean').ids).toEqual(['tag.region.mediterranean']);
    expect(resolve('near-east').ids).toEqual(['tag.region.near-east']);
    expect(resolve('north-america').ids).toEqual(['tag.region.north-america']);
    for (const name of ['britain', 'nordics', 'north-america']) {
      expect(resolve(name).touched, name).toHaveLength(0);
    }
  });

  it('still resolves the ones that always worked', () => {
    expect(resolve('europe').ids).toEqual(['tag.region.europe']);
    expect(resolve('Europe').ids).toEqual(['tag.region.europe']);
    expect(resolve('war').ids).toEqual(['tag.theme.war']);
  });

  it('still invents a tag for a name that means nothing premade', () => {
    const resolved = resolve('foo');
    expect(resolved.ids[0]).not.toMatch(/^tag\./);
    expect(resolved.touched).toHaveLength(1);
    expect(resolved.timeline.tags.at(-1)?.name).toBe('foo');
  });

  it('matches the user’s own tags the same way, so #reading-list finds one', () => {
    const withUserTag = ensureTags(seeded, ['Reading List'], T1);
    const again = ensureTags(withUserTag.timeline, ['reading-list'], T1);
    expect(again.ids).toEqual(withUserTag.ids);
    expect(again.touched).toHaveLength(0);
    // And the name keeps the spelling it was created with.
    expect(again.timeline.tags.at(-1)?.name).toBe('Reading List');
  });

  it('does not merge two premade tags into one', () => {
    const all = ensureTags(seeded, BUILTIN_TAGS.map((tag) => tag.name), T1);
    expect(all.ids).toEqual(BUILTIN_TAGS.map((tag) => tag.id));
    expect(all.touched).toHaveLength(0);
  });
});

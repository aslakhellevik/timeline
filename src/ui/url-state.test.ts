import { describe, expect, it } from 'vitest';
import { decodeUrlState, encodeUrlState } from './url-state';
import type { UrlState } from './url-state';

describe('url state', () => {
  it('round-trips a full state', () => {
    const state: UrlState = {
      centre: 123456.789,
      span: 36524.25,
      selectedId: '0195f1a2-3b4c-7d5e-8f90-123456789abc',
      tags: ['tag.theme.art', 'tag.region.europe'],
      view: 'list',
    };
    expect(decodeUrlState(encodeUrlState(state))).toEqual(state);
  });

  it('omits defaults so a plain view has a clean URL', () => {
    expect(encodeUrlState({})).toBe('');
    expect(encodeUrlState({ view: 'timeline' })).toBe('');
  });

  it('survives an empty or malformed hash', () => {
    expect(decodeUrlState('')).toEqual({});
    expect(decodeUrlState('#')).toEqual({});
    expect(decodeUrlState('#c=nonsense&s=also')).toEqual({});
    expect(decodeUrlState('#garbage')).toEqual({});
  });

  it('opens a link to a removed view on the timeline', () => {
    expect(decodeUrlState('#v=depth&e=ev-0100')).toEqual({ selectedId: 'ev-0100' });
  });

  it('rejects a span that would invert or collapse the viewport', () => {
    expect(decodeUrlState('#c=0&s=-100').span).toBeUndefined();
    expect(decodeUrlState('#c=0&s=0').span).toBeUndefined();
    expect(decodeUrlState('#c=0&s=10').span).toBe(10);
  });

  it('keeps BC centres, which are negative', () => {
    expect(decodeUrlState(encodeUrlState({ centre: -900000 })).centre).toBe(-900000);
  });

  it('drops empty tag entries', () => {
    expect(decodeUrlState('#tags=,,').tags).toBeUndefined();
    expect(decodeUrlState('#tags=a,,b').tags).toEqual(['a', 'b']);
  });

  it('rounds to a sensible precision rather than emitting float noise', () => {
    expect(encodeUrlState({ centre: 1 / 3 })).toBe('#c=0.333');
  });
});

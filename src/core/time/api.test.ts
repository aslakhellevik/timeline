/**
 * The public surface, imported the way every other module imports it. If this
 * file stops compiling or passing, something downstream has already broken.
 */
import { describe, expect, it } from 'vitest';
import type { ParseResult } from './index';
import {
  compareTime,
  extractTime,
  formatTime,
  fromGregorian,
  fuzzy,
  instant,
  interval,
  midpoint,
  parseTime,
  toGregorian,
} from './index';

describe('public API', () => {
  it('exports every function the rest of the app builds against', () => {
    for (const fn of [
      fromGregorian,
      toGregorian,
      instant,
      interval,
      fuzzy,
      parseTime,
      extractTime,
      formatTime,
      compareTime,
      midpoint,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('takes an event from typed text to a placed, formatted, sortable spec', () => {
    const result: ParseResult = extractTime('battle of lepanto 1571');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [start, end] = result.consumed;
    const title = ('battle of lepanto 1571'.slice(0, start) + '1571'.slice(4)).trim();
    expect(title).toBe('battle of lepanto');

    const spec = result.value;
    expect(formatTime(spec)).toBe('1571');
    expect(toGregorian(midpoint(spec)).year).toBe(1571);
    expect(compareTime(spec, instant(1969))).toBe(-1);
    expect(spec.sigma).toBeGreaterThan(0);
  });

  it('round trips a hand-built spec through the axis', () => {
    const spec = interval(fromGregorian(1914), fromGregorian(1919), { granularity: 'year' });
    expect(toGregorian(spec.a)).toEqual({ year: 1914, month: 1, day: 1 });
    expect(toGregorian(spec.d)).toEqual({ year: 1919, month: 1, day: 1 });
    expect(fuzzy(spec.d, spec.a, spec.a, spec.d).mode).toBe('fuzzy');
  });
});

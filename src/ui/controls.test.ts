import { describe, expect, it } from 'vitest';
import { plural } from './controls';

/**
 * The footer used to read "0 events · 1 eras".
 *
 * Small, and exactly the kind of thing that survives for a year in a UI that is
 * otherwise careful, because every site does its own `n === 1 ? '' : 's'` and
 * one of them forgets.
 */
describe('plural', () => {
  it('agrees with the number', () => {
    expect(plural(0, 'event')).toBe('0 events');
    expect(plural(1, 'event')).toBe('1 event');
    expect(plural(2, 'era')).toBe('2 eras');
  });

  it('takes an irregular plural when the noun has one', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('groups thousands, since these are read at a glance', () => {
    expect(plural(50000, 'event')).toBe('50,000 events');
  });

  it('does not treat a negative as singular', () => {
    expect(plural(-1, 'event')).toBe('-1 events');
  });
});

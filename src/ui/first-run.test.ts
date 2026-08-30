import { describe, expect, it } from 'vitest';
import { birthYearError } from './FirstRun';

/**
 * The one question the app asks, and what it says when it will not take the
 * answer (§9, D26).
 */
describe('birthYearError', () => {
  const thisYear = 2026;

  it('says nothing about an empty box', () => {
    // Not yet answered is not the same as wrong, and a form that scolds you for
    // not having typed anything is a form nobody finishes.
    expect(birthYearError('', thisYear)).toBeNull();
    expect(birthYearError('   ', thisYear)).toBeNull();
  });

  it('accepts a plausible year', () => {
    expect(birthYearError('1994', thisYear)).toBeNull();
    expect(birthYearError(String(thisYear), thisYear)).toBeNull();
  });

  it('accepts the earliest year it names', () => {
    // The bound used to be exclusive, so 1850 was refused by a form whose only
    // signal was a disabled button.
    expect(birthYearError('1850', thisYear)).toBeNull();
  });

  it('gives a reason for a year that is too early', () => {
    expect(birthYearError('1849', thisYear)).toBe('1850 at the earliest');
    expect(birthYearError('700', thisYear)).toBe('1850 at the earliest');
  });

  it('gives a reason for a year in the future', () => {
    expect(birthYearError('2030', thisYear)).toBe('2026 at the latest — this is a birth year');
  });

  it('rejects anything that is not a whole year', () => {
    expect(birthYearError('nineteen', thisYear)).toBe('a four-digit year, like 1994');
    expect(birthYearError('19.5', thisYear)).toBe('a four-digit year, like 1994');
  });
});

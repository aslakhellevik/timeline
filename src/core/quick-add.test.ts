/**
 * The quick-add grammar (design.md §9). Capture friction is the project's top
 * product risk, so this is tested the way the box is actually typed into:
 * fast, in any order, with punctuation left wherever it fell.
 */

import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quick-add';
import type { QuickAddDraft } from './quick-add';
import { formatTime, midpoint, toGregorian } from './time';

/** Asserts a date was found and reports the year at its centre of mass. */
function yearOf(draft: QuickAddDraft): number {
  expect(draft.when).not.toBeNull();
  if (draft.when === null) throw new Error('no date parsed');
  return toGregorian(midpoint(draft.when)).year;
}

describe('parseQuickAdd', () => {
  it('reads the design document\'s own example', () => {
    const draft = parseQuickAdd('battle of lepanto 1571 #europe #war');
    expect(draft.title).toBe('battle of lepanto');
    expect(draft.tagNames).toEqual(['europe', 'war']);
    expect(draft.when?.mode).toBe('instant');
    expect(draft.when?.granularity).toBe('year');
    expect(yearOf(draft)).toBe(1571);
  });

  describe('the date, from anywhere in the line', () => {
    it('takes a trailing date', () => {
      const draft = parseQuickAdd('battle of lepanto 1571');
      expect(draft.title).toBe('battle of lepanto');
      expect(yearOf(draft)).toBe(1571);
    });

    it('takes a leading date', () => {
      const draft = parseQuickAdd('1571 battle of lepanto');
      expect(draft.title).toBe('battle of lepanto');
      expect(yearOf(draft)).toBe(1571);
    });

    it('takes a date from the middle of a sentence, and does not repair the grammar', () => {
      const draft = parseQuickAdd('in 1571 the fleet met at lepanto');
      expect(draft.title).toBe('in the fleet met at lepanto');
      expect(yearOf(draft)).toBe(1571);
    });

    it('keeps a full date together and formats back to what was typed', () => {
      const draft = parseQuickAdd('1969-07-20 the moon landing');
      expect(draft.title).toBe('the moon landing');
      expect(draft.when?.granularity).toBe('day');
      expect(draft.when === null ? '' : formatTime(draft.when)).toBe('20 July 1969');
    });

    it('keeps a range together rather than reading its first year', () => {
      const draft = parseQuickAdd('the great war 1914-1918');
      expect(draft.title).toBe('the great war');
      expect(draft.when?.mode).toBe('interval');
      if (draft.when === null) throw new Error('no date parsed');
      expect(toGregorian(draft.when.a).year).toBe(1914);
      expect(toGregorian(draft.when.d).year).toBe(1919); // end exclusive
    });

    it('keeps a hedged date together', () => {
      const draft = parseQuickAdd('c. 1200 BC the fall of Ur-Sabath');
      expect(draft.title).toBe('the fall of Ur-Sabath');
      expect(draft.when?.mode).toBe('fuzzy');
      expect(yearOf(draft)).toBe(-1199); // astronomical numbering: 1200 BC
    });

    it('keeps a disputed date together', () => {
      const draft = parseQuickAdd('the battle of Karmesh 1187 or 1189');
      expect(draft.title).toBe('the battle of Karmesh');
      expect(draft.when?.mode).toBe('fuzzy');
      expect(draft.when?.text).toBe('1187 or 1189');
    });

    it('reads a decade', () => {
      const draft = parseQuickAdd('1180s harvest failures');
      expect(draft.title).toBe('harvest failures');
      expect(draft.when?.granularity).toBe('decade');
    });

    it('lets the date pattern keep the article in front of a decade', () => {
      // "the 1180s" is one date token in the time library, so the article goes
      // with it. Documented rather than worked around: the parser owns dates.
      expect(parseQuickAdd('the 1180s were dry').title).toBe('were dry');
    });

    it('leaves a number that is not clearly a date in the title', () => {
      const draft = parseQuickAdd('chapter 12 notes on Rome');
      expect(draft.when).toBeNull();
      expect(draft.title).toBe('chapter 12 notes on Rome');
    });

    it('reports no date rather than guessing', () => {
      const draft = parseQuickAdd('the treaty of Tarnogol');
      expect(draft.when).toBeNull();
      expect(draft.title).toBe('the treaty of Tarnogol');
      expect(draft.tagNames).toEqual([]);
    });
  });

  describe('two numbers, one of which is the title', () => {
    // The rule: the longest match wins, and the rightmost of equally long
    // candidates. You type what happened and then when it happened, so the
    // trailing year is the date and the one inside the phrase is not.
    it('dates the 1848 revolutions to the trailing year', () => {
      const draft = parseQuickAdd('the 1848 revolutions in Hungary 1849');
      expect(draft.title).toBe('the 1848 revolutions in Hungary');
      expect(yearOf(draft)).toBe(1849);
    });

    it('still prefers the longer candidate over the later one', () => {
      const draft = parseQuickAdd('the 1848 revolutions in Hungary 1848-1849');
      expect(draft.title).toBe('the 1848 revolutions in Hungary');
      expect(draft.when?.mode).toBe('interval');
    });

    it('prefers a longer earlier candidate to a shorter later one', () => {
      const draft = parseQuickAdd('20 July 1969 and then 1972');
      expect(draft.title).toBe('and then 1972');
      expect(draft.when?.granularity).toBe('day');
    });
  });

  describe('tags', () => {
    it('takes several tags and keeps them in the order typed', () => {
      expect(parseQuickAdd('x 1500 #war #europe #ideas').tagNames).toEqual([
        'war',
        'europe',
        'ideas',
      ]);
    });

    it('keeps the case as typed', () => {
      expect(parseQuickAdd('x 1500 #Europe').tagNames).toEqual(['Europe']);
    });

    it('drops a repeated tag, keeping the first spelling', () => {
      expect(parseQuickAdd('x 1500 #war #WAR').tagNames).toEqual(['war']);
    });

    it('accepts an internal hyphen as one word', () => {
      const draft = parseQuickAdd('the Berlin airlift 1948 #cold-war');
      expect(draft.tagNames).toEqual(['cold-war']);
      expect(draft.title).toBe('the Berlin airlift');
    });

    it('does not support multi-word tags', () => {
      const draft = parseQuickAdd('the potato blight #irish famine 1845');
      expect(draft.tagNames).toEqual(['irish']);
      expect(draft.title).toBe('the potato blight famine');
    });

    it('strips a tag adjacent to punctuation and clears up after it', () => {
      const draft = parseQuickAdd('the fall of Rome 476 (#rome, #war).');
      expect(draft.tagNames).toEqual(['rome', 'war']);
      expect(draft.title).toBe('the fall of Rome');
      expect(yearOf(draft)).toBe(476);
    });

    it('does not read a # inside a word as a tag', () => {
      const draft = parseQuickAdd('C# is released 2000');
      expect(draft.tagNames).toEqual([]);
      expect(draft.title).toBe('C# is released');
      expect(yearOf(draft)).toBe(2000);
    });

    it('does not read a bare # as a tag', () => {
      const draft = parseQuickAdd('a # b 1500');
      expect(draft.tagNames).toEqual([]);
      expect(draft.title).toBe('a # b');
    });

    it('reads a tagged number as a tag, not as the date', () => {
      const draft = parseQuickAdd('#1848 revolutions');
      expect(draft.tagNames).toEqual(['1848']);
      expect(draft.when).toBeNull();
      expect(draft.title).toBe('revolutions');
    });
  });

  describe('the title', () => {
    it('collapses whitespace and trims', () => {
      expect(parseQuickAdd('   the   treaty   of Tarnogol   1571  ').title).toBe(
        'the treaty of Tarnogol',
      );
    });

    it('does not capitalise — the corpus convention is lower-case openers', () => {
      expect(parseQuickAdd('the treaty of Tarnogol 1571').title).toBe('the treaty of Tarnogol');
    });

    it('removes a comma orphaned by the date', () => {
      expect(parseQuickAdd('moon landing, 20 July 1969').title).toBe('moon landing');
    });

    it('removes brackets left empty by the date', () => {
      expect(parseQuickAdd('the treaty of Tarnogol (1571)').title).toBe('the treaty of Tarnogol');
    });

    it('closes the gap when the date came out of the middle of a list', () => {
      expect(parseQuickAdd('the fall of X, 1453, and its aftermath').title).toBe(
        'the fall of X, and its aftermath',
      );
    });

    it('keeps punctuation that is doing work', () => {
      const draft = parseQuickAdd('who really wrote the Halikarnian Chronicle?');
      expect(draft.title).toBe('who really wrote the Halikarnian Chronicle?');
    });

    it('is empty for empty, blank and date-only input', () => {
      for (const input of ['', '   ', '1571', '  1571  ', '#war 1571']) {
        expect(parseQuickAdd(input).title).toBe('');
      }
      expect(parseQuickAdd('#war 1571').tagNames).toEqual(['war']);
      expect(parseQuickAdd('1571').when).not.toBeNull();
      expect(parseQuickAdd('').when).toBeNull();
    });
  });

  describe('order independence', () => {
    const permutations = [
      'battle of lepanto 1571 #war',
      'battle of lepanto #war 1571',
      '1571 battle of lepanto #war',
      '1571 #war battle of lepanto',
      '#war 1571 battle of lepanto',
      '#war battle of lepanto 1571',
      'battle #war of lepanto 1571',
      'battle of #war lepanto 1571',
    ];

    it('recovers the same draft however the line is arranged', () => {
      for (const input of permutations) {
        const draft = parseQuickAdd(input);
        expect(draft.title, input).toBe('battle of lepanto');
        expect(draft.tagNames, input).toEqual(['war']);
        expect(yearOf(draft)).toBe(1571);
      }
    });
  });

  it('never throws, whatever is half-typed into the box', () => {
    const inputs = [
      '#',
      '##',
      '###war',
      '#war',
      'c.',
      '~',
      '?',
      '-',
      '1571-',
      '- 1571 -',
      '()',
      '(1571)',
      '1969-13-45',
      'the 1st century BC to the 3rd century AD',
      '#war #war #war',
      '.'.repeat(200),
      '9'.repeat(50),
    ];
    for (const input of inputs) {
      const draft = parseQuickAdd(input);
      expect(typeof draft.title, input).toBe('string');
      expect(Array.isArray(draft.tagNames), input).toBe(true);
    }
  });
});

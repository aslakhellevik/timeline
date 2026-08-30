import { describe, expect, it } from 'vitest';
import type { TimeSpec } from '../model/types';
import { fromGregorian } from './calendar';
import { extractTime, parseTime } from './parse';

const EN_DASH = '–';

/** Parse or fail the test — keeps the table-driven cases below readable. */
function parsed(input: string): TimeSpec {
  const result = parseTime(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.reason}`);
  expect(result.value.a).toBeLessThanOrEqual(result.value.b);
  expect(result.value.b).toBeLessThanOrEqual(result.value.c);
  expect(result.value.c).toBeLessThanOrEqual(result.value.d);
  expect(result.value.sigma).toBeGreaterThan(0);
  return result.value;
}

/** The four numbers as [a, b, c, d], for comparing against `fromGregorian` calls. */
function bounds(spec: TimeSpec): [number, number, number, number] {
  return [spec.a, spec.b, spec.c, spec.d];
}

describe('exact dates', () => {
  it('reads a full ISO date as a day-granularity instant', () => {
    const spec = parsed('1969-07-20');
    expect(spec.mode).toBe('instant');
    expect(spec.granularity).toBe('day');
    expect(bounds(spec)).toEqual([
      fromGregorian(1969, 7, 20),
      fromGregorian(1969, 7, 20),
      fromGregorian(1969, 7, 21),
      fromGregorian(1969, 7, 21),
    ]);
    expect(spec.text).toBeUndefined();
  });

  it('reads a year and month', () => {
    const spec = parsed('1969-07');
    expect(spec.mode).toBe('instant');
    expect(spec.granularity).toBe('month');
    expect(spec.a).toBe(fromGregorian(1969, 7, 1));
    expect(spec.d).toBe(fromGregorian(1969, 8, 1));
  });

  it('reads a bare year', () => {
    const spec = parsed('1969');
    expect(spec.mode).toBe('instant');
    expect(spec.granularity).toBe('year');
    expect(spec.a).toBe(fromGregorian(1969, 1, 1));
    expect(spec.d).toBe(fromGregorian(1970, 1, 1));
  });

  it('accepts single-digit months and days', () => {
    expect(bounds(parsed('1969-7-2'))).toEqual(bounds(parsed('1969-07-02')));
  });

  it('always produces Gregorian specs, since there is no syntax for Julian', () => {
    expect(parsed('1493-03-04').calendar).toBe('gregorian');
  });
});

describe('BC, BCE and signed years', () => {
  it('reads BC, BCE and f.Kr. as the same year', () => {
    const bc = parsed('250 BC');
    expect(bc.a).toBe(fromGregorian(-249, 1, 1));
    expect(bounds(parsed('250 BCE'))).toEqual(bounds(bc));
    expect(bounds(parsed('250 f.Kr.'))).toEqual(bounds(bc));
    expect(bounds(parsed('250 bc'))).toEqual(bounds(bc));
    expect(bounds(parsed('250 B.C.'))).toEqual(bounds(bc));
  });

  it('treats a signed year as astronomical, so -0250 is 251 BC', () => {
    const signed = parsed('-0250');
    expect(signed.a).toBe(fromGregorian(-250, 1, 1));
    // Deliberately NOT the same as "250 BC": ISO 8601 numbering has no year gap.
    expect(signed.a).not.toBe(parsed('250 BC').a);
    expect(parsed('-0249').a).toBe(parsed('250 BC').a);
  });

  it('reads AD both before and after the year', () => {
    expect(bounds(parsed('AD 1969'))).toEqual(bounds(parsed('1969')));
    expect(bounds(parsed('1969 AD'))).toEqual(bounds(parsed('1969')));
    expect(bounds(parsed('14 CE'))).toEqual(bounds(parsed('AD 14')));
  });

  it('rejects a signed year that also carries an era', () => {
    expect(parseTime('-250 BC').ok).toBe(false);
  });

  it('handles the year 0 boundary in both directions', () => {
    expect(parsed('1 BC').a).toBe(fromGregorian(0, 1, 1));
    expect(parsed('2 BC').a).toBe(fromGregorian(-1, 1, 1));
    expect(parsed('AD 1').a).toBe(fromGregorian(1, 1, 1));
    expect(parsed('0000').a).toBe(fromGregorian(0, 1, 1));
    expect(parsed('1 BC').d).toBe(parsed('AD 1').a);
  });
});

describe('hedged dates become fuzzy', () => {
  const hedges = ['c. 1200', 'ca 1200', 'ca. 1200', 'circa 1200', '~1200', '1200?', 'about 1200'];

  it.each(hedges)('reads %s as a fuzzy year around 1200', (input) => {
    const spec = parsed(input);
    expect(spec.mode).toBe('fuzzy');
    expect(spec.granularity).toBe('year');
    expect(spec.b).toBe(fromGregorian(1200, 1, 1));
    expect(spec.c).toBe(fromGregorian(1201, 1, 1));
    expect(spec.a).toBeLessThan(spec.b);
    expect(spec.d).toBeGreaterThan(spec.c);
  });

  it('keeps the phrasing, because a hedge is a different claim (§2.2)', () => {
    expect(parsed('c. 1200 BC').text).toBe('c. 1200 BC');
    expect(parsed('1200?').text).toBe('1200?');
    // A plain date says nothing the numbers do not.
    expect(parsed('1200').text).toBeUndefined();
  });

  it('hedges a BC year', () => {
    const spec = parsed('c. 1200 BC');
    expect(spec.b).toBe(fromGregorian(-1199, 1, 1));
    expect(spec.c).toBe(fromGregorian(-1198, 1, 1));
  });

  it('hedges an exact date only slightly', () => {
    const spec = parsed('c. 1969-07-20');
    expect(spec.mode).toBe('fuzzy');
    expect(spec.granularity).toBe('day');
    expect(spec.b - spec.a).toBeLessThan(10);
    expect(spec.b - spec.a).toBeGreaterThan(0);
  });

  it('is vaguer than the same date unhedged', () => {
    expect(parsed('c. 1200').sigma).toBeGreaterThan(parsed('1200').sigma);
    expect(parsed('c. 1969-07-20').sigma).toBeGreaterThan(parsed('1969-07-20').sigma);
  });
});

describe('ranges become intervals', () => {
  const separators = ['1914-1918', '1914/1918', '1914 to 1918', `1914${EN_DASH}1918`, '1914 - 1918'];

  it.each(separators)('reads %s as 1914 to the end of 1918', (input) => {
    const spec = parsed(input);
    expect(spec.mode).toBe('interval');
    expect(spec.granularity).toBe('year');
    expect(spec.a).toBe(fromGregorian(1914, 1, 1));
    expect(spec.d).toBe(fromGregorian(1919, 1, 1));
    expect(spec.a).toBe(spec.b);
    expect(spec.c).toBe(spec.d);
  });

  it('resolves 1914-1918 against 1969-07-20 by field count and magnitude', () => {
    // Two 4-digit fields cannot be a month, so it is a range...
    expect(parsed('1914-1918').mode).toBe('interval');
    // ...while a trailing 1-2 digit field within 1..12 is a month.
    expect(parsed('1969-07').mode).toBe('instant');
    expect(parsed('1969-07').granularity).toBe('month');
    // ...and three fields are always a date.
    expect(parsed('1969-07-20').granularity).toBe('day');
  });

  it('completes an abbreviated end year', () => {
    expect(bounds(parsed('1914-18'))).toEqual(bounds(parsed('1914-1918')));
    expect(bounds(parsed('1939-45'))).toEqual(bounds(parsed('1939-1945')));
  });

  it('applies an era given once to both ends', () => {
    const spec = parsed('250-200 BC');
    expect(spec.a).toBe(fromGregorian(-249, 1, 1));
    expect(spec.d).toBe(fromGregorian(-198, 1, 1));
    expect(bounds(parsed('250 BC - 200 BC'))).toEqual(bounds(spec));
  });

  it('orders a reversed range rather than rejecting it', () => {
    expect(bounds(parsed('1918 to 1914'))).toEqual(bounds(parsed('1914 to 1918')));
  });

  it('ranges over full dates when the separator cannot be an ISO hyphen', () => {
    const spec = parsed('1939-09-01 to 1945-09-02');
    expect(spec.mode).toBe('interval');
    expect(spec.granularity).toBe('day');
    expect(spec.a).toBe(fromGregorian(1939, 9, 1));
    expect(spec.d).toBe(fromGregorian(1945, 9, 3));
  });

  it('takes the coarser granularity of the two ends', () => {
    expect(parsed('1969-07 to 1970-03').granularity).toBe('month');
    expect(parsed('1969-07-20 to 1970').granularity).toBe('year');
  });

  it('hedges a range as a trapezoid', () => {
    const spec = parsed(`c. 1200${EN_DASH}1150 BC`);
    expect(spec.mode).toBe('fuzzy');
    expect(spec.b).toBe(fromGregorian(-1199, 1, 1));
    expect(spec.c).toBe(fromGregorian(-1148, 1, 1));
    expect(spec.a).toBeLessThan(spec.b);
    expect(spec.d).toBeGreaterThan(spec.c);
    expect(spec.text).toBe(`c. 1200${EN_DASH}1150 BC`);
  });
});

describe('centuries', () => {
  it('counts ordinally: the 12th century is 1101-1200', () => {
    const spec = parsed('12th century');
    expect(spec.mode).toBe('fuzzy');
    expect(spec.granularity).toBe('century');
    expect(bounds(spec)).toEqual([
      fromGregorian(1101, 1, 1),
      fromGregorian(1101, 1, 1),
      fromGregorian(1201, 1, 1),
      fromGregorian(1201, 1, 1),
    ]);
  });

  it('reads a BC century as 300-201 BC', () => {
    const spec = parsed('3rd century BC');
    expect(spec.a).toBe(fromGregorian(-299, 1, 1));
    expect(spec.d).toBe(fromGregorian(-199, 1, 1));
    expect(bounds(parsed('3rd century BCE'))).toEqual(bounds(spec));
  });

  it('narrows the plateau for early, mid and late', () => {
    const whole = parsed('3rd century BC');
    const early = parsed('early 3rd century BC');
    const mid = parsed('mid 3rd century BC');
    const late = parsed('late 3rd century BC');

    for (const part of [early, mid, late]) {
      expect(part.mode).toBe('fuzzy');
      expect(part.sigma).toBeLessThan(whole.sigma);
      expect(part.a).toBeGreaterThanOrEqual(whole.a);
      expect(part.d).toBeLessThanOrEqual(whole.d);
      expect(part.b).toBeLessThan(part.c);
    }
    expect(early.b).toBeLessThan(mid.b);
    expect(mid.b).toBeLessThan(late.b);
    expect(early.c).toBeLessThan(late.c);
  });

  it('accepts the hyphenated form', () => {
    expect(bounds(parsed('mid-3rd century BC'))).toEqual(bounds(parsed('mid 3rd century BC')));
  });

  it('keeps the phrasing for a qualified century', () => {
    expect(parsed('mid-3rd century BC').text).toBe('mid-3rd century BC');
    expect(parsed('3rd century BC').text).toBeUndefined();
  });

  it('accepts any ordinal suffix and is case-insensitive', () => {
    expect(bounds(parsed('21ST CENTURY'))).toEqual(bounds(parsed('21st century')));
    expect(parsed('1st century').a).toBe(fromGregorian(1, 1, 1));
  });
});

describe('decades', () => {
  it('reads 1180s as the vague decade 1180-1189', () => {
    const spec = parsed('1180s');
    expect(spec.mode).toBe('fuzzy');
    expect(spec.granularity).toBe('decade');
    expect(spec.a).toBe(fromGregorian(1180, 1, 1));
    expect(spec.d).toBe(fromGregorian(1190, 1, 1));
  });

  it('reads a BC decade as 259-250 BC', () => {
    const spec = parsed('250s BC');
    expect(spec.a).toBe(fromGregorian(-258, 1, 1));
    expect(spec.d).toBe(fromGregorian(-248, 1, 1));
  });

  it('accepts an article and an apostrophe', () => {
    expect(bounds(parsed('the 1180s'))).toEqual(bounds(parsed('1180s')));
    expect(bounds(parsed("1180's"))).toEqual(bounds(parsed('1180s')));
  });

  it('rejects a decade that is not a multiple of ten', () => {
    expect(parseTime('1187s').ok).toBe(false);
  });

  it('is vaguer than a year and sharper than a century', () => {
    expect(parsed('1180s').sigma).toBeGreaterThan(parsed('1180').sigma);
    expect(parsed('1180s').sigma).toBeLessThan(parsed('12th century').sigma);
  });
});

describe('disputed dates', () => {
  it('spans both candidates as a single fuzzy claim', () => {
    const spec = parsed('1187 or 1189');
    expect(spec.mode).toBe('fuzzy');
    expect(spec.a).toBe(fromGregorian(1187, 1, 1));
    expect(spec.d).toBe(fromGregorian(1190, 1, 1));
  });

  it('keeps the phrasing, since a trapezoid cannot be bimodal', () => {
    expect(parsed('1187 or 1189').text).toBe('1187 or 1189');
  });

  it('is vaguer than either candidate alone', () => {
    expect(parsed('1187 or 1189').sigma).toBeGreaterThan(parsed('1187').sigma);
  });

  it('handles eras and the Norwegian form', () => {
    expect(bounds(parsed('44 or 43 BC'))).toEqual([
      fromGregorian(-43, 1, 1),
      fromGregorian(-43, 1, 1),
      fromGregorian(-41, 1, 1),
      fromGregorian(-41, 1, 1),
    ]);
    expect(bounds(parsed('1187 eller 1189'))).toEqual(bounds(parsed('1187 or 1189')));
  });
});

describe('written-out dates', () => {
  it('reads day-month-year', () => {
    const spec = parsed('20 July 1969');
    expect(spec.granularity).toBe('day');
    expect(spec.a).toBe(fromGregorian(1969, 7, 20));
  });

  it('reads month-day-year', () => {
    expect(bounds(parsed('July 20, 1969'))).toEqual(bounds(parsed('20 July 1969')));
    expect(bounds(parsed('July 20 1969'))).toEqual(bounds(parsed('20 July 1969')));
  });

  it('reads month and year alone as a month, not as a day', () => {
    const spec = parsed('July 1969');
    expect(spec.granularity).toBe('month');
    expect(spec.a).toBe(fromGregorian(1969, 7, 1));
  });

  it('accepts abbreviations, ordinals, full stops and mixed case', () => {
    expect(bounds(parsed('20 Jul 1969'))).toEqual(bounds(parsed('20 July 1969')));
    expect(bounds(parsed('20th July 1969'))).toEqual(bounds(parsed('20 July 1969')));
    expect(bounds(parsed('20 JULY 1969'))).toEqual(bounds(parsed('20 July 1969')));
    expect(bounds(parsed('Sept 1969'))).toEqual(bounds(parsed('1969-09')));
  });

  it('accepts Norwegian month names', () => {
    expect(bounds(parsed('20. juli 1969'))).toEqual(bounds(parsed('20 July 1969')));
    expect(bounds(parsed('mars 1969'))).toEqual(bounds(parsed('1969-03')));
  });

  it('reads a written-out BC date', () => {
    expect(parsed('15 March 44 BC').a).toBe(fromGregorian(-43, 3, 15));
  });
});

describe('rejection', () => {
  const bad = [
    '',
    '   ',
    'not a date',
    'lepanto',
    '1969-13-01',
    '1969-02-30',
    '1969-00-10',
    '1969-04-31',
    '0th century',
  ];

  it.each(bad)('refuses %j', (input) => {
    const result = parseTime(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('explains why, in the reason', () => {
    const result = parseTime('1969-13-01');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('13');
  });

  it('does not fall back to a wrong reading of an impossible date', () => {
    // "1969 to January 13" would be a confident wrong answer (§ SEP_LOOSE).
    expect(parseTime('1969-13-01').ok).toBe(false);
  });

  it('accepts surrounding whitespace', () => {
    const result = parseTime('   1969-07-20  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.consumed).toEqual([3, 13]);
  });
});

describe('consumed range', () => {
  it('covers the whole trimmed input when parsing', () => {
    const result = parseTime('20 July 1969');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.consumed).toEqual([0, 12]);
      expect('20 July 1969'.slice(...result.consumed)).toBe('20 July 1969');
    }
  });
});

describe('extractTime', () => {
  // The third column is the exact residue: whitespace left behind is the
  // caller's to tidy, so the test records it rather than hiding it.
  const cases: [string, string, string][] = [
    ['battle of lepanto 1571', '1571', 'battle of lepanto '],
    ['apollo 11 landed on 20 July 1969', '20 July 1969', 'apollo 11 landed on '],
    ['the first world war 1914-1918 ended', '1914-1918', 'the first world war  ended'],
    ['caesar died 44 BC in rome', '44 BC', 'caesar died  in rome'],
    ['built in the 12th century by monks', '12th century', 'built in the  by monks'],
    ['was it 1187 or 1189 exactly', '1187 or 1189', 'was it  exactly'],
    ['fall of rome c. 476', 'c. 476', 'fall of rome '],
  ];

  it.each(cases)('finds the date in %j', (input, date, rest) => {
    const result = extractTime(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [start, end] = result.consumed;
    expect(input.slice(start, end)).toBe(date);
    expect(input.slice(0, start) + input.slice(end)).toBe(rest);
  });

  it('prefers the longest date, so a range beats its first year', () => {
    const result = extractTime('the war 1914-1918 mattered');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mode).toBe('interval');
  });

  it('prefers the longest date, so a century beats its ordinal', () => {
    const result = extractTime('a 12th century church');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.granularity).toBe('century');
  });

  it('does not mistake small bare numbers for years', () => {
    expect(extractTime('chapter 12 of the book').ok).toBe(false);
    expect(extractTime('read pages 30 to 45').ok).toBe(false);
    expect(extractTime('apollo 11').ok).toBe(false);
  });

  it('does read a small number when an era or a hedge says it is a date', () => {
    expect(extractTime('caesar 44 BC').ok).toBe(true);
    expect(extractTime('caesar c. 44').ok).toBe(true);
  });

  it('does not turn prose into a date', () => {
    // Each of these came out of the parser as a confident wrong answer: the
    // decade of a man's age, an advertisement, and a war named after a duration.
    expect(extractTime('Gombrich in his 20s').ok).toBe(false);
    expect(extractTime('an ad 2 page spread').ok).toBe(false);
    expect(extractTime('the 100 years war').ok).toBe(false);
  });

  it('reads three bare digits at either end of the line, but not in the middle', () => {
    // A quick-add date is typed first or last; a number inside a phrase belongs
    // to the phrase. Tags and punctuation do not count as either end.
    for (const input of ['coronation of Otto 962', '962 coronation of Otto']) {
      const result = extractTime(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(input.slice(...result.consumed)).toBe('962');
    }
    expect(extractTime('coronation of Otto 962 #europe').ok).toBe(true);
    expect(extractTime('the coronation of Otto (962).').ok).toBe(true);
    expect(extractTime('Otto 962 was crowned').ok).toBe(false);
  });

  it('still reads a small number in the middle when an era marks it', () => {
    expect(extractTime('the 44 BC ides of March').ok).toBe(true);
    expect(extractTime('the 250s BC in Rome').ok).toBe(true);
    expect(extractTime('the 1180s in Rome').ok).toBe(true);
    expect(extractTime('the 12th century in Rome').ok).toBe(true);
  });

  it('takes the rightmost of equally long candidates when asked', () => {
    const input = 'the 1848 revolutions in Hungary 1849';
    const left = extractTime(input);
    const right = extractTime(input, { prefer: 'rightmost' });
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(input.slice(...left.consumed)).toBe('1848');
    expect(input.slice(...right.consumed)).toBe('1849');
  });

  it('does not match inside a longer number or word', () => {
    expect(extractTime('serial 12345678 shipped').ok).toBe(false);
    const result = extractTime('order A1969B');
    expect(result.ok).toBe(false);
  });

  it('finds nothing in a string with no date', () => {
    const result = extractTime('battle of lepanto');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no date');
  });

  it('is deterministic when a string holds several dates', () => {
    const input = 'from 1914 to 1918 and again 1939';
    const first = extractTime(input);
    const second = extractTime(input);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) expect(input.slice(...first.consumed)).toBe('1914 to 1918');
  });

  it('agrees with parseTime when the whole string is a date', () => {
    for (const input of ['1969-07-20', '250 BC', '1914-1918', '12th century', '1180s']) {
      const direct = parseTime(input);
      const found = extractTime(input);
      expect(direct.ok && found.ok).toBe(true);
      if (direct.ok && found.ok) {
        expect(found.value).toEqual(direct.value);
        expect(found.consumed).toEqual(direct.consumed);
      }
    }
  });
});

describe('adversarial input', () => {
  // Quick-add parses on every keystroke, so a backtracking blow-up would be felt
  // as a frozen input box. The budget is deliberately loose: a regression here
  // costs seconds, not milliseconds.
  const nasty = [
    `${'1-'.repeat(600)}1`,
    `${'1969-'.repeat(400)}07`,
    `${'c. '.repeat(300)}1200`,
    'a'.repeat(5000),
    'battle of lepanto 1571 and the war 1914-1918 plus mid-3rd century BC '.repeat(60),
  ];

  it.each(nasty.map((s, i) => [i, s] as const))('survives pathological input %i', (_i, input) => {
    const started = performance.now();
    expect(() => extractTime(input)).not.toThrow();
    expect(() => parseTime(input)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('never returns a malformed spec, whatever it is given', () => {
    for (const input of [...nasty, '1969-', '-', '~', 'c.', '0-0', '999999', '1e5']) {
      for (const result of [parseTime(input), extractTime(input)]) {
        if (!result.ok) continue;
        const { a, b, c, d, sigma } = result.value;
        expect(a).toBeLessThanOrEqual(b);
        expect(b).toBeLessThanOrEqual(c);
        expect(c).toBeLessThanOrEqual(d);
        expect(sigma).toBeGreaterThan(0);
        expect(Number.isFinite(sigma)).toBe(true);
      }
    }
  });
});

describe('inferred mode and granularity, end to end', () => {
  const table: [string, TimeSpec['mode'], TimeSpec['granularity']][] = [
    ['1969-07-20', 'instant', 'day'],
    ['1969-07', 'instant', 'month'],
    ['1969', 'instant', 'year'],
    ['-0250', 'instant', 'year'],
    ['250 BC', 'instant', 'year'],
    ['250 BCE', 'instant', 'year'],
    ['250 f.Kr.', 'instant', 'year'],
    ['c. 1200 BC', 'fuzzy', 'year'],
    ['ca 1200', 'fuzzy', 'year'],
    ['~1200', 'fuzzy', 'year'],
    ['1200?', 'fuzzy', 'year'],
    ['1914-1918', 'interval', 'year'],
    ['1914/1918', 'interval', 'year'],
    ['1914 to 1918', 'interval', 'year'],
    [`1914${EN_DASH}1918`, 'interval', 'year'],
    ['3rd century BC', 'fuzzy', 'century'],
    ['early 3rd century BC', 'fuzzy', 'century'],
    ['mid 3rd century BC', 'fuzzy', 'century'],
    ['late 3rd century BC', 'fuzzy', 'century'],
    ['12th century', 'fuzzy', 'century'],
    ['1180s', 'fuzzy', 'decade'],
    ['1187 or 1189', 'fuzzy', 'year'],
    ['20 July 1969', 'instant', 'day'],
    ['July 20, 1969', 'instant', 'day'],
  ];

  it.each(table)('%j is a %s at %s granularity', (input, mode, granularity) => {
    const spec = parsed(input);
    expect(spec.mode).toBe(mode);
    expect(spec.granularity).toBe(granularity);
  });

  it('orders the whole table by vagueness, as sigma', () => {
    const sigma = (input: string): number => parsed(input).sigma;
    expect(sigma('1969-07-20')).toBeLessThan(sigma('1969-07'));
    expect(sigma('1969-07')).toBeLessThan(sigma('1969'));
    expect(sigma('1969')).toBeLessThan(sigma('c. 1969'));
    expect(sigma('1969')).toBeLessThan(sigma('1960s'));
    expect(sigma('1960s')).toBeLessThan(sigma('20th century'));
    expect(sigma('early 3rd century BC')).toBeLessThan(sigma('3rd century BC'));
    expect(sigma('1187')).toBeLessThan(sigma('1187 or 1189'));
  });
});

import { describe, expect, it } from 'vitest';
import { fromGregorian } from './calendar';
import { formatTime } from './format';
import { parseTime } from './parse';
import { fuzzy, instant, interval } from './spec';

const EN_DASH = '–';

function format(input: string, opts?: { era?: 'bc' | 'bce' }): string {
  const result = parseTime(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse: ${result.reason}`);
  return formatTime(result.value, opts);
}

describe('instants', () => {
  it('formats a day as 20 July 1969 (D19)', () => {
    expect(formatTime(instant(1969, 7, 20))).toBe('20 July 1969');
  });

  it('formats a month and a year', () => {
    expect(formatTime(instant(1969, 7))).toBe('July 1969');
    expect(formatTime(instant(1969))).toBe('1969');
  });

  it('formats a decade and a century', () => {
    expect(formatTime(instant(1187, undefined, undefined, { granularity: 'decade' }))).toBe('1180s');
    expect(formatTime(instant(1187, undefined, undefined, { granularity: 'century' }))).toBe(
      '12th century',
    );
  });

  it('gets the ordinal suffix right', () => {
    const century = (year: number): string =>
      formatTime(instant(year, undefined, undefined, { granularity: 'century' }));
    expect(century(2026)).toBe('21st century');
    expect(century(1150)).toBe('12th century');
    expect(century(250)).toBe('3rd century');
    expect(century(150)).toBe('2nd century');
    expect(century(50)).toBe('1st century');
    expect(century(1050)).toBe('11th century');
    expect(century(1250)).toBe('13th century');
  });
});

describe('never shows year 0', () => {
  it('calls astronomical year 0 "1 BC" and -1 "2 BC"', () => {
    expect(formatTime(instant(0))).toBe('1 BC');
    expect(formatTime(instant(-1))).toBe('2 BC');
    expect(formatTime(instant(-249))).toBe('250 BC');
  });

  it('walks across the boundary without a gap or a zero', () => {
    const labels = [-2, -1, 0, 1, 2].map((year) => formatTime(instant(year)));
    expect(labels).toEqual(['3 BC', '2 BC', '1 BC', 'AD 1', 'AD 2']);
    expect(labels).not.toContain('0');
  });

  it('marks the era on days and months in antiquity too', () => {
    expect(formatTime(instant(0, 3, 15))).toBe('15 March 1 BC');
    expect(formatTime(instant(-43, 3, 15))).toBe('15 March 44 BC');
    expect(formatTime(instant(-43, 3))).toBe('March 44 BC');
  });

  it('spells out AD only where a bare number would be ambiguous', () => {
    expect(formatTime(instant(14))).toBe('AD 14');
    expect(formatTime(instant(999))).toBe('AD 999');
    expect(formatTime(instant(1000))).toBe('1000');
    expect(formatTime(instant(1969))).toBe('1969');
  });

  it('offers BCE/CE as an alternative style', () => {
    expect(formatTime(instant(-249), { era: 'bce' })).toBe('250 BCE');
    expect(formatTime(instant(14), { era: 'bce' })).toBe('14 CE');
    expect(formatTime(instant(-249), { era: 'bc' })).toBe('250 BC');
  });

  it('names BC decades and centuries', () => {
    expect(formatTime(instant(-249, undefined, undefined, { granularity: 'decade' }))).toBe(
      '250s BC',
    );
    expect(formatTime(instant(-249, undefined, undefined, { granularity: 'century' }))).toBe(
      '3rd century BC',
    );
    expect(
      formatTime(instant(-249, undefined, undefined, { granularity: 'century' }), { era: 'bce' }),
    ).toBe('3rd century BCE');
  });

  it('names the two decades either side of the epoch without straddling it', () => {
    // The 0s BC is 9 BC..1 BC and the AD 0s is AD 1..AD 9. A decade that claimed
    // both sides formatted a first-century year as "-8s BC".
    expect(formatTime(instant(0, undefined, undefined, { granularity: 'decade' }))).toBe('0s BC');
    expect(formatTime(instant(-8, undefined, undefined, { granularity: 'decade' }))).toBe('0s BC');
    expect(formatTime(instant(1, undefined, undefined, { granularity: 'decade' }))).toBe('0s');
    expect(formatTime(instant(9, undefined, undefined, { granularity: 'decade' }))).toBe('0s');
    expect(formatTime(instant(10, undefined, undefined, { granularity: 'decade' }))).toBe('10s');
    expect(format('0s')).toBe('0s');
    expect(format('0s BC')).toBe('0s BC');
  });
});

describe('intervals', () => {
  it('formats a year range with an en dash and an inclusive end', () => {
    const spec = interval(fromGregorian(1914), fromGregorian(1919), { granularity: 'year' });
    expect(formatTime(spec)).toBe(`1914${EN_DASH}1918`);
  });

  it('spaces the dash when either side is more than one word', () => {
    const spec = interval(fromGregorian(1939, 9, 1), fromGregorian(1945, 9, 3), {
      granularity: 'day',
    });
    expect(formatTime(spec)).toBe(`1 September 1939 ${EN_DASH} 2 September 1945`);
  });

  it('collapses to one label when both ends are the same period', () => {
    const spec = interval(fromGregorian(1969), fromGregorian(1970), { granularity: 'year' });
    expect(formatTime(spec)).toBe('1969');
  });

  it('formats a BC range', () => {
    const spec = interval(fromGregorian(-249), fromGregorian(-198), { granularity: 'year' });
    expect(formatTime(spec)).toBe(`250 BC ${EN_DASH} 200 BC`);
  });
});

describe('fuzzy claims', () => {
  it('marks a soft-shouldered claim with c.', () => {
    const year = instant(1200);
    const hedged = fuzzy(year.a - 1826, year.a, year.d, year.d + 1826, { granularity: 'year' });
    expect(formatTime(hedged)).toBe('c. 1200');
  });

  it('leaves a plain vague period unqualified', () => {
    const century = fuzzy(fromGregorian(1101), fromGregorian(1101), fromGregorian(1201), fromGregorian(1201), {
      granularity: 'century',
    });
    expect(formatTime(century)).toBe('12th century');
  });
});

describe('the authored string wins when it says more', () => {
  it('shows what was typed for hedged and qualified claims', () => {
    expect(format('c. 250 BC')).toBe('c. 250 BC');
    expect(format('mid-3rd century BC')).toBe('mid-3rd century BC');
    expect(format('1187 or 1189')).toBe('1187 or 1189');
    expect(format('~1200')).toBe('~1200');
  });

  it('derives the label when the numbers say everything', () => {
    expect(format('1969-07-20')).toBe('20 July 1969');
    expect(format('1969-07')).toBe('July 1969');
    expect(format('250 BCE')).toBe('250 BC');
    expect(format('1914-1918')).toBe(`1914${EN_DASH}1918`);
    expect(format('12th century')).toBe('12th century');
    expect(format('1180s')).toBe('1180s');
    expect(format('AD 1969')).toBe('1969');
  });

  it('ignores an empty text override', () => {
    expect(formatTime({ ...instant(1969), text: '' })).toBe('1969');
  });
});

describe('Julian display', () => {
  it('shows a Julian spec as its Julian date', () => {
    const julian = instant(1493, 3, 4, { calendar: 'julian' });
    expect(formatTime(julian)).toBe('4 March 1493');
    // The same instant, spelled in the other calendar.
    expect(formatTime(instant(1493, 3, 13))).toBe('13 March 1493');
    expect(julian.a).toBe(instant(1493, 3, 13).a);
  });
});

describe('round trip through the parser', () => {
  const inputs = [
    '1969-07-20',
    '1969-07',
    '1969',
    '250 BC',
    '1914-1918',
    '12th century',
    '3rd century BC',
    '1180s',
    '250s BC',
    'c. 1200 BC',
    'mid-3rd century BC',
    '1187 or 1189',
    '20 July 1969',
  ];

  it.each(inputs)('formats %j to something that parses back to the same spec', (input) => {
    const first = parseTime(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const shown = formatTime(first.value);
    const again = parseTime(shown);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect([again.value.a, again.value.b, again.value.c, again.value.d]).toEqual([
      first.value.a,
      first.value.b,
      first.value.c,
      first.value.d,
    ]);
    expect(again.value.mode).toBe(first.value.mode);
    expect(again.value.granularity).toBe(first.value.granularity);
  });
});

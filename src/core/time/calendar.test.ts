import { describe, expect, it } from 'vitest';
import {
  centuryYears,
  daysInMonth,
  decadeYears,
  fromGregorian,
  isLeapYear,
  isValidCivilDate,
  periodBounds,
  toGregorian,
} from './calendar';

/**
 * Deterministic PRNG (mulberry32) so the property tests below are reproducible:
 * a failure can be replayed exactly, which is the only thing that makes a
 * randomised test worth having.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomInt = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

describe('fromGregorian', () => {
  it('places the epoch at zero', () => {
    expect(fromGregorian(1970, 1, 1)).toBe(0);
    expect(fromGregorian(1970, 1, 2)).toBe(1);
    expect(fromGregorian(1969, 12, 31)).toBe(-1);
  });

  it('defaults omitted parts to the start of the period', () => {
    expect(fromGregorian(1969)).toBe(fromGregorian(1969, 1, 1));
    expect(fromGregorian(1969, 7)).toBe(fromGregorian(1969, 7, 1));
  });

  it('agrees with known day counts', () => {
    expect(fromGregorian(2000, 1, 1)).toBe(10957);
    expect(fromGregorian(1969, 7, 20)).toBe(-165);
    // 400 Gregorian years are exactly 146 097 days.
    expect(fromGregorian(2370, 1, 1) - fromGregorian(1970, 1, 1)).toBe(146097);
  });

  it('is strictly increasing through the year 0 boundary', () => {
    const walk = [
      fromGregorian(-1, 12, 31),
      fromGregorian(0, 1, 1),
      fromGregorian(0, 12, 31),
      fromGregorian(1, 1, 1),
    ];
    for (let i = 1; i < walk.length; i += 1) {
      expect(walk[i]!).toBeGreaterThan(walk[i - 1]!);
    }
    // Year 0 is a leap year astronomically (divisible by 400), so it has 366 days.
    expect(fromGregorian(1, 1, 1) - fromGregorian(0, 1, 1)).toBe(366);
  });

  it('handles deep antiquity as ordinary arithmetic', () => {
    expect(fromGregorian(-4000, 1, 1)).toBeLessThan(-2100000);
    expect(Number.isInteger(fromGregorian(-4000, 1, 1))).toBe(true);
    // -4000 is divisible by 400, so it is a leap year even that far back.
    expect(fromGregorian(-3999, 1, 1) - fromGregorian(-4000, 1, 1)).toBe(366);
    expect(fromGregorian(-3998, 1, 1) - fromGregorian(-3999, 1, 1)).toBe(365);
  });

  it('matches Date.UTC over the range Date can represent', () => {
    // `Date` is banned in the core (§2.3) but is a fair independent oracle here.
    const rng = mulberry32(20260815);
    for (let i = 0; i < 500; i += 1) {
      const year = randomInt(rng, 1600, 2400);
      const month = randomInt(rng, 1, 12);
      const day = randomInt(rng, 1, daysInMonth(year, month));
      const oracle = Date.UTC(year, month - 1, day) / 86400000;
      expect(fromGregorian(year, month, day)).toBe(oracle);
    }
  });
});

describe('toGregorian', () => {
  it('inverts known days', () => {
    expect(toGregorian(0)).toEqual({ year: 1970, month: 1, day: 1 });
    expect(toGregorian(-1)).toEqual({ year: 1969, month: 12, day: 31 });
    expect(toGregorian(-165)).toEqual({ year: 1969, month: 7, day: 20 });
  });

  it('names the day a fractional time falls in', () => {
    expect(toGregorian(0.75)).toEqual({ year: 1970, month: 1, day: 1 });
    expect(toGregorian(-0.25)).toEqual({ year: 1969, month: 12, day: 31 });
  });

  it('uses astronomical year numbering', () => {
    expect(toGregorian(fromGregorian(0, 1, 1))).toEqual({ year: 0, month: 1, day: 1 });
    expect(toGregorian(fromGregorian(-1, 12, 31))).toEqual({ year: -1, month: 12, day: 31 });
  });
});

describe('round trips', () => {
  it('is exact for a few thousand pseudo-random Gregorian dates', () => {
    const rng = mulberry32(1969072024);
    for (let i = 0; i < 4000; i += 1) {
      const year = randomInt(rng, -6000, 6000);
      const month = randomInt(rng, 1, 12);
      const day = randomInt(rng, 1, daysInMonth(year, month));
      const round = toGregorian(fromGregorian(year, month, day));
      expect(round).toEqual({ year, month, day });
    }
  });

  it('is exact for a few thousand pseudo-random Julian dates', () => {
    const rng = mulberry32(15821005);
    for (let i = 0; i < 2000; i += 1) {
      const year = randomInt(rng, -6000, 6000);
      const month = randomInt(rng, 1, 12);
      const day = randomInt(rng, 1, daysInMonth(year, month, 'julian'));
      const round = toGregorian(fromGregorian(year, month, day, 'julian'), 'julian');
      expect(round).toEqual({ year, month, day });
    }
  });

  it('is exact starting from day numbers, in both calendars', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 4000; i += 1) {
      const t = randomInt(rng, -3000000, 3000000);
      const g = toGregorian(t);
      expect(fromGregorian(g.year, g.month, g.day)).toBe(t);
      const j = toGregorian(t, 'julian');
      expect(fromGregorian(j.year, j.month, j.day, 'julian')).toBe(t);
    }
  });

  it('is monotonic: later dates are larger numbers', () => {
    const rng = mulberry32(7);
    let previous = fromGregorian(-6000, 1, 1);
    for (let year = -5999; year <= 3000; year += randomInt(rng, 1, 17)) {
      const t = fromGregorian(year, 1, 1);
      expect(t).toBeGreaterThan(previous);
      previous = t;
    }
  });
});

describe('the Julian calendar is a spelling, not an axis', () => {
  it('puts 1493 ten days out of step only after 1500', () => {
    // The offset is nine days between 1 March 1400 and 28 February 1500 (Julian),
    // so 4 March 1493 Julian is 13 March 1493 Gregorian — not the 14th.
    expect(fromGregorian(1493, 3, 4, 'julian')).toBe(fromGregorian(1493, 3, 13));
    expect(fromGregorian(1493, 3, 4, 'julian')).not.toBe(fromGregorian(1493, 3, 14));
    // Ten days from 1 March 1500, which is the offset the Gregorian reform used.
    expect(fromGregorian(1582, 10, 5, 'julian')).toBe(fromGregorian(1582, 10, 15));
    expect(fromGregorian(1600, 1, 1, 'julian')).toBe(fromGregorian(1600, 1, 11));
  });

  it('anchors the epoch', () => {
    expect(fromGregorian(1969, 12, 19, 'julian')).toBe(0);
    expect(toGregorian(0, 'julian')).toEqual({ year: 1969, month: 12, day: 19 });
  });

  it('keeps the two calendars sortable against each other', () => {
    const julian = fromGregorian(1493, 3, 4, 'julian');
    const gregorian = fromGregorian(1493, 3, 4);
    expect(julian).toBeGreaterThan(gregorian);
  });

  it('applies the Julian leap rule to centurial years', () => {
    expect(isLeapYear(1500, 'julian')).toBe(true);
    expect(isLeapYear(1500)).toBe(false);
    expect(daysInMonth(1500, 2, 'julian')).toBe(29);
    expect(daysInMonth(1500, 2)).toBe(28);
    expect(fromGregorian(1500, 3, 1, 'julian') - fromGregorian(1500, 2, 28, 'julian')).toBe(2);
  });
});

describe('leap years and month lengths', () => {
  it('follows the Gregorian rule, including the centurial exceptions', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(0)).toBe(true);
    expect(isLeapYear(-4)).toBe(true);
    expect(isLeapYear(-100)).toBe(false);
    expect(isLeapYear(-400)).toBe(true);
  });

  it('places 29 February only where it exists', () => {
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(toGregorian(fromGregorian(2000, 2, 29))).toEqual({ year: 2000, month: 2, day: 29 });
    expect(fromGregorian(1900, 3, 1) - fromGregorian(1900, 2, 28)).toBe(1);
    expect(fromGregorian(2000, 3, 1) - fromGregorian(2000, 2, 28)).toBe(2);
  });

  it('knows the length of every month', () => {
    expect([1, 3, 5, 7, 8, 10, 12].map((m) => daysInMonth(2023, m))).toEqual([
      31, 31, 31, 31, 31, 31, 31,
    ]);
    expect([4, 6, 9, 11].map((m) => daysInMonth(2023, m))).toEqual([30, 30, 30, 30]);
    expect(daysInMonth(2023, 0)).toBe(0);
    expect(daysInMonth(2023, 13)).toBe(0);
  });

  it('validates civil dates', () => {
    expect(isValidCivilDate(1969, 7, 20)).toBe(true);
    expect(isValidCivilDate(1969, 2, 29)).toBe(false);
    expect(isValidCivilDate(2000, 2, 29)).toBe(true);
    expect(isValidCivilDate(1969, 13, 1)).toBe(false);
    expect(isValidCivilDate(1969, 4, 31)).toBe(false);
    expect(isValidCivilDate(1969, 7, 0)).toBe(false);
    expect(isValidCivilDate(1969.5, 7, 20)).toBe(false);
  });
});

describe('named periods', () => {
  it('names AD decades by their floor', () => {
    expect(decadeYears(1180)).toEqual([1180, 1190]);
    expect(decadeYears(1187)).toEqual([1180, 1190]);
    expect(decadeYears(1189)).toEqual([1180, 1190]);
    expect(decadeYears(1190)).toEqual([1190, 1200]);
  });

  it('names BC decades by their BC year, so the 250s BC is 259-250 BC', () => {
    expect(decadeYears(-258)).toEqual([-258, -248]); // 259 BC
    expect(decadeYears(-249)).toEqual([-258, -248]); // 250 BC
    expect(decadeYears(-248)).toEqual([-248, -238]); // 249 BC
    expect(decadeYears(0)).toEqual([-8, 1]); // 1 BC sits in the 0s BC
  });

  it('stops the decades either side of the epoch at the era boundary', () => {
    // 9 BC..1 BC and AD 1..AD 9: nine years each, because there is no year 0.
    expect(decadeYears(-8)).toEqual([-8, 1]); // 9 BC
    expect(decadeYears(1)).toEqual([1, 10]); // AD 1
    expect(decadeYears(9)).toEqual([1, 10]);
    expect(decadeYears(10)).toEqual([10, 20]);
  });

  it('counts centuries as historians do', () => {
    expect(centuryYears(1101)).toEqual([1101, 1201]);
    expect(centuryYears(1200)).toEqual([1101, 1201]);
    expect(centuryYears(1201)).toEqual([1201, 1301]);
    expect(centuryYears(1)).toEqual([1, 101]);
    expect(centuryYears(100)).toEqual([1, 101]);
    // 3rd century BC = 300..201 BC = astronomical -299..-200.
    expect(centuryYears(-299)).toEqual([-299, -199]);
    expect(centuryYears(-200)).toEqual([-299, -199]);
    expect(centuryYears(0)).toEqual([-99, 1]); // 1st century BC
  });

  it('covers the axis without gaps or overlaps', () => {
    for (let year = -400; year <= 400; year += 1) {
      const [ds, de] = decadeYears(year);
      expect(year).toBeGreaterThanOrEqual(ds);
      expect(year).toBeLessThan(de);
      // Ten years everywhere except the two that stop at the era boundary.
      expect(de - ds).toBe(ds === -8 || ds === 1 ? 9 : 10);
      const [cs, ce] = centuryYears(year);
      expect(year).toBeGreaterThanOrEqual(cs);
      expect(year).toBeLessThan(ce);
      expect(ce - cs).toBe(100);
    }
  });

  it('tiles the axis: each period starts exactly where the previous one ended', () => {
    // Containment alone cannot see an overlap; this walks the joins, including
    // the one at the epoch where two decades used to double-claim years 0 and 1.
    for (let year = -400; year <= 400; year += 1) {
      const [ds] = decadeYears(year);
      expect(decadeYears(ds - 1)[1]).toBe(ds);
      const [cs] = centuryYears(year);
      expect(centuryYears(cs - 1)[1]).toBe(cs);
    }
  });
});

describe('periodBounds', () => {
  it('spans exactly the period named', () => {
    expect(periodBounds(1969, 7, 20, 'day')).toEqual({
      start: fromGregorian(1969, 7, 20),
      end: fromGregorian(1969, 7, 21),
    });
    expect(periodBounds(1969, 7, 20, 'month')).toEqual({
      start: fromGregorian(1969, 7, 1),
      end: fromGregorian(1969, 8, 1),
    });
    expect(periodBounds(1969, 12, 20, 'month')).toEqual({
      start: fromGregorian(1969, 12, 1),
      end: fromGregorian(1970, 1, 1),
    });
    expect(periodBounds(1969, 7, 20, 'year')).toEqual({
      start: fromGregorian(1969, 1, 1),
      end: fromGregorian(1970, 1, 1),
    });
  });

  it('snaps coarse granularities to the period the date falls in', () => {
    expect(periodBounds(1187, 1, 1, 'decade')).toEqual({
      start: fromGregorian(1180, 1, 1),
      end: fromGregorian(1190, 1, 1),
    });
    expect(periodBounds(1187, 1, 1, 'century')).toEqual({
      start: fromGregorian(1101, 1, 1),
      end: fromGregorian(1201, 1, 1),
    });
  });

  it('is a non-empty half-open span at every granularity', () => {
    for (const granularity of ['day', 'month', 'year', 'decade', 'century'] as const) {
      const { start, end } = periodBounds(-250, 6, 15, granularity);
      expect(end).toBeGreaterThan(start);
    }
  });

  it('measures Julian periods in the Julian calendar', () => {
    expect(periodBounds(1500, 2, 1, 'month', 'julian')).toEqual({
      start: fromGregorian(1500, 2, 1, 'julian'),
      end: fromGregorian(1500, 3, 1, 'julian'),
    });
    // 29 days: 1500 is a Julian leap year.
    const { start, end } = periodBounds(1500, 2, 1, 'month', 'julian');
    expect(end - start).toBe(29);
  });
});

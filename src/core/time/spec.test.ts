import { describe, expect, it } from 'vitest';
import type { TimeSpec } from '../model/types';
import { fromGregorian } from './calendar';
import {
  MIN_SIGMA,
  compareTime,
  fuzzy,
  instant,
  interval,
  isWellFormedSpec,
  midpoint,
  trapezoidStats,
} from './spec';

const SQRT_12 = Math.sqrt(12);

/** Every spec the library hands out must satisfy this, whatever it was built from. */
function expectWellFormed(spec: TimeSpec): void {
  expect(spec.a).toBeLessThanOrEqual(spec.b);
  expect(spec.b).toBeLessThanOrEqual(spec.c);
  expect(spec.c).toBeLessThanOrEqual(spec.d);
  expect(spec.sigma).toBeGreaterThan(0);
  expect(Number.isFinite(spec.sigma)).toBe(true);
}

describe('instant', () => {
  it('infers granularity from the deepest field supplied', () => {
    expect(instant(1969, 7, 20).granularity).toBe('day');
    expect(instant(1969, 7).granularity).toBe('month');
    expect(instant(1969).granularity).toBe('year');
  });

  it('widens to the period its granularity names', () => {
    const day = instant(1969, 7, 20);
    expect(day.a).toBe(fromGregorian(1969, 7, 20));
    expect(day.d).toBe(fromGregorian(1969, 7, 21));

    const year = instant(1848);
    expect(year.a).toBe(fromGregorian(1848, 1, 1));
    expect(year.d).toBe(fromGregorian(1849, 1, 1));
  });

  it('keeps a = b and c = d, and records that a moment was meant', () => {
    const spec = instant(1848);
    expect(spec.mode).toBe('instant');
    expect(spec.a).toBe(spec.b);
    expect(spec.c).toBe(spec.d);
    // Same four numbers as the interval, distinguished only by `mode` (§2.2).
    const asInterval = interval(fromGregorian(1848), fromGregorian(1849), { granularity: 'year' });
    expect([spec.a, spec.b, spec.c, spec.d]).toEqual([
      asInterval.a,
      asInterval.b,
      asInterval.c,
      asInterval.d,
    ]);
    expect(asInterval.mode).toBe('interval');
  });

  it('snaps to the period when granularity is given explicitly', () => {
    const century = instant(1187, undefined, undefined, { granularity: 'century' });
    expect(century.a).toBe(fromGregorian(1101, 1, 1));
    expect(century.d).toBe(fromGregorian(1201, 1, 1));

    const decade = instant(1187, 6, 15, { granularity: 'decade' });
    expect(decade.a).toBe(fromGregorian(1180, 1, 1));
    expect(decade.d).toBe(fromGregorian(1190, 1, 1));
  });

  it('carries the calendar through and puts Julian dates on the same axis', () => {
    const julian = instant(1493, 3, 4, { calendar: 'julian' });
    expect(julian.calendar).toBe('julian');
    expect(julian.a).toBe(instant(1493, 3, 13).a);
  });

  it('is well formed at every granularity, deep BC included', () => {
    for (const granularity of ['day', 'month', 'year', 'decade', 'century'] as const) {
      expectWellFormed(instant(-3200, 6, 15, { granularity }));
      expectWellFormed(instant(2026, 6, 15, { granularity }));
    }
  });
});

describe('interval', () => {
  it('stores a = b = start and c = d = end', () => {
    const spec = interval(fromGregorian(1914), fromGregorian(1919), { granularity: 'year' });
    expect(spec.mode).toBe('interval');
    expect(spec.a).toBe(spec.b);
    expect(spec.c).toBe(spec.d);
    expect(spec.a).toBe(fromGregorian(1914));
    expect(spec.d).toBe(fromGregorian(1919));
  });

  it('swaps reversed arguments rather than producing a malformed spec', () => {
    const spec = interval(fromGregorian(1919), fromGregorian(1914));
    expectWellFormed(spec);
    expect(spec.a).toBe(fromGregorian(1914));
    expect(spec.d).toBe(fromGregorian(1919));
  });

  it('survives a zero-length span with a positive sigma', () => {
    const spec = interval(100, 100);
    expectWellFormed(spec);
    expect(spec.sigma).toBe(MIN_SIGMA);
  });

  it('defaults to day granularity and the Gregorian calendar', () => {
    const spec = interval(0, 10);
    expect(spec.granularity).toBe('day');
    expect(spec.calendar).toBe('gregorian');
  });
});

describe('fuzzy', () => {
  it('sorts its four numbers so the result is always well formed', () => {
    const spec = fuzzy(40, 10, 30, 20);
    expect([spec.a, spec.b, spec.c, spec.d]).toEqual([10, 20, 30, 40]);
    expectWellFormed(spec);
  });

  it('accepts a fully degenerate claim without producing a zero sigma', () => {
    const spec = fuzzy(5, 5, 5, 5);
    expectWellFormed(spec);
    expect(spec.sigma).toBe(MIN_SIGMA);
  });
});

describe('sigma', () => {
  it('is the spread of a uniform for a rectangular claim: w / sqrt(12)', () => {
    expect(instant(1969, 7, 20).sigma).toBeCloseTo(1 / SQRT_12, 12);
    expect(instant(1969, 7).sigma).toBeCloseTo(31 / SQRT_12, 12);
    expect(instant(1969).sigma).toBeCloseTo(365 / SQRT_12, 12);
    expect(instant(2024).sigma).toBeCloseTo(366 / SQRT_12, 12);
    expect(interval(0, 1000).sigma).toBeCloseTo(1000 / SQRT_12, 12);
  });

  it('is small but nonzero for a day-granularity instant', () => {
    const sigma = instant(1969, 7, 20).sigma;
    expect(sigma).toBeGreaterThan(0);
    expect(sigma).toBeLessThan(1);
  });

  it('grows monotonically with the coarseness of the claim', () => {
    const sigmas = (['day', 'month', 'year', 'decade', 'century'] as const).map(
      (granularity) => instant(1969, 7, 20, { granularity }).sigma,
    );
    for (let i = 1; i < sigmas.length; i += 1) {
      expect(sigmas[i]!).toBeGreaterThan(sigmas[i - 1]!);
    }
  });

  it('grows when a claim is hedged outwards', () => {
    const exact = instant(1200);
    const hedged = fuzzy(exact.a - 1826, exact.a, exact.d, exact.d + 1826, {
      granularity: 'year',
    });
    expect(hedged.sigma).toBeGreaterThan(exact.sigma);
  });

  it('grows when a span is widened', () => {
    const narrow = interval(0, 100);
    const wide = interval(0, 200);
    expect(wide.sigma).toBeGreaterThan(narrow.sigma);
  });

  it('is unaffected by where on the axis the claim sits', () => {
    // Deep BC has day numbers near -1.5 million; the moments must not lose
    // precision to cancellation there (§ trapezoidStats).
    const modern = instant(2020).sigma;
    const ancient = instant(-2020).sigma;
    expect(ancient).toBeCloseTo(modern, 6);
  });
});

describe('trapezoidStats', () => {
  /** Rectangle-rule integration of the trapezoidal pdf, as an independent check. */
  function numericStats(a: number, b: number, c: number, d: number): { mean: number; sd: number } {
    const height = 2 / (d + c - a - b);
    const pdf = (x: number): number => {
      if (x < a || x > d) return 0;
      if (x < b) return (height * (x - a)) / (b - a);
      if (x <= c) return height;
      return (height * (d - x)) / (d - c);
    };
    const n = 200000;
    const step = (d - a) / n;
    let mass = 0;
    let m1 = 0;
    let m2 = 0;
    for (let i = 0; i < n; i += 1) {
      const x = a + (i + 0.5) * step;
      const w = pdf(x) * step;
      mass += w;
      m1 += x * w;
      m2 += x * x * w;
    }
    const mean = m1 / mass;
    return { mean, sd: Math.sqrt(m2 / mass - mean * mean) };
  }

  it('matches numerical integration for an asymmetric trapezoid', () => {
    const [a, b, c, d] = [0, 30, 100, 400];
    const closed = trapezoidStats(a, b, c, d);
    const numeric = numericStats(a, b, c, d);
    expect(closed.mean).toBeCloseTo(numeric.mean, 3);
    expect(closed.sd).toBeCloseTo(numeric.sd, 3);
  });

  it('matches numerical integration for a triangle and for a uniform', () => {
    const triangle = trapezoidStats(0, 50, 50, 100);
    const triangleNumeric = numericStats(0, 50, 50, 100);
    expect(triangle.mean).toBeCloseTo(triangleNumeric.mean, 3);
    expect(triangle.sd).toBeCloseTo(triangleNumeric.sd, 3);
    // Symmetric triangle on [0, 100]: sd = w / sqrt(24).
    expect(triangle.sd).toBeCloseTo(100 / Math.sqrt(24), 6);

    const uniform = trapezoidStats(0, 0, 100, 100);
    expect(uniform.mean).toBeCloseTo(50, 12);
    expect(uniform.sd).toBeCloseTo(100 / SQRT_12, 12);
  });

  it('returns zero spread for a point', () => {
    expect(trapezoidStats(7, 7, 7, 7)).toEqual({ mean: 7, sd: 0 });
  });

  it('is translation invariant', () => {
    const here = trapezoidStats(0, 30, 100, 400);
    const shifted = trapezoidStats(-1500000, -1500000 + 30, -1500000 + 100, -1500000 + 400);
    expect(shifted.sd).toBeCloseTo(here.sd, 9);
    expect(shifted.mean + 1500000).toBeCloseTo(here.mean, 9);
  });
});

describe('midpoint', () => {
  it('is the centre of any symmetric claim', () => {
    expect(midpoint(instant(1969, 7, 20))).toBe(fromGregorian(1969, 7, 20) + 0.5);
    expect(midpoint(interval(100, 200))).toBeCloseTo(150, 9);
    expect(midpoint(fuzzy(0, 10, 90, 100))).toBeCloseTo(50, 9);
  });

  it('leans towards the longer tail of a skewed claim', () => {
    const skewed = fuzzy(0, 90, 100, 100);
    expect(midpoint(skewed)).toBeLessThan(95);
    expect(midpoint(skewed)).toBeGreaterThan(50);
  });

  it('lies inside the support of every claim', () => {
    for (const spec of [
      instant(1969, 7, 20),
      instant(-250),
      interval(fromGregorian(1914), fromGregorian(1919)),
      fuzzy(-100, -50, 50, 100),
    ]) {
      expect(midpoint(spec)).toBeGreaterThanOrEqual(spec.a);
      expect(midpoint(spec)).toBeLessThanOrEqual(spec.d);
    }
  });
});

describe('compareTime', () => {
  it('orders by likely start, then by earliest possible start', () => {
    const early = instant(1848);
    const late = instant(1914);
    expect(compareTime(early, late)).toBe(-1);
    expect(compareTime(late, early)).toBe(1);

    const sameB = fuzzy(early.a - 100, early.a, early.d, early.d);
    expect(compareTime(sameB, early)).toBe(-1);
    expect(compareTime(early, sameB)).toBe(1);
  });

  it('returns 0 when b and a agree, leaving the tie to the caller', () => {
    const one = instant(1848);
    const other = interval(one.a, one.d, { granularity: 'year' });
    expect(compareTime(one, other)).toBe(0);
    expect(compareTime(other, one)).toBe(0);
  });

  it('sorts a list deterministically and consistently in both directions', () => {
    const specs = [instant(1914), instant(-250), instant(1969, 7, 20), instant(1848), instant(0)];
    const sorted = [...specs].sort(compareTime).map((s) => s.b);
    const reversed = [...specs].reverse().sort(compareTime).map((s) => s.b);
    expect(sorted).toEqual([...sorted].sort((x, y) => x - y));
    expect(reversed).toEqual(sorted);
  });

  it('is antisymmetric across a range of claims', () => {
    const specs = [instant(1914), instant(-250), fuzzy(0, 1, 2, 3), interval(10, 20)];
    for (const x of specs) {
      for (const y of specs) {
        expect(compareTime(x, y) + compareTime(y, x)).toBe(0);
      }
    }
  });
});

describe('isWellFormedSpec', () => {
  it('accepts everything the constructors produce', () => {
    for (const spec of [
      instant(1969, 7, 20),
      instant(-250),
      interval(fromGregorian(1914), fromGregorian(1919)),
      fuzzy(0, 1, 2, 3),
      { ...instant(1848), text: 'the year of revolutions' },
    ]) {
      expect(isWellFormedSpec(spec)).toBe(true);
    }
  });

  it('rejects what only an import could hand us', () => {
    const good = instant(1848);
    const bad: TimeSpec[] = [
      { ...good, a: Number.NEGATIVE_INFINITY },
      { ...good, d: Number.NaN },
      { ...good, sigma: 0 },
      { ...good, sigma: Number.POSITIVE_INFINITY },
      { ...good, b: good.d + 1 }, // out of order
      { ...good, mode: 'moment' as TimeSpec['mode'] },
      { ...good, calendar: 'mayan' as TimeSpec['calendar'] },
      { ...good, granularity: 'fortnight' as TimeSpec['granularity'] },
      { ...good, a: '0' as unknown as number },
    ];
    for (const spec of bad) expect(isWellFormedSpec(spec)).toBe(false);
    expect(isWellFormedSpec(null)).toBe(false);
    expect(isWellFormedSpec(undefined)).toBe(false);
  });
});

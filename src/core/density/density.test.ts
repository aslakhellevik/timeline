import { describe, expect, it } from 'vitest';
import type { TimeSpec, Viewport } from '../model/types';
import { fromGregorian, fuzzy, instant, interval } from '../time';
import {
  computeDensity,
  computeDensityReference,
  farViewOpacity,
  heightFraction,
  normalCdf,
  psi,
} from './index';
import { boxSizesForGaussian, gaussianBlur } from './blur';

const YEAR = 365.2425;
const year = (y: number) => fromGregorian(y, 1, 1);

function view(fromYear: number, toYear: number, width = 1000): Viewport {
  return { start: year(fromYear), end: year(toYear), width };
}

function sorted(specs: TimeSpec[]): TimeSpec[] {
  return [...specs].sort((x, y) => x.b - y.b);
}

/** Peaks separated by a real trough — how many distinct lumps the curve shows. */
function countPeaks(lambda: Float64Array, relativeFloor = 0.25): number {
  let max = 0;
  for (const v of lambda) if (v > max) max = v;
  if (max <= 0) return 0;

  const floor = max * relativeFloor;
  let peaks = 0;
  let above = false;
  for (const v of lambda) {
    if (v >= floor && !above) {
      peaks++;
      above = true;
    } else if (v < floor) {
      above = false;
    }
  }
  return peaks;
}

describe('normalCdf', () => {
  it('matches known values to near machine precision', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 15);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 14);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145705, 14);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 14);
    expect(normalCdf(3)).toBeCloseTo(0.9986501019683699, 14);
  });

  it('stays accurate in absolute terms out into the far tails', () => {
    // Absolute error is the figure that matters — a 6σ tail value is negligible
    // beside the peak, so relative precision out there would buy nothing.
    expect(Math.abs(normalCdf(-6) - 9.865876450376946e-10)).toBeLessThan(1e-17);
    expect(Math.abs(normalCdf(-10) - 7.619853024160525e-24)).toBeLessThan(1e-17);
    expect(normalCdf(-40)).toBe(0);
    expect(normalCdf(40)).toBe(1);

    // Relative accuracy does loosen in the tail, which is worth pinning so the
    // limit is known rather than assumed.
    expect(Math.abs(normalCdf(-6) / 9.865876450376946e-10 - 1)).toBeLessThan(1e-8);
  });

  it('is symmetric', () => {
    for (const x of [0.3, 1.1, 2.7, 5.5, 8.2]) {
      expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1, 14);
    }
  });
});

describe('psi', () => {
  it('is the antiderivative of the normal CDF', () => {
    // Finite difference of Psi must recover Phi.
    const h = 1e-5;
    for (const x of [-2, -0.5, 0, 0.7, 3]) {
      expect((psi(x + h) - psi(x - h)) / (2 * h)).toBeCloseTo(normalCdf(x), 8);
    }
  });

  it('behaves at both tails', () => {
    expect(psi(-30)).toBeCloseTo(0, 15);
    expect(psi(30)).toBeCloseTo(30, 10);
  });
});

describe('mass conservation', () => {
  it('gives total ≈ n for events well inside the window', () => {
    for (const n of [1, 5, 50, 500]) {
      const specs = sorted(
        Array.from({ length: n }, (_, i) => instant(1500 + Math.floor((i * 400) / n), 6, 15)),
      );
      const { total } = computeDensity(specs, view(1400, 2000));
      expect(total).toBeCloseTo(n, 6);
    }
  });

  it('conserves mass for intervals, fuzzy shapes and mixtures alike', () => {
    const specs = sorted([
      instant(1800, 3, 4),
      instant(1750),
      interval(year(1914), year(1919)),
      interval(year(1600), year(1700)),
      fuzzy(year(1650), year(1660), year(1680), year(1690)),
      fuzzy(year(1500), year(1520), year(1520), year(1560)),
    ]);
    // Ramped shapes carry a sub-part-per-million error from binning their
    // breakpoints onto fractional cell positions; instants are exact to 1e-6.
    expect(computeDensity(specs, view(1400, 2000)).total).toBeCloseTo(6, 4);
  });

  it('is unaffected by the supersample factor', () => {
    const specs = sorted([instant(1848), interval(year(1914), year(1919))]);
    for (const supersample of [1, 2, 4, 8]) {
      expect(computeDensity(specs, view(1800, 2000), { supersample }).total).toBeCloseTo(2, 6);
    }
  });

  it('counts only the part of the window it should when events sit outside', () => {
    const specs = sorted([instant(1000), instant(1900), instant(1950)]);
    expect(computeDensity(specs, view(1800, 2000)).total).toBeCloseTo(2, 4);
  });
});

describe('events that begin off-screen', () => {
  it('still contributes density inside the window', () => {
    // A claim spanning the whole viewport, with every breakpoint outside it.
    const spanning = interval(year(-2000), year(2000));
    const { lambda, total } = computeDensity([spanning], view(1700, 1800));

    expect(total).toBeGreaterThan(0);
    // Flat plateau: every column carries roughly the same mass.
    const values = [...lambda];
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(min).toBeGreaterThan(0);
    expect(max / min).toBeLessThan(1.05);
  });

  it('places the right fraction of a long interval inside the window', () => {
    const spec = interval(year(1000), year(2000));
    // A century out of a millennium: a tenth of the mass.
    const { total } = computeDensity([spec], view(1500, 1600));
    expect(total).toBeCloseTo(0.1, 3);
  });
});

describe('agreement with the reference implementation', () => {
  it('matches a slow exact evaluator on a mixed corpus', () => {
    const specs = sorted([
      instant(1789, 7, 14),
      instant(1815),
      instant(1848),
      interval(year(1914), year(1919)),
      interval(year(1939), year(1946)),
      fuzzy(year(1700), year(1720), year(1740), year(1780)),
      fuzzy(year(1600), year(1601), year(1601), year(1602)),
    ]);
    const vp = view(1550, 2000, 800);

    const fast = computeDensity(specs, vp);
    const slow = computeDensityReference(specs, vp);

    // Total mass must agree closely; the curve is allowed the few percent of
    // shape error the three-box kernel costs against a true Gaussian.
    expect(fast.total).toBeCloseTo(slow.total, 3);

    let l1 = 0;
    let mass = 0;
    for (let i = 0; i < fast.lambda.length; i++) {
      l1 += Math.abs((fast.lambda[i] as number) - (slow.lambda[i] as number));
      mass += slow.lambda[i] as number;
    }
    expect(l1 / mass).toBeLessThan(0.05);
  });

  it('matches on random inputs across several zoom levels', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const specs = sorted(
      Array.from({ length: 60 }, () => {
        const y = 1000 + rand() * 1000;
        const kind = rand();
        if (kind < 0.5) return instant(Math.floor(y), 1 + Math.floor(rand() * 12));
        if (kind < 0.8) return interval(year(y), year(y + 1 + rand() * 50));
        const s = year(y);
        return fuzzy(s, s + rand() * 5 * YEAR, s + 6 * YEAR, s + (7 + rand() * 40) * YEAR);
      }),
    );

    for (const [from, to] of [
      [900, 2100],
      [1200, 1600],
      [1450, 1500],
    ] as const) {
      const vp = view(from, to, 600);
      const fast = computeDensity(specs, vp);
      const slow = computeDensityReference(specs, vp);

      let l1 = 0;
      let mass = 0;
      for (let i = 0; i < fast.lambda.length; i++) {
        l1 += Math.abs((fast.lambda[i] as number) - (slow.lambda[i] as number));
        mass += slow.lambda[i] as number;
      }
      expect(mass).toBeGreaterThan(0);
      expect(l1 / mass).toBeLessThan(0.05);
    }
  });
});

describe('scale stability — the property the whole design rests on', () => {
  it('reads as one lump zoomed out and resolves into separate peaks zoomed in', () => {
    // Three tight clusters a decade apart.
    const specs = sorted(
      [1900, 1910, 1920].flatMap((base) =>
        Array.from({ length: 8 }, (_, i) => instant(base, 1 + i, 15)),
      ),
    );

    const far = computeDensity(specs, view(1500, 2300, 800));
    const near = computeDensity(specs, view(1895, 1925, 800));

    expect(countPeaks(far.lambda)).toBe(1);
    expect(countPeaks(near.lambda)).toBe(3);
  });

  it('drives the crossfade from events per pixel, not from a zoom counter', () => {
    // Spread within each year as well as across them: events stacked on one day
    // stay stacked at any zoom, and would never fall below the threshold.
    const specs = sorted(
      Array.from({ length: 400 }, (_, i) => instant(1900 + (i % 40), 1 + Math.floor(i / 40), 15)),
    );

    const far = computeDensity(specs, view(1000, 2000, 500));
    const near = computeDensity(specs, view(1899, 1901, 500));

    expect(far.lambdaMax).toBeGreaterThan(1);
    expect(farViewOpacity(far.lambdaMax)).toBe(1);

    expect(near.lambdaMax).toBeLessThan(0.25);
    expect(farViewOpacity(near.lambdaMax)).toBe(0);
  });
});

describe('uncertainty', () => {
  it('holds a precise event steady on screen while a vague one spreads away', () => {
    const precise = instant(1800, 6, 15);
    const vague = fuzzy(year(1750), year(1780), year(1820), year(1850));

    const wide = view(1600, 2000, 800);
    const tight = view(1780, 1820, 800);

    const preciseGain =
      computeDensity([precise], tight).lambdaMax / computeDensity([precise], wide).lambdaMax;
    const vagueGain =
      computeDensity([vague], tight).lambdaMax / computeDensity([vague], wide).lambdaMax;

    // A point event occupies the same handful of pixels at every zoom. That
    // invariance is exactly what a screen-space bandwidth buys, and it is why
    // zooming resolves structure rather than stretching the same curve.
    expect(preciseGain).toBeGreaterThan(0.9);
    expect(preciseGain).toBeLessThan(1.1);

    // The vague event cannot concentrate: its fixed mass is spread over more and
    // more pixels as you zoom, so its peak falls away.
    expect(vagueGain).toBeLessThan(0.3);

    // So at close range the certain claim stands far above the uncertain one —
    // which is the honest rendering of what is actually known.
    expect(computeDensity([precise], tight).lambdaMax).toBeGreaterThan(
      computeDensity([vague], tight).lambdaMax * 10,
    );
  });

  it('gives a vaguer claim a lower, broader peak at equal mass', () => {
    const vp = view(1700, 1900, 800);
    const tight = computeDensity([interval(year(1800), year(1804))], vp);
    const loose = computeDensity([interval(year(1780), year(1820))], vp);

    expect(tight.total).toBeCloseTo(1, 6);
    expect(loose.total).toBeCloseTo(1, 6);
    expect(tight.lambdaMax).toBeGreaterThan(loose.lambdaMax * 3);
  });
});

describe('degenerate inputs', () => {
  it('handles an empty corpus', () => {
    const result = computeDensity([], view(1800, 1900));
    expect(result.total).toBe(0);
    expect(result.lambdaMax).toBe(0);
    expect(result.lambda.every((v) => v === 0)).toBe(true);
  });

  it('handles a zero-width or inverted viewport without producing NaN', () => {
    const specs = [instant(1850)];
    for (const vp of [
      { start: year(1800), end: year(1800), width: 100 },
      { start: year(1900), end: year(1800), width: 100 },
      { start: year(1800), end: year(1900), width: 0 },
    ]) {
      const { lambda, total } = computeDensity(specs, vp);
      expect(Number.isFinite(total)).toBe(true);
      expect([...lambda].every(Number.isFinite)).toBe(true);
    }
  });

  it('handles every event lying outside the window', () => {
    const result = computeDensity([instant(1000), instant(1100)], view(1800, 1900));
    expect(result.total).toBeCloseTo(0, 10);
  });

  it('handles a single event', () => {
    const result = computeDensity([instant(1850, 6, 15)], view(1800, 1900));
    expect(result.total).toBeCloseTo(1, 6);
    expect(result.lambdaMax).toBeGreaterThan(0);
  });
});

describe('display scaling', () => {
  it('compresses height so one event stays visible beside a dense war', () => {
    const lone = heightFraction(0.5);
    const war = heightFraction(8);
    expect(lone).toBeGreaterThan(0.3);
    expect(war).toBe(1);
    // Sixteen times the density is 16^(1/3) ≈ 2.5 times the height, not sixteen.
    expect(heightFraction(8) / heightFraction(0.5)).toBeCloseTo(Math.cbrt(16), 6);
    // Still monotone, so the ordering of periods is never misrepresented.
    expect(heightFraction(4)).toBeGreaterThan(heightFraction(1));
  });

  it('clamps and rejects nonsense', () => {
    expect(heightFraction(0)).toBe(0);
    expect(heightFraction(-1)).toBe(0);
    expect(heightFraction(1000)).toBe(1);
  });

  it('crossfades smoothly with no discontinuity at either end', () => {
    expect(farViewOpacity(0.25)).toBe(0);
    expect(farViewOpacity(1)).toBe(1);
    expect(farViewOpacity(0.625)).toBeCloseTo(0.5, 6);
    let previous = -1;
    for (let x = 0; x <= 1.5; x += 0.01) {
      const value = farViewOpacity(x);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = value;
    }
  });
});

describe('blur', () => {
  it('conserves mass away from the boundary', () => {
    const data = new Float64Array(400);
    data[200] = 1;
    gaussianBlur(data, 12);
    expect([...data].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('produces a bell of about the requested width', () => {
    const n = 2000;
    const data = new Float64Array(n);
    data[1000] = 1;
    const sigma = 30;
    gaussianBlur(data, sigma);

    let mean = 0;
    for (let i = 0; i < n; i++) mean += i * (data[i] as number);
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (i - mean) ** 2 * (data[i] as number);

    expect(mean).toBeCloseTo(1000, 6);
    expect(Math.sqrt(variance)).toBeGreaterThan(sigma * 0.95);
    expect(Math.sqrt(variance)).toBeLessThan(sigma * 1.05);
  });

  it('is a no-op below the sampling resolution', () => {
    const data = new Float64Array([0, 0, 1, 0, 0]);
    gaussianBlur(data, 0.2);
    expect([...data]).toEqual([0, 0, 1, 0, 0]);
  });

  it('chooses odd box widths', () => {
    for (const sigma of [1, 5, 20, 100]) {
      const sizes = boxSizesForGaussian(sigma);
      expect(sizes).toHaveLength(3);
      for (const size of sizes) expect(size % 2).toBe(1);
    }
  });
});

describe('performance budget', () => {
  it('computes 50k events at 2000px well inside a frame', () => {
    const specs = sorted(
      Array.from({ length: 50_000 }, (_, i) => {
        const y = -2000 + (i * 4000) / 50_000;
        return i % 7 === 0
          ? interval(year(y), year(y + 3))
          : instant(Math.floor(y), 1 + (i % 12), 1 + (i % 28));
      }),
    );
    const vp = view(-2000, 2026, 2000);

    computeDensity(specs, vp); // warm up

    const started = performance.now();
    const runs = 5;
    for (let i = 0; i < runs; i++) computeDensity(specs, vp);
    const perRun = (performance.now() - started) / runs;

    expect(perRun).toBeLessThan(16);
  });
});

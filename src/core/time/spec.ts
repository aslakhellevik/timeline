/**
 * Constructing and reasoning about `TimeSpec` — the four-number fuzzy interval
 * every temporal claim is stored as (design.md §2.2).
 *
 * Every spec is well-formed on construction: `a <= b <= c <= d` and `sigma > 0`.
 */

import type { Calendar, Days, Granularity, TimeMode, TimeSpec } from '../model/types';
import { periodBounds } from './calendar';

/**
 * Floor on `sigma`, in days (about 0.09 s). The density estimator divides by
 * sigma and by `sqrt(sigma^2 + h^2)` (§3.2), so a zero would produce NaN for a
 * degenerate spec such as `fuzzy(t, t, t, t)`. The value is far below the
 * resolution anything in this app is claimed at, so it never distorts a curve.
 */
export const MIN_SIGMA = 1e-6;

interface SpecOptions {
  calendar?: Calendar;
  granularity?: Granularity;
}

/**
 * Mean and standard deviation of the trapezoidal distribution with support
 * `[a, d]` and plateau `[b, c]` — the distribution the four numbers *are*.
 *
 * Both moments are computed about `a` rather than about the epoch. Days can be
 * -700 000 for antiquity, and the raw fourth-moment terms then cancel to three
 * or four significant digits; shifting the origin makes every intermediate small
 * and the result exact to full precision. Variance is translation-invariant, so
 * this changes nothing but the rounding.
 *
 * Degenerate shapes are limits of the same formulae: a rectangle (a=b, c=d) is a
 * uniform, giving sd = width / sqrt(12), and a point gives sd = 0.
 */
export function trapezoidStats(a: Days, b: Days, c: Days, d: Days): { mean: Days; sd: number } {
  const bb = b - a;
  const cc = c - a;
  const dd = d - a;
  const denom = dd + cc - bb; // (d - a) + (c - b), zero only when all four coincide
  if (!(denom > 0)) return { mean: a, sd: 0 };
  const mean = (dd * dd + cc * dd + cc * cc - bb * bb) / (3 * denom);
  const second = ((dd + cc) * (dd * dd + cc * cc) - bb * bb * bb) / (6 * denom);
  const variance = Math.max(0, second - mean * mean);
  return { mean: a + mean, sd: Math.sqrt(variance) };
}

/**
 * `sigma` is the 1σ spread of the trapezoid itself — the same distribution the
 * renderer draws. That single rule gives every case the value the density code
 * wants:
 *
 *  - a day-granularity instant spans one day, so sigma = 1/sqrt(12) ≈ 0.29 d:
 *    small, nonzero, and honest about "some time that day";
 *  - a year-granularity instant spans the year, so sigma = 365/sqrt(12) ≈ 105 d,
 *    which is exactly the "uniform of width w has sd w/sqrt(12)" rule;
 *  - a vaguer claim always has a wider trapezoid, hence a larger sigma.
 */
function sigmaOf(a: Days, b: Days, c: Days, d: Days): number {
  return Math.max(trapezoidStats(a, b, c, d).sd, MIN_SIGMA);
}

function makeSpec(
  mode: TimeMode,
  calendar: Calendar,
  granularity: Granularity,
  a: Days,
  b: Days,
  c: Days,
  d: Days,
): TimeSpec {
  return { mode, calendar, granularity, a, b, c, d, sigma: sigmaOf(a, b, c, d) };
}

/**
 * A single dated claim, widened to the period its granularity names (§2.2): an
 * event given as `1848` happened *somewhere in* 1848, so a = b = 1 January 1848
 * and c = d = 1 January 1849. `mode` records that the user meant one moment, which
 * is what distinguishes it from the interval with the same four numbers.
 *
 * Granularity defaults to the deepest field supplied; passing one explicitly snaps
 * to that period, so `instant(1187, undefined, undefined, { granularity: 'century' })`
 * is the whole 12th century.
 */
export function instant(
  year: number,
  month?: number,
  day?: number,
  opts?: { calendar?: Calendar; granularity?: Granularity },
): TimeSpec {
  const calendar = opts?.calendar ?? 'gregorian';
  const granularity =
    opts?.granularity ?? (day !== undefined ? 'day' : month !== undefined ? 'month' : 'year');
  const { start, end } = periodBounds(year, month ?? 1, day ?? 1, granularity, calendar);
  return makeSpec('instant', calendar, granularity, start, start, end, end);
}

/**
 * A claim about a duration: `a = b = start`, `c = d = end`, with `end` exclusive
 * (1914–1918 ends at the start of 1919). Reversed arguments are swapped rather
 * than rejected, so a spec is always well-formed.
 */
export function interval(start: Days, end: Days, opts?: SpecOptions): TimeSpec {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return makeSpec(
    'interval',
    opts?.calendar ?? 'gregorian',
    opts?.granularity ?? 'day',
    lo,
    lo,
    hi,
    hi,
  );
}

/**
 * The unconstrained trapezoid: `[a, d]` is everything possible, `[b, c]` is what
 * is likely. The four arguments are sorted, so any ordering yields a well-formed
 * spec.
 */
export function fuzzy(a: Days, b: Days, c: Days, d: Days, opts?: SpecOptions): TimeSpec {
  const s = [a, b, c, d].sort((x, y) => x - y) as [Days, Days, Days, Days];
  return makeSpec(
    'fuzzy',
    opts?.calendar ?? 'gregorian',
    opts?.granularity ?? 'day',
    s[0],
    s[1],
    s[2],
    s[3],
  );
}

/**
 * Centre of mass of the trapezoid — the single point to place the event at when
 * one is needed. Equal to (b + c) / 2 for any symmetric shape, which covers
 * instants, intervals and every symmetric fuzzy claim; it leans towards the
 * longer tail otherwise.
 */
export function midpoint(spec: TimeSpec): Days {
  return trapezoidStats(spec.a, spec.b, spec.c, spec.d).mean;
}

const MODES: readonly TimeMode[] = ['instant', 'interval', 'fuzzy'];
const CALENDARS: readonly Calendar[] = ['gregorian', 'julian'];
const GRANULARITIES: readonly Granularity[] = ['day', 'month', 'year', 'decade', 'century'];

/**
 * Whether a spec is one this code could have produced: four finite numbers in
 * order, a positive sigma, and the three discriminators inside their vocabulary.
 *
 * Every constructor above guarantees this, so nothing built in the app needs
 * checking. What needs checking is what arrives from outside — an imported file,
 * a hand-edited export. One `-Infinity` there is enough to turn
 * the whole density grid into NaN and blank the view, with nothing on screen to
 * say which record did it, so the boundary rejects rather than the estimator
 * defending itself.
 */
export function isWellFormedSpec(spec: TimeSpec | null | undefined): boolean {
  if (spec === null || spec === undefined || typeof spec !== 'object') return false;
  const { a, b, c, d, sigma } = spec;
  if (![a, b, c, d, sigma].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (!(a <= b && b <= c && c <= d)) return false;
  if (!(sigma > 0)) return false;
  if (!MODES.includes(spec.mode)) return false;
  if (!CALENDARS.includes(spec.calendar)) return false;
  if (!GRANULARITIES.includes(spec.granularity)) return false;
  return spec.text === undefined || typeof spec.text === 'string';
}

/**
 * Sort order for the timeline: likely start, then earliest possible start
 * (design.md's sort key is `b -> a -> title -> id`). Returns 0 when both agree —
 * the caller breaks the remaining ties, and must, for a fully stable order.
 */
export function compareTime(a: TimeSpec, b: TimeSpec): number {
  if (a.b !== b.b) return a.b < b.b ? -1 : 1;
  if (a.a !== b.a) return a.a < b.a ? -1 : 1;
  return 0;
}

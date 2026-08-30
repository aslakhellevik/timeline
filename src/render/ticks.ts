/**
 * Axis ticks: choosing round moments in time to label, at whatever zoom the user
 * happens to be at.
 *
 * Time is not a decimal scale, so the usual 1/2/5 ladder does not apply. Years
 * are not uniform in days and months are worse, so ticks are generated in
 * *calendar* space and converted, never by stepping a fixed number of days —
 * otherwise January drifts across the axis as you pan through the centuries.
 *
 * Pure and framework-free; the renderer only draws what this returns.
 */

import type { Days, Viewport } from '../core/model/types';
import { DAYS_PER_YEAR, fromGregorian, toGregorian } from '../core/time';

export interface Tick {
  t: Days;
  label: string;
  /** Major ticks get a brighter rule; minor ones stay recessive. */
  major: boolean;
}

/**
 * Round year steps. Decimal-ish, but with the 25/250 rungs history actually
 * uses.
 *
 * The rungs above 500 are close together on purpose. A 1000 → 2500 jump is a
 * 2.5× change in tick count, and a five-thousand-year corpus lands squarely in
 * it: asking for one tick per 625 years gives 1000, which is five ticks across
 * the whole of history, and there is nothing between that and twelve.
 */
const YEAR_STEPS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 2500, 5000, 10_000, 25_000, 50_000, 100_000,
] as const;

const MONTH_STEPS = [1, 3, 6] as const;
const DAY_STEPS = [1, 2, 5, 10, 15] as const;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Astronomical year numbering to what a reader expects: year 0 is 1 BC, and no
 * year 0 is ever shown.
 */
export function formatYear(year: number): string {
  return year > 0 ? String(year) : `${1 - year} BC`;
}

function pickStep<T extends number>(steps: readonly T[], wanted: number): T {
  for (const step of steps) if (step >= wanted) return step;
  return steps[steps.length - 1] as T;
}

/**
 * Minimum room between ticks, for a canvas of `width`.
 *
 * A flat 90 px is a desktop number, and on a phone it is most of the axis: at
 * 390 px it allows four ticks, of which the edge cases then eat all but one. A
 * label is around 45 px wide, so 56 is the floor at which two can stand next to
 * each other, and the sixth-of-the-width term keeps a wide canvas from becoming
 * a ruler.
 */
export function tickSpacingFor(width: number): number {
  return Math.max(56, Math.min(90, width / 6));
}

export function generateTicks(vp: Viewport, minSpacingPx = tickSpacingFor(vp.width)): Tick[] {
  const span = vp.end - vp.start;
  if (!(span > 0) || !(vp.width > 0)) return [];

  const maxTicks = Math.max(2, Math.floor(vp.width / minSpacingPx));

  // The finest ladder whose coarsest rung still clears the spacing floor wins.
  // Asking instead for "at least one month per tick" reads plausibly and is
  // wrong: a one-year span then falls through to day ticks, and a seven-year
  // span lands on six-month steps too close together to label.
  const wantedDays = span / maxTicks;
  if (wantedDays <= Math.max(...DAY_STEPS)) {
    return dayTicks(vp, pickStep(DAY_STEPS, wantedDays));
  }

  const wantedMonths = ((span / DAYS_PER_YEAR) * 12) / maxTicks;
  if (wantedMonths <= Math.max(...MONTH_STEPS)) {
    return monthTicks(vp, pickStep(MONTH_STEPS, wantedMonths));
  }

  return yearTicks(vp, pickStep(YEAR_STEPS, (span / DAYS_PER_YEAR) / maxTicks));
}

/**
 * Year ticks land on round *displayed* years, which is not the same as round
 * astronomical ones. Stepping the astronomical axis by 500 through antiquity
 * puts a tick on −2500, which displays as "2501 BC" — arithmetically right and
 * unreadable as anything but a bug. So the two eras are stepped separately, each
 * on its own round numbers, and converted.
 */
function yearTicks(vp: Viewport, step: number): Tick[] {
  const first = toGregorian(vp.start).year;
  const last = toGregorian(vp.end).year;
  const ticks: Tick[] = [];

  // A major rule every fifth step keeps a long span readable without a second
  // ladder of labels.
  const majorStep = step * 5;

  const add = (astronomicalYear: number) => {
    const t = fromGregorian(astronomicalYear, 1, 1);
    if (t < vp.start || t > vp.end) return;
    const displayed = astronomicalYear > 0 ? astronomicalYear : 1 - astronomicalYear;
    ticks.push({
      t,
      label: formatYear(astronomicalYear),
      major: displayed % majorStep === 0,
    });
  };

  // BC: displayed year d sits at astronomical 1 − d.
  for (let d = step; d <= 1 - first + step; d += step) {
    const year = 1 - d;
    if (year > last) continue;
    add(year);
  }

  // AD.
  for (let d = step; d <= last + step; d += step) {
    if (d < first) continue;
    add(d);
  }

  ticks.sort((a, b) => a.t - b.t);
  return ticks;
}

function monthTicks(vp: Viewport, step: number): Tick[] {
  const from = toGregorian(vp.start);
  const ticks: Tick[] = [];

  let year = from.year;
  let month = Math.floor((from.month - 1) / step) * step + 1;

  for (let guard = 0; guard < 512; guard++) {
    const t = fromGregorian(year, month, 1);
    if (t > vp.end) break;
    if (t >= vp.start) {
      const isJanuary = month === 1;
      ticks.push({
        t,
        label: isJanuary ? formatYear(year) : (MONTHS[month - 1] as string),
        major: isJanuary,
      });
    }
    month += step;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
  }
  return ticks;
}

function dayTicks(vp: Viewport, step: number): Tick[] {
  const from = toGregorian(vp.start);
  const ticks: Tick[] = [];

  let year = from.year;
  let month = from.month;
  let day = Math.max(1, Math.floor((from.day - 1) / step) * step + 1);

  for (let guard = 0; guard < 512; guard++) {
    const t = fromGregorian(year, month, day);
    if (t > vp.end) break;
    if (t >= vp.start) {
      const first = day === 1;
      ticks.push({
        t,
        label: first
          ? `${MONTHS[month - 1]} ${formatYear(year)}`
          : `${day} ${MONTHS[month - 1] as string}`,
        major: first,
      });
    }

    // Step in days, then renormalise through the calendar so month ends behave.
    const next = toGregorian(fromGregorian(year, month, day) + step);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  return ticks;
}

/**
 * Calendar arithmetic for the numeric time axis (design.md §2.3).
 *
 * `Days` is fractional days from 1970-01-01T00:00 in the **proleptic Gregorian**
 * calendar, with astronomical year numbering (year 0 = 1 BC, -1 = 2 BC). All
 * computation happens on that axis; `calendar: 'julian'` only changes how a date
 * is spelled on the way in and on the way out.
 *
 * No JS `Date` anywhere: it cannot represent deep antiquity, silently applies a
 * time zone, and has no proleptic Gregorian guarantee.
 */

import type { Calendar, Days, Granularity } from '../model/types';

/**
 * Mean Gregorian year. Used only for uncertainty slack and for human-scale
 * constants — never for date arithmetic, which is exact and integer.
 */
export const DAYS_PER_YEAR = 365.2425;

// ---------------------------------------------------------------------------
// Civil date <-> Days
// ---------------------------------------------------------------------------

/**
 * Days from 1970-01-01 for a proleptic Gregorian civil date.
 *
 * Howard Hinnant's `days_from_civil`, shifted so 1970-01-01 is day 0. Exact for
 * every year float64 can hold as an integer, negative years included, because
 * every operation is integer arithmetic with floor division.
 */
function gregorianToDays(year: number, month: number, day: number): Days {
  // Treat March as the first month, so the leap day lands at the end of the year.
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const mp = month + (month > 2 ? -3 : 9); // [0, 11], March = 0
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of {@link gregorianToDays}; `z` must be an integer day count. */
function daysToGregorian(z: number): { year: number; month: number; day: number } {
  const shifted = z + 719468;
  const era = Math.floor(shifted / 146097);
  const doe = shifted - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/**
 * Same March-based construction with the Julian leap rule (every fourth year,
 * no centurial exception). The constant is fixed by 1969-12-19 (Julian) being
 * 1970-01-01 (Gregorian), i.e. day 0.
 */
const JULIAN_ORIGIN = 719470;

function julianToDays(year: number, month: number, day: number): Days {
  const y = year - (month <= 2 ? 1 : 0);
  const mp = month + (month > 2 ? -3 : 9);
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  return 365 * y + Math.floor(y / 4) + doy - JULIAN_ORIGIN;
}

function daysToJulian(z: number): { year: number; month: number; day: number } {
  const shifted = z + JULIAN_ORIGIN;
  // f(y) = 365y + floor(y/4) = 1461q + 365r for y = 4q + r, r in [0, 3].
  const quad = Math.floor(shifted / 1461);
  const doq = shifted - quad * 1461; // [0, 1460]
  const r = Math.min(Math.floor(doq / 365), 3);
  const y = quad * 4 + r;
  const doy = doq - 365 * r; // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/**
 * A civil date to `Days`.
 *
 * Astronomical year numbering: year 0 = 1 BC, -1 = 2 BC. `month` and `day` are
 * 1-based; omitted parts default to the start of the period, so `fromGregorian(1969)`
 * is 1969-01-01. `calendar` says which calendar the *arguments* are written in —
 * the result is always a point on the one proleptic Gregorian axis, which is why
 * 4 March 1493 (Julian) and 13 March 1493 (Gregorian) return the same number.
 *
 * Out-of-range components roll over (month 13 is January of the next year); the
 * parser validates, this converter does not.
 */
export function fromGregorian(
  year: number,
  month = 1,
  day = 1,
  calendar: Calendar = 'gregorian',
): Days {
  return calendar === 'julian'
    ? julianToDays(year, month, day)
    : gregorianToDays(year, month, day);
}

/**
 * `Days` back to a civil date in `calendar`. Any fraction of a day is discarded:
 * the result names the day `t` falls in.
 */
export function toGregorian(
  t: Days,
  calendar: Calendar = 'gregorian',
): { year: number; month: number; day: number } {
  const z = Math.floor(t);
  return calendar === 'julian' ? daysToJulian(z) : daysToGregorian(z);
}

// ---------------------------------------------------------------------------
// Calendar facts
// ---------------------------------------------------------------------------

/** Leap year test, proleptic in both calendars and correct for negative years. */
export function isLeapYear(year: number, calendar: Calendar = 'gregorian'): boolean {
  if (calendar === 'julian') return year % 4 === 0;
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Length of a month, 1-based. Returns 0 for a month outside 1..12. */
export function daysInMonth(year: number, month: number, calendar: Calendar = 'gregorian'): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year, calendar) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Whether (year, month, day) names a real day in `calendar`. */
export function isValidCivilDate(
  year: number,
  month: number,
  day: number,
  calendar: Calendar = 'gregorian',
): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month, calendar);
}

// ---------------------------------------------------------------------------
// Named periods
// ---------------------------------------------------------------------------

/**
 * The decade containing `year`, as `[firstYear, lastYear + 1)`.
 *
 * AD decades are named by their floor — "the 1180s" is 1180..1189. BC decades
 * are named the same way but counted in BC years, so "the 250s BC" is
 * 259..250 BC, i.e. astronomical -258..-249. Year 0 (1 BC) is therefore in
 * the 0s BC, not in an AD decade.
 *
 * The two decades either side of the epoch are nine years long, not ten: there
 * is no year 0 in the reader's numbering, so the 0s BC runs 9 BC..1 BC and the
 * AD 0s runs AD 1..AD 9. Letting either span the full ten would make them
 * overlap, and a decade that claims a year belonging to the other era formats
 * under the wrong one.
 */
export function decadeYears(year: number): [number, number] {
  if (year > 0) {
    const start = Math.floor(year / 10) * 10;
    return [Math.max(start, 1), start + 10];
  }
  const bc = 1 - year; // BC year number, >= 1
  const label = Math.floor(bc / 10) * 10;
  const start = 1 - (label + 9);
  return [start, Math.min(start + 10, 1)];
}

/**
 * The century containing `year`, as `[firstYear, lastYear + 1)`.
 *
 * Ordinal counting, the historians' convention: the 12th century is 1101..1200
 * and the 3rd century BC is 300..201 BC (astronomical -299..-200). Note this is
 * deliberately one year off from the decade rule above — "the 1100s" and "the
 * 12th century" are two different naming systems, and each is implemented as it
 * is actually used.
 */
export function centuryYears(year: number): [number, number] {
  if (year > 0) {
    const n = Math.ceil(year / 100);
    const start = 100 * (n - 1) + 1;
    return [start, start + 100];
  }
  const n = Math.ceil((1 - year) / 100);
  const start = 1 - 100 * n;
  return [start, start + 100];
}

/**
 * The half-open span `[start, end)` of the period a date names at a given
 * granularity: the day, the month, the year, the decade or the century it is in.
 * Coarse granularities snap — 1187 at century granularity is the whole 12th century.
 */
export function periodBounds(
  year: number,
  month: number,
  day: number,
  granularity: Granularity,
  calendar: Calendar = 'gregorian',
): { start: Days; end: Days } {
  switch (granularity) {
    case 'day': {
      const start = fromGregorian(year, month, day, calendar);
      return { start, end: start + 1 };
    }
    case 'month': {
      const start = fromGregorian(year, month, 1, calendar);
      const end =
        month === 12
          ? fromGregorian(year + 1, 1, 1, calendar)
          : fromGregorian(year, month + 1, 1, calendar);
      return { start, end };
    }
    case 'year':
      return {
        start: fromGregorian(year, 1, 1, calendar),
        end: fromGregorian(year + 1, 1, 1, calendar),
      };
    case 'decade': {
      const [first, next] = decadeYears(year);
      return {
        start: fromGregorian(first, 1, 1, calendar),
        end: fromGregorian(next, 1, 1, calendar),
      };
    }
    case 'century': {
      const [first, next] = centuryYears(year);
      return {
        start: fromGregorian(first, 1, 1, calendar),
        end: fromGregorian(next, 1, 1, calendar),
      };
    }
  }
}

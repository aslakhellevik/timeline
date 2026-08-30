/**
 * Turning a `TimeSpec` back into words (design.md §2.2, D19).
 *
 * `text` wins when present — it is kept exactly because the phrasing said more
 * than the four numbers can ("mid-3rd century BC" and "c. 250 BC" are different
 * claims). Otherwise the string is derived from `(mode, granularity, a..d)`.
 *
 * Year 0 is never shown: it is 1 BC.
 */

import type { Calendar, Days, Granularity, TimeSpec } from '../model/types';
import { centuryYears, decadeYears, toGregorian } from './calendar';

const EN_DASH = '–';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type EraStyle = 'bc' | 'bce';

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * A year, in the reader's numbering. Astronomical year 0 is 1 BC and -1 is 2 BC.
 * The era is only spelled out where it is genuinely needed: always for BC, and
 * for AD years below 1000, where a bare number would read as an ordinary one.
 * UK convention puts AD before the year and CE after it.
 */
function yearLabel(year: number, era: EraStyle): string {
  if (year <= 0) return `${1 - year} ${era === 'bce' ? 'BCE' : 'BC'}`;
  if (year < 1000) return era === 'bce' ? `${year} CE` : `AD ${year}`;
  return String(year);
}

function decadeLabel(year: number, era: EraStyle): string {
  const [start] = decadeYears(year);
  // The AD 0s starts at AD 1, not at a year 0, so it is named from its floor.
  if (start >= 1) return `${Math.floor(start / 10) * 10}s`;
  // The BC decade starting at astronomical `start` is named for its last year.
  return `${-start - 8}s ${era === 'bce' ? 'BCE' : 'BC'}`;
}

function centuryLabel(year: number, era: EraStyle): string {
  const [start] = centuryYears(year);
  if (start > 0) return `${ordinal((start - 1) / 100 + 1)} century`;
  return `${ordinal((1 - start) / 100)} century ${era === 'bce' ? 'BCE' : 'BC'}`;
}

/** The name of the period `t` falls in, at `granularity`. */
function periodLabel(t: Days, granularity: Granularity, calendar: Calendar, era: EraStyle): string {
  const { year, month, day } = toGregorian(t, calendar);
  switch (granularity) {
    case 'day':
      return `${day} ${monthName(month)} ${yearLabel(year, era)}`;
    case 'month':
      return `${monthName(month)} ${yearLabel(year, era)}`;
    case 'year':
      return yearLabel(year, era);
    case 'decade':
      return decadeLabel(year, era);
    case 'century':
      return centuryLabel(year, era);
  }
}

/**
 * `start` to `end`, where `end` is exclusive: 1914–1918 is stored as ending at
 * the start of 1919, so the label comes from the last day inside the span. A
 * range that begins and ends in the same period collapses to one label.
 */
function rangeLabel(
  start: Days,
  end: Days,
  granularity: Granularity,
  calendar: Calendar,
  era: EraStyle,
): string {
  const last = end > start ? end - 1 : start;
  const from = periodLabel(start, granularity, calendar, era);
  const to = periodLabel(last, granularity, calendar, era);
  if (from === to) return from;
  // Spaced dash when either side is itself several words, so the range still parses by eye.
  const joiner = from.includes(' ') || to.includes(' ') ? ` ${EN_DASH} ` : EN_DASH;
  return `${from}${joiner}${to}`;
}

/**
 * Display string for a spec. `opts.era` picks BC/AD (the default) or BCE/CE.
 *
 * The calendar is not spelled out: a Julian spec formats as its Julian date, and
 * saying so is the surrounding UI's job, not part of the date itself.
 */
export function formatTime(spec: TimeSpec, opts?: { era?: EraStyle }): string {
  if (spec.text !== undefined && spec.text !== '') return spec.text;
  const era = opts?.era ?? 'bc';
  const { granularity, calendar } = spec;
  switch (spec.mode) {
    case 'instant':
      return periodLabel(spec.a, granularity, calendar, era);
    case 'interval':
      return rangeLabel(spec.a, spec.d, granularity, calendar, era);
    case 'fuzzy': {
      const plateau = rangeLabel(spec.b, spec.c, granularity, calendar, era);
      // Shoulders mean the claim is soft; a bare rectangle is just the period itself.
      const soft = spec.a < spec.b || spec.c < spec.d;
      return soft ? `c. ${plateau}` : plateau;
    }
  }
}

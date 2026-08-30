/**
 * The time library (design.md §2). Pure, framework-free, and the foundation the
 * rest of the app rests on: every temporal claim in the store is a `TimeSpec`
 * built here, and every date the user sees is formatted here.
 *
 *   fromGregorian / toGregorian   civil dates <-> the numeric axis
 *   instant / interval / fuzzy    the three ways to make a well-formed spec
 *   parseTime / extractTime       typed text -> a spec
 *   formatTime                    a spec -> text
 *   compareTime / midpoint        sorting and placing
 */

export {
  DAYS_PER_YEAR,
  centuryYears,
  daysInMonth,
  decadeYears,
  fromGregorian,
  isLeapYear,
  isValidCivilDate,
  periodBounds,
  toGregorian,
} from './calendar';

export {
  MIN_SIGMA,
  compareTime,
  fuzzy,
  instant,
  interval,
  isWellFormedSpec,
  midpoint,
  trapezoidStats,
} from './spec';

export { extractTime, parseTime } from './parse';
export type { ExtractOptions, ParseResult } from './parse';

export { formatTime } from './format';

/**
 * The date parser (design.md §2.2). It is the whole user experience of dates:
 * quick-add never needs a mode selector because the parser infers `mode` and
 * `granularity` from what was typed.
 *
 * One table of patterns serves both entry points, so they cannot drift:
 *   - `parseTime`   the whole string must be a date;
 *   - `extractTime` finds a date anywhere inside a longer string, and reports
 *                   which characters it used so the rest becomes the title.
 *
 * Everything the parser produces is `calendar: 'gregorian'` — there is no syntax
 * for entering a Julian date, which is an editor concern rather than a typing one.
 */

import type { Days, Granularity, TimeSpec } from '../model/types';
import {
  DAYS_PER_YEAR,
  centuryYears,
  decadeYears,
  fromGregorian,
  isValidCivilDate,
  periodBounds,
} from './calendar';
import { fuzzy, instant, interval } from './spec';

export type ParseResult =
  | { ok: true; value: TimeSpec; consumed: [number, number] }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** "c. 1200", "ca 1200", "circa 1200", "~1200", "about 1200". */
const CIRCA = String.raw`circa|approximately|approx\.?|about|around|omkring|ca\.?|c\.|~|≈`;

/** BC / BCE / f.Kr. and AD / CE / e.Kr., with or without full stops. */
const ERA = String.raw`B\.?C\.?E\.?|B\.?C\.?|f\.?\s?Kr\.?|A\.?D\.?|C\.?E\.?|e\.?\s?Kr\.?`;

/** Any dash, a slash, or a range word. Tight enough to sit inside `1914-1918`. */
const SEP_TIGHT = String.raw`\s*[-–—/]\s*|\s+(?:to|until|through|til|fra)\s+`;

/**
 * The same, minus the bare hyphen: a hyphen only separates a range here if it is
 * spaced. Without that rule `1969-13-01` would read as "1969 to January 13",
 * turning an impossible date into a confident wrong answer.
 */
const SEP_LOOSE = String.raw`\s*[–—/]\s*|\s+-\s+|\s+(?:to|until|through|til)\s+`;

const MONTH_NAMES: readonly (readonly string[])[] = [
  ['january', 'jan', 'januar'],
  ['february', 'feb', 'februar'],
  ['march', 'mar', 'mars'],
  ['april', 'apr'],
  ['may', 'mai'],
  ['june', 'jun', 'juni'],
  ['july', 'jul', 'juli'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oct', 'oktober', 'okt'],
  ['november', 'nov'],
  ['december', 'dec', 'desember', 'des'],
];

const MONTH_OF = new Map<string, number>();
for (const [i, names] of MONTH_NAMES.entries()) {
  for (const name of names) MONTH_OF.set(name, i + 1);
}
/** Longest first, so `jan` never wins over `january`. */
const MONTH_SRC = [...MONTH_OF.keys()].sort((a, b) => b.length - a.length).join('|');

/**
 * How far a "circa" qualifier reaches beyond the period it qualifies, per side,
 * in days. Deliberately not a single formula: "c. 20 July 1969" means a few days,
 * while "c. 1200 BC" carries the conventional scholarly half-decade or so, and a
 * qualifier on an already-vague century adds proportionally less.
 */
const CIRCA_SLACK: Record<Granularity, number> = {
  day: 3,
  month: 45,
  year: Math.round(5 * DAYS_PER_YEAR),
  decade: Math.round(5 * DAYS_PER_YEAR),
  century: Math.round(25 * DAYS_PER_YEAR),
};

const COARSENESS: Record<Granularity, number> = {
  day: 0,
  month: 1,
  year: 2,
  decade: 3,
  century: 4,
};

function coarser(a: Granularity, b: Granularity): Granularity {
  return COARSENESS[a] >= COARSENESS[b] ? a : b;
}

function eraIsBc(text: string): boolean {
  const t = text.toLowerCase().replace(/[.\s]/g, '');
  return t === 'bc' || t === 'bce' || t === 'fkr';
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

type Groups = Record<string, string | undefined>;
type Mode = 'parse' | 'extract';
type Built = { spec: TimeSpec } | { error: string };

/**
 * Where a candidate sits in the line it was found in. Only `extractTime`
 * supplies one — `parseTime` was handed a date and nothing else.
 */
interface MatchContext {
  start: number;
  end: number;
  /** Bounds of the prose, ignoring surrounding whitespace and `#tags`. */
  contentStart: number;
  contentEnd: number;
}

interface Span {
  start: Days;
  end: Days;
  granularity: Granularity;
}

function num(s: string | undefined): number | undefined {
  return s === undefined ? undefined : Number.parseInt(s, 10);
}

/**
 * Astronomical year from what was written. `250 BC` is astronomical -249, while
 * the signed form `-0250` already *is* astronomical (and so reads as 251 BC) —
 * ISO 8601's convention, kept because mixing the two silently is how off-by-one
 * errors in antiquity happen. A sign together with an era is a contradiction.
 */
function resolveYear(digits: string, era: string | undefined): number | null {
  const signed = digits.startsWith('-') || digits.startsWith('+');
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  if (era === undefined) return n;
  if (signed || n < 1) return null;
  return eraIsBc(era) ? 1 - n : n;
}

/**
 * A `#tag`, spelled as quick-add spells it. Duplicated rather than imported —
 * quick-add is built on this module, not the other way round.
 */
const TAG = /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/gu;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

/**
 * The bounds of the prose in `input`: what is left after whitespace, `#tags` and
 * punctuation at either end. Quick-add has usually cut its tags out already, but
 * `extractTime` is a public entry point, and neither a trailing `#war` nor the
 * brackets around `(962)` should push a trailing year out of the position that
 * is what makes it a year.
 */
function contentBounds(input: string): [number, number] {
  // Blanked, not removed, so every offset still refers to the original string.
  const bare = input.replace(TAG, (tag) => ' '.repeat(tag.length));
  let start = 0;
  while (start < bare.length && !ALPHANUMERIC.test(bare.charAt(start))) start += 1;
  let end = bare.length;
  while (end > start && !ALPHANUMERIC.test(bare.charAt(end - 1))) end -= 1;
  return start >= end ? [0, input.length] : [start, end];
}

/** Whether the match touches one end of the prose. */
function atEdge(ctx: MatchContext | undefined): boolean {
  if (ctx === undefined) return true;
  return ctx.start <= ctx.contentStart || ctx.end >= ctx.contentEnd;
}

/**
 * In `extractTime`, a bare number is far more likely to be a chapter, a count or
 * part of a name than a year, so it is only read as a date when something says
 * it is one. One or two digits never qualify on their own. Three do, but only at
 * one end of the line: a quick-add date is typed either first or last —
 * "coronation of Otto 962", "962 coronation of Otto" — while three digits in the
 * middle of a phrase are usually part of the phrase, as in "the 100 years war".
 *
 * `parseTime` has no such doubt: the user handed it a date and nothing else.
 */
function weakYear(
  digits: string,
  era: string | undefined,
  circa: string | undefined,
  ctx?: MatchContext,
): boolean {
  if (era !== undefined || circa !== undefined) return false;
  const length = digits.replace(/^[+-]/, '').length;
  if (length < 3) return true;
  return length === 3 && !atEdge(ctx);
}

function withText(spec: TimeSpec, text: string): TimeSpec {
  return { ...spec, text: text.trim() };
}

function unreadable(matched: string): Built {
  return { error: `could not read "${matched.trim()}" as a date` };
}

/** A dated point, widened to its period — or softened outwards when hedged. */
function pointSpec(
  year: number,
  month: number | undefined,
  day: number | undefined,
  granularity: Granularity,
  circa: string | undefined,
  raw: string,
): TimeSpec {
  if (circa === undefined) return instant(year, month, day, { granularity });
  const { start, end } = periodBounds(year, month ?? 1, day ?? 1, granularity);
  const slack = CIRCA_SLACK[granularity];
  return withText(fuzzy(start - slack, start, end, end + slack, { granularity }), raw);
}

/** A span, from one period to another: an interval, or a soft one when hedged. */
function spanSpec(from: Span, to: Span, circa: string | undefined, raw: string): TimeSpec {
  const granularity = coarser(from.granularity, to.granularity);
  const start = Math.min(from.start, to.start);
  const end = Math.max(from.end, to.end);
  if (circa === undefined) return interval(start, end, { granularity });
  const slack = CIRCA_SLACK[granularity];
  return withText(fuzzy(start - slack, start, end, end + slack, { granularity }), raw);
}

/** Validate and expand a year/month/day triple into the period it names. */
function civilSpan(
  year: number,
  month: number | undefined,
  day: number | undefined,
  matched: string,
): Span | Built {
  if (month !== undefined && (month < 1 || month > 12)) {
    return { error: `there is no month ${month}` };
  }
  if (day !== undefined && !isValidCivilDate(year, month ?? 1, day)) {
    return { error: `"${matched.trim()}" is not a real date` };
  }
  const granularity: Granularity =
    day !== undefined ? 'day' : month !== undefined ? 'month' : 'year';
  const { start, end } = periodBounds(year, month ?? 1, day ?? 1, granularity);
  return { start, end, granularity };
}

function isBuilt(x: Span | Built): x is Built {
  return 'error' in x;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

interface Pattern {
  name: string;
  core: string;
  build(g: Groups, matched: string, mode: Mode, ctx?: MatchContext): Built;
}

/** Every pattern may be hedged: a leading "c." or a trailing "?". */
function wrap(name: string, core: string): string {
  return `(?:(?<${name}_circa>${CIRCA})\\s*)?(?:${core})(?:\\s*(?<${name}_q>\\?))?`;
}

const PATTERNS: Pattern[] = [
  // "3rd century BC", "early 3rd century BC", "mid-12th century"
  {
    name: 'cent',
    core: String.raw`(?:(?<cent_mod>early|mid|middle|late)[\s-]*)?(?<cent_ord>\d{1,3})(?:st|nd|rd|th)\s+centur(?:y|ies)(?:\s*(?<cent_era>${ERA}))?`,
    build(g, matched) {
      const ord = num(g.cent_ord);
      if (ord === undefined || ord < 1) return unreadable(matched);
      const era = g.cent_era;
      const bc = era !== undefined && eraIsBc(era);
      const [first, next] = centuryYears(bc ? 1 - 100 * ord : 100 * ord);
      const s = fromGregorian(first);
      const e = fromGregorian(next);
      const len = e - s;
      const mod = g.cent_mod?.toLowerCase();
      // The named third is what is likely; the claim stays possible half a third
      // to either side of it, still inside the century.
      let a = s;
      let b = s;
      let c = e;
      let d = e;
      if (mod === 'early') {
        [a, b, c, d] = [s, s, s + len / 3, s + len / 2];
      } else if (mod === 'mid' || mod === 'middle') {
        [a, b, c, d] = [s + len / 6, s + len / 3, s + (2 * len) / 3, s + (5 * len) / 6];
      } else if (mod === 'late') {
        [a, b, c, d] = [s + len / 2, s + (2 * len) / 3, e, e];
      }
      const circa = g.cent_circa ?? g.cent_q;
      if (circa !== undefined) {
        const slack = CIRCA_SLACK.century;
        a -= slack;
        d += slack;
      }
      const spec = fuzzy(a, b, c, d, { granularity: 'century' });
      // "mid-3rd century BC" is a different claim from the numbers alone (§2.2).
      return { spec: mod !== undefined || circa !== undefined ? withText(spec, matched) : spec };
    },
  },

  // "1180s", "the 1180s", "250s BC"
  {
    name: 'dec',
    core: String.raw`(?:the\s+)?(?<dec_year>\d{1,6})['’]?s(?:\s*(?<dec_era>${ERA}))?`,
    build(g, matched, mode, ctx) {
      const digits = g.dec_year;
      const label = num(digits);
      if (digits === undefined || label === undefined || label % 10 !== 0) {
        return { error: `"${matched.trim()}" is not a decade` };
      }
      const era = g.dec_era;
      const circa = g.dec_circa ?? g.dec_q;
      // "in his 20s" is a person's age, not a decade of the common era.
      if (mode === 'extract' && weakYear(digits, era, circa, ctx)) {
        return { error: 'not clearly a date' };
      }
      const bc = era !== undefined && eraIsBc(era);
      // The AD 0s begins at AD 1: `decadeYears(0)` names the decade before it.
      const [first, next] = decadeYears(bc ? 1 - (label + 9) : Math.max(label, 1));
      const s = fromGregorian(first);
      const e = fromGregorian(next);
      // A decade label is a claim about vagueness, not about duration.
      if (circa === undefined) return { spec: fuzzy(s, s, e, e, { granularity: 'decade' }) };
      const slack = CIRCA_SLACK.decade;
      return {
        spec: withText(fuzzy(s - slack, s, e, e + slack, { granularity: 'decade' }), matched),
      };
    },
  },

  // "20 July 1969", "20th July 1969", "20. juli 1969"
  {
    name: 'dmy',
    core: String.raw`(?<dmy_day>\d{1,2})(?:st|nd|rd|th)?\.?\s+(?<dmy_month>${MONTH_SRC})\.?,?\s+(?<dmy_year>[+-]?\d{1,6})(?:\s*(?<dmy_era>${ERA}))?`,
    build(g, matched) {
      return textualDate(g.dmy_year, g.dmy_month, g.dmy_day, g.dmy_era, g.dmy_circa ?? g.dmy_q, matched);
    },
  },

  // "July 20, 1969"
  {
    name: 'mdy',
    // Day and year must be separated by a comma or a space, or `July 1969` would
    // read as the 19th of July in the year 69.
    core: String.raw`(?<mdy_month>${MONTH_SRC})\.?\s+(?<mdy_day>\d{1,2})(?:st|nd|rd|th)?(?:\s*,\s*|\s+)(?<mdy_year>[+-]?\d{1,6})(?:\s*(?<mdy_era>${ERA}))?`,
    build(g, matched) {
      return textualDate(g.mdy_year, g.mdy_month, g.mdy_day, g.mdy_era, g.mdy_circa ?? g.mdy_q, matched);
    },
  },

  // "July 1969"
  {
    name: 'my',
    core: String.raw`(?<my_month>${MONTH_SRC})\.?,?\s+(?<my_year>[+-]?\d{1,6})(?:\s*(?<my_era>${ERA}))?`,
    build(g, matched) {
      return textualDate(g.my_year, g.my_month, undefined, g.my_era, g.my_circa ?? g.my_q, matched);
    },
  },

  // "AD 1969", "CE 1200"
  {
    name: 'ef',
    core: String.raw`(?<ef_era>A\.?D\.?|C\.?E\.?)\s*(?<ef_year>\d{1,6})`,
    build(g, matched, mode, ctx) {
      const digits = g.ef_year;
      if (digits === undefined) return unreadable(matched);
      // The era is deliberately not passed to `weakYear` here: a *leading* "ad"
      // is an ordinary English word, so "an ad 2 page spread" is prose and only
      // the number itself can say otherwise. A trailing era ("44 BC") cannot be
      // mistaken for anything and keeps its exemption.
      if (mode === 'extract' && weakYear(digits, undefined, g.ef_circa ?? g.ef_q, ctx)) {
        return { error: 'not clearly a date' };
      }
      const year = resolveYear(digits, g.ef_era);
      if (year === null) return unreadable(matched);
      return { spec: pointSpec(year, undefined, undefined, 'year', g.ef_circa ?? g.ef_q, matched) };
    },
  },

  // "1187 or 1189"
  {
    name: 'dj',
    core: String.raw`(?<dj_y1>[+-]?\d{1,6})(?:\s*(?<dj_era1>${ERA}))?\s+(?:or|eller)\s+(?<dj_y2>[+-]?\d{1,6})(?:\s*(?<dj_era2>${ERA}))?`,
    build(g, matched, mode, ctx) {
      const d1 = g.dj_y1;
      const d2 = g.dj_y2;
      if (d1 === undefined || d2 === undefined) return unreadable(matched);
      const circa = g.dj_circa ?? g.dj_q;
      const era1 = g.dj_era1 ?? g.dj_era2;
      const era2 = g.dj_era2 ?? g.dj_era1;
      if (mode === 'extract' && weakYear(d1, era1, circa, ctx) && weakYear(d2, era2, circa, ctx)) {
        return { error: 'not clearly a date' };
      }
      const y1 = resolveYear(d1, era1);
      const y2 = resolveYear(d2, era2);
      if (y1 === null || y2 === null) return unreadable(matched);
      const s1 = civilSpan(y1, undefined, undefined, matched);
      if (isBuilt(s1)) return s1;
      const s2 = civilSpan(y2, undefined, undefined, matched);
      if (isBuilt(s2)) return s2;
      // A trapezoid cannot be bimodal (§2.2, accepted): the span covers both
      // candidates, and `text` keeps the claim that was actually made.
      const start = Math.min(s1.start, s2.start);
      const end = Math.max(s1.end, s2.end);
      return { spec: withText(fuzzy(start, start, end, end, { granularity: 'year' }), matched) };
    },
  },

  // "1969-07-20", "1969-07", "1969", "-0250", "250 BC", "c. 1200 BC", "1200?"
  {
    name: 'iso',
    core: String.raw`(?<iso_year>[+-]?\d{1,6})(?:-(?<iso_month>\d{1,2})(?:-(?<iso_day>\d{1,2}))?)?(?:\s*(?<iso_era>${ERA}))?`,
    build(g, matched, mode, ctx) {
      const digits = g.iso_year;
      if (digits === undefined) return unreadable(matched);
      const era = g.iso_era;
      const circa = g.iso_circa ?? g.iso_q;
      if (mode === 'extract' && g.iso_month === undefined && weakYear(digits, era, circa, ctx)) {
        return { error: 'not clearly a date' };
      }
      const year = resolveYear(digits, era);
      if (year === null) return unreadable(matched);
      const month = num(g.iso_month);
      const day = num(g.iso_day);
      const span = civilSpan(year, month, day, matched);
      if (isBuilt(span)) return span;
      return { spec: pointSpec(year, month, day, span.granularity, circa, matched) };
    },
  },

  // "1914-1918", "1914/1918", "1914 to 1918", "1914–1918", "250-200 BC", "1914-18"
  {
    name: 'ry',
    core: String.raw`(?<ry_y1>[+-]?\d{1,6})(?:\s*(?<ry_era1>${ERA}))?(?<ry_sep>${SEP_TIGHT})(?<ry_y2>[+-]?\d{1,6})(?:\s*(?<ry_era2>${ERA}))?`,
    build(g, matched, mode, ctx) {
      const d1 = g.ry_y1;
      const d2 = g.ry_y2;
      if (d1 === undefined || d2 === undefined) return unreadable(matched);
      const circa = g.ry_circa ?? g.ry_q;
      const era1 = g.ry_era1 ?? g.ry_era2;
      const era2 = g.ry_era2 ?? g.ry_era1;
      if (mode === 'extract' && weakYear(d1, era1, circa, ctx) && weakYear(d2, era2, circa, ctx)) {
        return { error: 'not clearly a date' };
      }
      const y1 = resolveYear(d1, era1);
      let y2 = resolveYear(d2, era2);
      if (y1 === null || y2 === null) return unreadable(matched);
      // "1914-18": a short second year continues the first. Ambiguous against
      // `1969-07`, which is why anything that would run backwards is rejected
      // here and left to the ISO reading instead.
      const bare2 = g.ry_era2 === undefined && !/^[+-]/.test(d2);
      if (bare2 && d2.length <= 2 && d1.replace(/^[+-]/, '').length >= 3) {
        const scale = 10 ** d2.length;
        const completed = Math.floor(y1 / scale) * scale + y2;
        if (completed <= y1) return { error: `"${matched.trim()}" is not a range` };
        y2 = completed;
      }
      const s1 = civilSpan(y1, undefined, undefined, matched);
      if (isBuilt(s1)) return s1;
      const s2 = civilSpan(y2, undefined, undefined, matched);
      if (isBuilt(s2)) return s2;
      return { spec: spanSpec(s1, s2, circa, matched) };
    },
  },

  // "1939-09-01 to 1945-09-02", "July 1914 – November 1918" is not supported;
  // full dates need a separator that cannot be confused with an ISO hyphen.
  {
    name: 'rd',
    core: String.raw`(?<rd_y1>[+-]?\d{1,6})(?:-(?<rd_m1>\d{1,2})(?:-(?<rd_d1>\d{1,2}))?)?(?:\s*(?<rd_era1>${ERA}))?(?:${SEP_LOOSE})(?<rd_y2>[+-]?\d{1,6})(?:-(?<rd_m2>\d{1,2})(?:-(?<rd_d2>\d{1,2}))?)?(?:\s*(?<rd_era2>${ERA}))?`,
    build(g, matched, mode, ctx) {
      const d1 = g.rd_y1;
      const d2 = g.rd_y2;
      if (d1 === undefined || d2 === undefined) return unreadable(matched);
      const circa = g.rd_circa ?? g.rd_q;
      const era1 = g.rd_era1 ?? g.rd_era2;
      const era2 = g.rd_era2 ?? g.rd_era1;
      if (
        mode === 'extract' &&
        g.rd_m1 === undefined &&
        g.rd_m2 === undefined &&
        weakYear(d1, era1, circa, ctx) &&
        weakYear(d2, era2, circa, ctx)
      ) {
        return { error: 'not clearly a date' };
      }
      const y1 = resolveYear(d1, era1);
      const y2 = resolveYear(d2, era2);
      if (y1 === null || y2 === null) return unreadable(matched);
      const s1 = civilSpan(y1, num(g.rd_m1), num(g.rd_d1), matched);
      if (isBuilt(s1)) return s1;
      const s2 = civilSpan(y2, num(g.rd_m2), num(g.rd_d2), matched);
      if (isBuilt(s2)) return s2;
      return { spec: spanSpec(s1, s2, circa, matched) };
    },
  },
];

/** Shared tail of the three textual-date patterns. */
function textualDate(
  yearDigits: string | undefined,
  monthWord: string | undefined,
  dayDigits: string | undefined,
  era: string | undefined,
  circa: string | undefined,
  matched: string,
): Built {
  if (yearDigits === undefined || monthWord === undefined) return unreadable(matched);
  const month = MONTH_OF.get(monthWord.toLowerCase().replace(/\.$/, ''));
  if (month === undefined) return unreadable(matched);
  const year = resolveYear(yearDigits, era);
  if (year === null) return unreadable(matched);
  const day = num(dayDigits);
  const span = civilSpan(year, month, day, matched);
  if (isBuilt(span)) return span;
  return { spec: pointSpec(year, month, day, span.granularity, circa, matched) };
}

interface Compiled extends Pattern {
  anchored: RegExp;
  scanner: RegExp;
  priority: number;
}

const COMPILED: Compiled[] = PATTERNS.map((p, i) => {
  const src = wrap(p.name, p.core);
  return {
    ...p,
    priority: i,
    anchored: new RegExp(`^\\s*(?:${src})\\s*$`, 'i'),
    // Word boundaries that also refuse to start or end inside a number.
    scanner: new RegExp(`(?<![0-9A-Za-z])(?:${src})(?![0-9A-Za-z])`, 'gi'),
  };
});

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Read a whole string as a date. Patterns are tried in order of specificity, so
 * `1969-07` is a month rather than a range from 1969 to the year 7, while
 * `1914-1918`, which no ISO reading fits, falls through to the range.
 */
export function parseTime(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'no date given' };
  const start = input.length - input.trimStart().length;
  const consumed: [number, number] = [start, start + trimmed.length];
  let firstError: string | undefined;
  for (const p of COMPILED) {
    const m = p.anchored.exec(input);
    if (m === null) continue;
    const built = p.build(m.groups ?? {}, trimmed, 'parse');
    if ('spec' in built) return { ok: true, value: built.spec, consumed };
    firstError ??= built.error;
  }
  return { ok: false, reason: firstError ?? `could not read "${trimmed}" as a date` };
}

export interface ExtractOptions {
  /**
   * Which of two equally long candidates to keep. `leftmost` is the default;
   * quick-add asks for `rightmost` because of how its box is typed — you write
   * down what happened and then when it happened.
   */
  prefer?: 'leftmost' | 'rightmost';
}

/**
 * Find a date inside a longer string — "battle of lepanto 1571" — and report the
 * character range it occupies so the caller can keep the rest as a title.
 *
 * The longest match wins, which is what makes `12th century` beat `12` and
 * `1914-1918` beat `1914`; ties go to the more specific pattern, and then to the
 * position `prefer` asks for, so the result is deterministic.
 *
 * Every candidate in the string is collected in this one pass, which is what
 * lets a caller that wants the last date have it without rescanning the tail.
 */
export function extractTime(input: string, opts?: ExtractOptions): ParseResult {
  const [contentStart, contentEnd] = contentBounds(input);
  const candidates: { spec: TimeSpec; start: number; end: number; priority: number }[] = [];
  for (const p of COMPILED) {
    p.scanner.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.scanner.exec(input)) !== null) {
      const text = m[0];
      if (text === '') {
        p.scanner.lastIndex += 1;
        continue;
      }
      const start = m.index;
      const end = m.index + text.length;
      const built = p.build(m.groups ?? {}, text, 'extract', {
        start,
        end,
        contentStart,
        contentEnd,
      });
      if ('spec' in built) {
        candidates.push({ spec: built.spec, start, end, priority: p.priority });
      }
    }
  }
  if (candidates.length === 0) {
    return { ok: false, reason: `no date found in "${input.trim()}"` };
  }
  const nearer = opts?.prefer === 'rightmost' ? -1 : 1;
  candidates.sort(
    (x, y) =>
      y.end - y.start - (x.end - x.start) ||
      x.priority - y.priority ||
      nearer * (x.start - y.start),
  );
  const best = candidates[0];
  if (best === undefined) return { ok: false, reason: 'no date found' };
  return { ok: true, value: best.spec, consumed: [best.start, best.end] };
}

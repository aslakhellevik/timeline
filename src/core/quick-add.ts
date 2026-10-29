/**
 * Quick-add (design.md §8): one typed line becomes a draft event.
 *
 * Capture friction is the top product risk in this project — the app is used
 * while reading a book, and an event that takes more than a few seconds to enter
 * never gets entered at all. So the grammar is deliberately tiny, and is settled
 * in §1's conventions list: **the date is parsed from anywhere in the string,
 * `#tags` are extracted, and whatever remains is the title. Nothing else.**
 * There is no field syntax to learn, no order to remember, and nothing to get
 * wrong at speed.
 *
 * This module decides nothing about storage. It returns tag *names* as typed and
 * a `TimeSpec` or null; resolving names to ids (D20), supplying provenance and
 * validating an empty title are all the caller's business.
 *
 * All date handling goes through `../time`; this file never reads a date itself.
 */

import type { TimeSpec } from './model/types';
import { extractTime } from './time';

export interface QuickAddDraft {
  title: string;
  /** null when no date could be found — the caller decides what to do about it. */
  when: TimeSpec | null;
  /** Raw tag words as typed, without the '#'. Resolution to ids is the caller's job. */
  tagNames: string[];
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * A tag is `#` followed by one word. Two rules make that precise:
 *
 *  - the `#` must not sit inside a word, so `C#` and `F#` are text, not tags;
 *  - the word is letters, digits and underscores, optionally joined by internal
 *    hyphens (`#cold-war`), so trailing punctuation falls outside the match and
 *    `#war,` yields `war`.
 *
 * Multi-word tags are not supported: `#cold war` is the tag `cold` and the word
 * `war` in the title. Supporting them would need a closing delimiter, which is
 * exactly the kind of syntax this grammar exists to avoid.
 */
const TAG = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)/gu;

interface TagScan {
  /** The input with every tag replaced by a space. */
  text: string;
  tagNames: string[];
}

/**
 * Tags come out **before** the date is looked for, and their text is removed
 * from what the date parser sees. `#1848` is then a tag named "1848" rather than
 * a year, which is the reading the user asked for by typing the `#`.
 *
 * Each tag is replaced by a space rather than deleted, so removing one cannot
 * glue its neighbours into a word — or into a number — that was never typed.
 *
 * Repeats are dropped case-insensitively, keeping the first spelling: the caller
 * would otherwise have to de-duplicate before resolving ids, and typing the same
 * tag twice in one line is a slip rather than a claim.
 */
function scanTags(input: string): TagScan {
  const tagNames: string[] = [];
  const seen = new Set<string>();
  const text = input.replace(TAG, (_match: string, name: string): string => {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tagNames.push(name);
    }
    return ' ';
  });
  return { text, tagNames };
}

// ---------------------------------------------------------------------------
// The date
// ---------------------------------------------------------------------------

interface DateMatch {
  spec: TimeSpec;
  /** Character range in the tag-stripped text, as reported by `extractTime`. */
  start: number;
  end: number;
}

/**
 * Find the date, when the line contains more than one number that could be one.
 *
 * `extractTime` already prefers the longest match — `12th century` beats `12`,
 * `1914-1918` beats `1914` — but it breaks a tie between equally long candidates
 * by taking the leftmost. That is the wrong default *here*, because of how this
 * box is actually typed: you write down what happened and then when it happened.
 * So it is asked for the **rightmost** of equals instead.
 *
 * The consequence, and the rule for the ambiguous case in the brief:
 * `the 1848 revolutions in Hungary 1849` dates the event to 1849 and keeps
 * "the 1848 revolutions in Hungary" as the title. Both readings are defensible;
 * this one leaves no stray year sitting in the title, and it matches the habit
 * the capture box is built around. The quick-add UI shows the parsed date back,
 * so the rare wrong guess is visible before it is saved.
 *
 * One call, not one per candidate: this used to rescan the remainder after every
 * hit, which is quadratic in the number of dates and cost half a second on a
 * pasted page. `extractTime` sees every candidate in its own single pass anyway.
 */
function findDate(text: string): DateMatch | null {
  const found = extractTime(text, { prefer: 'rightmost' });
  if (!found.ok) return null;
  const [start, end] = found.consumed;
  return { spec: found.value, start, end };
}

// ---------------------------------------------------------------------------
// The title
// ---------------------------------------------------------------------------

/**
 * `(1571)` with its year cut out is `()`, and nobody typed that. Separators left
 * inside count as empty too: `(#war, 1571)` collapses to `( , )` on the way here.
 */
const EMPTY_BRACKETS = /\([\s,;:]*\)|\[[\s,;:]*\]|\{[\s,;:]*\}/g;
const WHITESPACE = /\s+/g;
const SPACE_BEFORE_PUNCTUATION = /\s+([,;:.!?])/g;
/** `X, 1453, and` loses its year and is left holding two commas. */
const REPEATED_SEPARATORS = /([,;:])(?:\s*[,;:])+/g;
const LEADING_JUNK = /^[\s,;:.\-–—/\\|#)\]}]+/;
/** `!` and `?` survive at the end: they are content, not leftovers. */
const TRAILING_JUNK = /[\s,;:.\-–—/\\|#([{]+$/;

/**
 * Tidy what is left after the date and the tags have been cut out. Collapses
 * whitespace and removes punctuation that is only there because something was
 * removed from between it — never punctuation that is doing work.
 *
 * Case is left exactly as typed. The corpus convention is lower-case openers
 * ("the treaty of Tarnogol"), and auto-capitalising would fight it on every
 * single entry.
 */
function tidyTitle(raw: string): string {
  return raw
    .replace(EMPTY_BRACKETS, ' ')
    .replace(WHITESPACE, ' ')
    .replace(SPACE_BEFORE_PUNCTUATION, '$1')
    .replace(REPEATED_SEPARATORS, '$1')
    .replace(LEADING_JUNK, '')
    .replace(TRAILING_JUNK, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Read one quick-add line.
 *
 *   `battle of lepanto 1571 #europe #war`
 *     -> title "battle of lepanto", a 1571 instant, tags ["europe", "war"]
 *
 * Order does not matter: the date and the tags may appear anywhere, and the
 * title survives whatever is taken out from between its words. An empty or
 * date-only line yields an empty title, which the caller rejects — this function
 * never fails.
 */
export function parseQuickAdd(input: string): QuickAddDraft {
  const { text, tagNames } = scanTags(input);
  const date = findDate(text);
  const withoutDate = date === null ? text : text.slice(0, date.start) + text.slice(date.end);
  return {
    title: tidyTitle(withoutDate),
    when: date === null ? null : date.spec,
    tagNames,
  };
}
